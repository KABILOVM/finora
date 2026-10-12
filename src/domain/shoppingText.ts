import { parseQty, QTY_MAX, NAME_MAX } from './shopping';
import type { ShoppingUnit } from './types';

/**
 * Разбор продиктованного (или набранного) списка покупок: «молоко два литра, хлеб три штуки, яблоки полтора килограмма» →
 * позиции. ЧИСТАЯ функция, без дробных чисел: количество — целое в тысячных долях (см. domain/shopping.ts).
 *
 * Понимает: цифры («2», «1,5», «1.5»), числа словами по-русски («два», «двадцать пять», «сто пятьдесят», «полтора», «пол», «два с половиной»,
 * «дюжина», «пара»), единицы (литр/л, кг/кило, грамм/г, мл, штуки и «упаковочные» слова: пачка, бутылка, банка…), запись «× 3» / «x3».
 * Позиции разделяются запятой, точкой с запятой, переводом строки, словами «и», «ещё», «потом», «плюс» и точкой в конце фразы;
 * если разделителей нет (диктовка часто их не ставит), новая позиция начинается после «названия + количество + единицы».
 * Ошибиться можно (падежи, редкие слова), поэтому экран показывает результат до добавления.
 */

export interface ParsedItem {
  name: string;
  qtyMilli: number;
  unit: ShoppingUnit;
}

export const MAX_PARSED_ITEMS = 100;

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

const ONES: Record<string, number> = {
  ноль: 0, нуль: 0, один: 1, одна: 1, одну: 1, одно: 1, одного: 1, одной: 1, два: 2, две: 2, двух: 2, три: 3, трех: 3, четыре: 4, четырех: 4,
  пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14,
  пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
};
const TENS: Record<string, number> = { двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90 };
const HUNDREDS: Record<string, number> = { сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900 };
/** Слова, которые сами дают количество (в тысячных долях единицы). */
const WHOLE_WORDS: Record<string, number> = { полтора: 1500, полторы: 1500, пол: 500, половина: 500, половинка: 500, дюжина: 12000, пара: 2000, пару: 2000 };

type Unit = ShoppingUnit | 'g' | 'ml';
function unitOf(w: string): Unit | null {
  if (w === 'л' || w.startsWith('литр')) return 'l';
  if (w === 'кг' || w.startsWith('кило') || w.startsWith('килограмм')) return 'kg';
  if (w === 'г' || w === 'гр' || w.startsWith('грамм')) return 'g';
  if (w === 'мл' || w.startsWith('миллилитр')) return 'ml';
  if (
    w === 'шт' || w.startsWith('штук') || w.startsWith('штучк') || w.startsWith('пачк') || w === 'пачек' || w.startsWith('бутылк') || w === 'бутылок' ||
    w.startsWith('упаковк') || w === 'упаковок' || w.startsWith('банк') || w === 'банок' || w.startsWith('буханк') || w === 'буханок' ||
    w.startsWith('пакет') || w.startsWith('коробк') || w === 'коробок'
  ) return 'pcs';
  return null;
}

const FILLERS = new Set(['купить', 'купи', 'надо', 'нужно', 'еще', 'пожалуйста', 'добавь', 'добавить', 'мне', 'так', 'же', 'потом', 'плюс', 'а', 'также']);

type Tok = { t: 'num'; milli: number } | { t: 'unit'; unit: Unit } | { t: 'word'; w: string };

