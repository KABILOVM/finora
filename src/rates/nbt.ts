import { decodeBody, MAX_BODY_CHARS, RateParseError, boundWarnings, isFutureDate, isRateValue, normalizeDate, parseDecimal, parseNominal } from './parseUtil';
import { defaultFetch, fetchBytes, russianError, type FetchLike } from './http';
import type { ParsedRateTable, RateProvider } from './types';

/*
 * ФОРМАТ НЕ ПРОВЕРЕН НА ЖИВОМ ИСТОЧНИКЕ — разбор составлен по предположению.
 * Реальный ответ https://www.nbt.tj/en/kurs/export_xml.php в этой среде увидеть было нельзя (сеть закрыта),
 * поэтому парсер терпим к нескольким раскладкам:
 *   - записи вида <Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>10,9</Value></Valute>;
 *   - те же поля атрибутами: <Currency Code="USD" Nominal="1" Value="10.9"/>;
 *   - дата: атрибут корня (Date="10.10.2026"), дочерний <Date> или поле записи; форматы DD.MM.YYYY и YYYY-MM-DD;
 *   - десятичная запятая или точка; Nominal «за N единиц» (курс = Value / Nominal).
 * Если реальный формат окажется другим — тест на фикстурах останется зелёным, а живой запрос упадёт с понятной ошибкой
 * (не найдено ни одного курса / нет даты). Что проверить человеку — см. отчёт.
 *
 * Блок между маркерами SHARED:nbt ДОСЛОВНО скопирован в supabase/functions/fetch-rates/index.ts.
 * Правишь здесь — правь и там; тест edge.test.ts сравнит текст.
 */

// <<< SHARED:nbt
interface XNode {
  name: string;
  attrs: Map<string, string>;
  children: XNode[];
  text: string;
}

const MAX_XML_DEPTH = 64;
/** Настоящий ответ — сотни элементов; десятки тысяч значат мусор или атаку, а память браузера не резиновая. */
const MAX_XML_NODES = 100_000;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Только пять стандартных сущностей и числовые коды. Пользовательские <!ENTITY> НЕ раскрываем (защита от «бомб»). */
function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole: string, body: string) => {
    if (body.startsWith('#')) {
      const cp = body.charAt(1).toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      const ok = Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
      return ok ? String.fromCodePoint(cp) : '';
    }
    return ENTITIES[body] ?? whole;
  });
}

const isSpace = (c: string): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
const normKey = (s: string): string => s.toLowerCase().replace(/[\s_\-:.]/g, '');
const localName = (s: string): string => s.slice(s.lastIndexOf(':') + 1).toLowerCase();

/** Разбор открывающего тега, начинающегося в позиции lt. Не падает на кривой разметке. */
function readStartTag(xml: string, lt: number) {
  const n = xml.length;
  let i = lt + 1;
  while (i < n && !isSpace(xml.charAt(i)) && xml.charAt(i) !== '/' && xml.charAt(i) !== '>') i++;
  const name = localName(xml.slice(lt + 1, i));
  const attrs = new Map<string, string>();
  let selfClosing = false;
  while (i < n) {
    const ch = xml.charAt(i);
    if (ch === '>') {
      i++;
      break;
    }
    if (ch === '/') {
      if (xml.charAt(i + 1) === '>') {
        selfClosing = true;
        i += 2;
        break;
      }
      i++;
      continue;
    }
    if (isSpace(ch)) {
      i++;
      continue;
    }
    const keyStart = i;
    while (i < n && !isSpace(xml.charAt(i)) && !'=/>'.includes(xml.charAt(i))) i++;
    const key = normKey(localName(xml.slice(keyStart, i))); // префикс пространства имён (n:Date) отбрасываем
    while (i < n && isSpace(xml.charAt(i))) i++;
    let value = '';
    if (xml.charAt(i) === '=') {
      i++;
      while (i < n && isSpace(xml.charAt(i))) i++;
      const q = xml.charAt(i);
      if (q === '"' || q === "'") {
        const close = xml.indexOf(q, i + 1);
        value = xml.slice(i + 1, close < 0 ? n : close);
        i = close < 0 ? n : close + 1;
      } else {
        const valueStart = i;
        while (i < n && !isSpace(xml.charAt(i)) && xml.charAt(i) !== '>') i++;
        value = xml.slice(valueStart, i);
      }
    }
    if (key !== '' && !attrs.has(key)) attrs.set(key, decodeEntities(value));
  }
  return { name, attrs, selfClosing, end: i };
}

/** Пропускает <!DOCTYPE ...> (в том числе с [внутренним подмножеством]) и прочие <!...>. */
function skipDeclaration(xml: string, lt: number): number {
  let depth = 0;
  for (let i = lt + 2; i < xml.length; i++) {
    const c = xml.charAt(i);
    if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    else if (c === '>' && depth === 0) return i + 1;
  }
  return xml.length;
}