function tokenize(chunk: string): Tok[] {
  const s = norm(chunk)
    .replace(/(^|\s)[x×х]\s*(\d)/g, '$1$2 шт ') // «× 3», «x3» → «3 шт»
    .replace(/(\d)([a-zа-я])/g, '$1 $2') // «2л», «500г» → «2 л», «500 г»
    .replace(/пол-?литра|полулитра/g, 'пол литра')
    .replace(/полкило/g, 'пол кило')
    .replace(/[«»"'()]/g, ' ');
  const words = s.split(/\s+/).filter((w) => w !== '');
  const out: Tok[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (/^\d+([.,]\d+)?$/.test(w)) {
      const m = parseQty(w, 'kg');
      if (m !== null) out.push({ t: 'num', milli: m });
      continue;
    }
    const whole = WHOLE_WORDS[w];
    if (whole !== undefined) {
      out.push({ t: 'num', milli: whole });
      continue;
    }
    const part = ONES[w] ?? TENS[w] ?? HUNDREDS[w];
    if (part !== undefined) {
      // «двадцать пять», «сто пятьдесят»: подряд идущие числа слов складываются (но не «два три» — это два разных числа)
      const prev = out[out.length - 1];
      const prevWordNum = prev?.t === 'num' && wordNumTail.get(prev) !== undefined;
      const tail = prev && prev.t === 'num' ? wordNumTail.get(prev) : undefined;
      if (prevWordNum && tail !== undefined && canAppend(tail, part)) {
        (prev as { milli: number }).milli += part * 1000;
        wordNumTail.set(prev as Tok, part);
      } else {
        const tok: Tok = { t: 'num', milli: part * 1000 };
        wordNumTail.set(tok, part);
        out.push(tok);
      }
      continue;
    }
    if (w === 'с' && (words[i + 1] === 'половиной' || words[i + 1] === 'половинкой') && out[out.length - 1]?.t === 'num') {
      (out[out.length - 1] as { milli: number }).milli += 500;
      i++;
      continue;
    }
    const u = unitOf(w);
    if (u) {
      out.push({ t: 'unit', unit: u });
      continue;
    }
    if (!FILLERS.has(w)) out.push({ t: 'word', w });
  }
  return out;
}

/** Хвост последнего слова-числа (нужен, чтобы «двадцать пять» сложить, а «пять двадцать» — нет). */
const wordNumTail = new WeakMap<Tok, number>();
function canAppend(prev: number, next: number): boolean {
  if (prev >= 100 && next < 100) return true; // сто → пятьдесят, сто пять
  if (prev >= 20 && prev < 100 && prev % 10 === 0 && next < 10 && next > 0) return true; // двадцать → пять
  return false;
}

interface Draft {
  name: string[];
  num: number | null;
  unit: Unit | null;
}

function finish(d: Draft): ParsedItem | null {
  const name = d.name.join(' ').trim();
  if (name === '') return null;
  const cased = (name.charAt(0).toLocaleUpperCase('ru') + name.slice(1)).slice(0, NAME_MAX).trim();
  let unit: Unit = d.unit ?? 'pcs';
  let milli = d.num ?? 1000;
  if (milli <= 0) milli = 1000;
  if (unit === 'g' || unit === 'ml') {
    milli = Math.max(1, Math.floor(milli / 1000)); // 500 г = 0,5 кг = 500 тысячных
    unit = unit === 'g' ? 'kg' : 'l';
  } else if (unit === 'pcs' && milli % 1000 !== 0) {
    unit = 'kg'; // «полтора» без единицы — штуками быть не может
  }
  return { name: cased, qtyMilli: Math.min(milli, QTY_MAX), unit: unit as ShoppingUnit };
}

function parseChunk(chunk: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  let cur: Draft = { name: [], num: null, unit: null };
  const flush = () => {
    const it = finish(cur);
    if (it) items.push(it);
    cur = { name: [], num: null, unit: null };
  };
  const hasQty = () => cur.num !== null || cur.unit !== null;
  for (const tok of tokenize(chunk)) {
    if (tok.t === 'word') {
      // «молоко 2 л хлеб …»: название после готовой пары «количество + единица» — это следующая позиция.
      // «2 л молока …»: название шло ПОСЛЕ количества — слова остаются у этой позиции.
      if (hasQty() && cur.unit !== null && cur.name.length > 0 && !qtyFirst.has(cur)) flush();
      cur.name.push(tok.w);
    } else if (tok.t === 'num') {
      if (cur.num !== null || (cur.unit !== null && cur.name.length > 0 && !qtyFirst.has(cur))) flush();
      if (cur.name.length === 0) qtyFirst.add(cur);
      cur.num = tok.milli;
    } else {
      if (cur.unit !== null) flush();
      if (cur.name.length === 0) qtyFirst.add(cur);
      cur.unit = tok.unit;
    }
  }
  flush();
  return items;
}
const qtyFirst = new WeakSet<Draft>();

/** Текст → позиции (не больше MAX_PARSED_ITEMS). Пустой или непонятный текст — пустой список. */
export function parseShoppingText(text: string): ParsedItem[] {
  const chunks = text
    .replace(/(\d),(\d)/g, '$1.$2') // десятичная запятая «1,5» — не разделитель позиций
    .split(/[,;\n]+|[.!?]+(?=\s|$)|\s+(?:и|еще|ещё|потом|плюс)\s+/i)
    .map((c) => c.trim())
    .filter((c) => c !== '');
  const out: ParsedItem[] = [];
  for (const c of chunks) {
    for (const it of parseChunk(c)) {
      out.push(it);
      if (out.length >= MAX_PARSED_ITEMS) return out;
    }
  }
  return out;
}