/** Маленький сканер вместо DOMParser: одинаков в браузере, Node и Deno. Терпит незакрытые и лишние теги. */
function scanXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: new Map(), children: [], text: '' };
  const stack: XNode[] = [root];
  const n = xml.length;
  let i = 0;
  let nodes = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const top = stack[stack.length - 1] ?? root;
    if (lt < 0) {
      top.text += decodeEntities(xml.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      top.text += xml.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
    } else if (xml.startsWith('<?', lt)) {
      const e = xml.indexOf('?>', lt + 2);
      i = e < 0 ? n : e + 2;
    } else if (xml.startsWith('<!', lt)) {
      i = skipDeclaration(xml, lt);
    } else if (xml.charAt(lt + 1) === '/') {
      const gt = xml.indexOf('>', lt + 2);
      const name = localName(xml.slice(lt + 2, gt < 0 ? n : gt).trim());
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k]?.name === name) {
          stack.length = k;
          break;
        }
      }
      i = gt < 0 ? n : gt + 1;
    } else if (!/[A-Za-z_:]/.test(xml.charAt(lt + 1))) {
      top.text += '<'; // одинокий «<» внутри текста
      i = lt + 1;
    } else {
      if (++nodes > MAX_XML_NODES) throw new RateParseError('Слишком много элементов в XML');
      const tag = readStartTag(xml, lt);
      const node: XNode = { name: tag.name, attrs: tag.attrs, children: [], text: '' };
      top.children.push(node);
      if (!tag.selfClosing) {
        stack.push(node);
        if (stack.length > MAX_XML_DEPTH) throw new RateParseError('Слишком глубокая вложенность XML');
      }
      i = tag.end;
    }
  }
  return root;
}

// Имена полей (после normKey) в порядке предпочтения. Это ПРЕДПОЛОЖЕНИЯ о разметке, см. шапку файла.
const CODE_KEYS = ['charcode', 'isocode', 'code', 'iso', 'currencycode', 'currency', 'ccy', 'cur', 'curr'];
const VALUE_KEYS = ['value', 'rate', 'kurs', 'officialrate', 'official', 'val', 'курс'];
const NOMINAL_KEYS = ['nominal', 'scale', 'units', 'unit', 'quantity', 'номинал'];
const DATE_KEYS = ['date', 'valdate', 'asof', 'ondate', 'ratedate', 'дата'];

/** Поля элемента: его атрибуты + текст дочерних элементов-«листьев». Первое значение имени побеждает. */
function fieldsOf(node: XNode): Map<string, string> {
  const f = new Map<string, string>(node.attrs);
  for (const c of node.children) {
    const key = normKey(c.name);
    if (c.children.length === 0 && !f.has(key)) f.set(key, c.text.trim());
  }
  return f;
}

function pickFirst(f: Map<string, string>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = f.get(k);
    if (v !== undefined) return v;
  }
  return undefined;
}

function pickCode(f: Map<string, string>): string | undefined {
  for (const k of CODE_KEYS) {
    const v = f.get(k)?.trim();
    if (v !== undefined && /^[A-Za-z]{3}$/.test(v)) return v.toUpperCase();
  }
  return undefined;
}

interface RawRecord {
  code: string;
  valueRaw: string;
  nominalRaw: string | undefined;
}

interface Collected {
  records: RawRecord[];
  dates: string[];
  warnings: string[];
}

function visit(node: XNode, out: Collected): void {
  const f = fieldsOf(node);
  const dateRaw = pickFirst(f, DATE_KEYS);
  if (dateRaw !== undefined) out.dates.push(dateRaw);
  const valueRaw = pickFirst(f, VALUE_KEYS);
  if (valueRaw !== undefined) {
    const code = pickCode(f);
    if (code !== undefined) {
      out.records.push({ code, valueRaw, nominalRaw: pickFirst(f, NOMINAL_KEYS) });
      return; // внутрь записи не заходим
    }
    const anyCode = (pickFirst(f, CODE_KEYS) ?? '').trim();
    if (anyCode !== '') {
      out.warnings.push(`Пропущена запись с кодом «${anyCode.slice(0, 20)}»: нужен буквенный код из 3 букв`);
      return;
    }
  }
  for (const c of node.children) visit(c, out);
}

/**
 * XML Нацбанка → RateTable (pivot 'TJS', perUnit[TJS] = 1, perUnit[X] = Value / Nominal).
 * Бросает RateParseError: пустой ответ, HTML вместо XML, нет даты или дата из будущего, нет ни одного корректного курса.
 * Мусорные записи (ноль, минус, не число, дубли кодов) отбрасываются и описываются в `warnings`; при дубле берётся первая запись.
 */
export function parseNbtXml(xml: string, now: Date = new Date()): ParsedRateTable {
  if (typeof xml !== 'string') throw new RateParseError('Ожидался текст XML');
  const text = xml.replace(/^﻿/, '');
  if (text.trim() === '') throw new RateParseError('Пустой ответ');
  if (text.length > MAX_BODY_CHARS) throw new RateParseError('Ответ слишком большой');
  if (/<!doctype\s+html|<html[\s>]/i.test(text.slice(0, 3000))) {
    throw new RateParseError('Получен HTML, а не XML (страница ошибки, блокировка или перенаправление)');
  }
  const root = scanXml(text);
  if (root.children.length === 0) throw new RateParseError('Ответ не похож на XML');

  const found: Collected = { records: [], dates: [], warnings: [] };
  visit(root, found);
  const warnings = found.warnings;
  if (found.records.length === 0) {
    throw new RateParseError(`Не найдено ни одного курса${warnings[0] ? `: ${warnings[0]}` : ''}`);
  }

  const dates = new Set<string>();
  let badDate: string | undefined;
  for (const raw of found.dates) {
    const d = normalizeDate(raw);
    if (d) dates.add(d);
    else badDate ??= raw;
  }
  if (dates.size === 0) {
    throw new RateParseError(badDate === undefined ? 'В ответе нет даты курсов' : `Не удалось разобрать дату «${badDate.slice(0, 30)}»`);
  }
  if (dates.size > 1) throw new RateParseError(`В ответе несколько разных дат курсов: ${[...dates].sort().join(', ')}`);
  const asOf = [...dates][0] as string;
  if (isFutureDate(asOf, now)) throw new RateParseError(`Дата курсов ${asOf} из будущего`);

  const taken = new Map<string, number>();
  const seen = new Set<string>();
  for (const r of found.records) {
    if (r.code === 'TJS') continue; // опорная валюта, её курс всегда 1
    if (seen.has(r.code)) {
      warnings.push(`Дубль ${r.code}: повторная запись проигнорирована, взята первая`);
      continue;
    }
    seen.add(r.code);
    const value = parseDecimal(r.valueRaw);
    if (value === null || !(value > 0)) {
      warnings.push(`${r.code}: некорректное значение «${r.valueRaw.slice(0, 30)}», запись отброшена`);
      continue;
    }
    const nominal = r.nominalRaw === undefined ? 1 : parseNominal(r.nominalRaw); // номинал — целое: '10,000' это 10000, а не 10
    if (nominal === null || !(nominal > 0)) {
      warnings.push(`${r.code}: некорректный Nominal «${(r.nominalRaw ?? '').slice(0, 30)}», запись отброшена`);
      continue;
    }
    const perUnit = value / nominal;
    if (!isRateValue(perUnit)) {
      warnings.push(`${r.code}: курс ${perUnit} вне допустимых границ, запись отброшена`);
      continue;
    }
    taken.set(r.code, perUnit);
  }
  if (taken.size === 0) {
    throw new RateParseError(`Не найдено ни одного корректного курса${warnings[0] ? `: ${warnings[0]}` : ''}`);
  }
  const perUnit: Record<string, number> = { TJS: 1 };
  for (const code of [...taken.keys()].sort()) perUnit[code] = taken.get(code) as number;
  return { asOf, pivot: 'TJS', perUnit, source: 'nbt', fetchedAt: now.toISOString(), warnings: boundWarnings(warnings) };
}
// SHARED:nbt >>>

/** Адрес из задания; НЕ ПРОВЕРЕН. Параметры (дата и т.п.) намеренно не добавлены: формата запроса мы не знаем. */
export const NBT_URL = 'https://www.nbt.tj/en/kurs/export_xml.php';

export interface NbtProviderOptions {
  url?: string;
  now?: () => Date;
}

/**
 * Курсы Нацбанка напрямую из браузера. ВНИМАНИЕ: пока не проверено, отдаёт ли nbt.tj заголовки CORS; если нет —
 * этот провайдер в браузере всегда будет падать, а курсы придут через server (Edge-функция fetch-rates).
 */
export function nbtProvider(fetchImpl: FetchLike = defaultFetch, options: NbtProviderOptions = {}): RateProvider {
  const url = options.url ?? NBT_URL;
  return {
    id: 'nbt',
    async fetchLatest(signal) {
      let got: Awaited<ReturnType<typeof fetchBytes>>;
      try {
        got = await fetchBytes(fetchImpl, url, signal);
      } catch (e) {
        throw russianError(e); // «Failed to fetch» и подобное наружу не выходит
      }
      return parseNbtXml(decodeBody(got.bytes, got.contentType), options.now?.() ?? new Date());
    },
  };
}
