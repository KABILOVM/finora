import { parseAmountToMinor } from '@/domain/money';
import type { CategoryKind, CurrencyCode, IsoDate, Minor } from '@/domain/types';
import { addDays } from '@/lib/dates';
import { normNote, type NoteEntry } from './noteSuggest';

/**
 * «Ввод одной строкой»: в заметке пишете «такси 20 карта» — из строки достаются сумма, кошелёк, категория и (по желанию) дата.
 * Разбор на устройстве, без интернета и без ИИ, и только по правилам ниже: он предлагает, а не решает за человека
 * (подставляется после нажатия на подсказку).
 */

export interface QuickWallet {
  id: string;
  name: string;
  currency: CurrencyCode;
}

export interface QuickCategory {
  id: string;
  name: string;
  kind: CategoryKind;
  archivedAt: unknown;
}

export interface QuickLineContext {
  /** Кошельки, в которые можно вносить (без архивных). */
  wallets: readonly QuickWallet[];
  /** Категории (архивные в подстановку не идут). */
  categories: readonly QuickCategory[];
  /** Заметки из истории (см. noteSuggest): по ним определяется привычная категория и кошелёк. */
  noteIndex: readonly NoteEntry[];
  /** Вид операции в форме: только расход или доход. */
  kind: string;
  /** Кошелёк, выбранный в форме сейчас: по его валюте читается сумма, если в строке кошелёк не назван. */
  currentWalletId: string | null;
  today: IsoDate;
}

export interface QuickLine {
  /** Что осталось от строки после сумм, кошелька и даты (может быть пустым). */
  note: string;
  amountMinor: Minor;
  /** Кошелёк из строки или привычный для такой заметки; null — не определён (остаётся выбранный в форме). */
  walletId: string | null;
  /** Категория по названию в строке или по истории; null — не определена (остаётся выбранная в форме). */
  categoryId: string | null;
  /** Дата из слов «сегодня», «вчера», «позавчера»; null — слов нет (остаётся выбранная в форме). */
  date: IsoDate | null;
}

const DATE_WORDS: Record<string, number> = { сегодня: 0, вчера: -1, позавчера: -2 };

/** Число: цифры с одной запятой или точкой; «2к» и «1.5k» — тысячи. Всё остальное числом не считается. */
const NUMBER = /^(\d+(?:[.,]\d+)?)([кk]?)$/i;

/** Слово для сравнения с названием: без регистра, «ё» как «е», без точки на конце («нал.»). */
const word = (s: string): string => normNote(s).replace(/\.$/, '');

function readAmount(token: string, currency: CurrencyCode): Minor | null {
  const m = NUMBER.exec(token);
  if (!m) return null;
  const base = parseAmountToMinor(m[1]!, currency);
  if (base === null) return null;
  const minor = m[2] ? base * 1000 : base;
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/**
 * Пытается прочитать строку. Условия, чтобы вообще что-то предложить: вид — расход или доход; в строке ровно одно число
 * (два числа — неясно, какое сумма) и хотя бы ещё одно слово. Иначе null, и заметка остаётся обычной заметкой.
 */
export function parseQuickLine(text: string, ctx: QuickLineContext): QuickLine | null {
  if (ctx.kind !== 'expense' && ctx.kind !== 'income') return null;
  const tokens = text.trim().split(/\s+/).filter((t) => t !== '');
  if (tokens.length < 2) return null;
  const kind: 'expense' | 'income' = ctx.kind;

  const numberAt = tokens.flatMap((t, i) => (NUMBER.test(t) ? [i] : []));
  if (numberAt.length !== 1) return null;
  const amountIndex = numberAt[0]!;
  const used = new Set<number>([amountIndex]);

  // дата: «вчера» и т. п. (первое подходящее слово)
  let date: IsoDate | null = null;
  for (let i = 0; i < tokens.length && date === null; i++) {
    const shift = used.has(i) ? undefined : DATE_WORDS[word(tokens[i]!)];
    if (shift !== undefined) {
      date = addDays(ctx.today, shift);
      used.add(i);
    }
  }

  // кошелёк: сначала самое длинное совпадение по полному названию, потом одиночное слово — начало названия (от 3 букв, если оно одно такое)
  let walletId: string | null = null;
  const walletsNorm = ctx.wallets.map((w) => ({ w, n: word(w.name) }));
  outer: for (let len = Math.min(3, tokens.length); len >= 1; len--) {
    for (let i = 0; i + len <= tokens.length; i++) {
      const span = Array.from({ length: len }, (_, k) => i + k);
      if (span.some((k) => used.has(k))) continue;
      const q = word(span.map((k) => tokens[k]).join(' '));
      const exact = walletsNorm.filter((x) => x.n === q);
      const hit = exact.length > 0 ? exact : len === 1 && q.length >= 3 ? walletsNorm.filter((x) => x.n.startsWith(q)) : [];
      if (hit.length === 1) {
        walletId = hit[0]!.w.id;
        span.forEach((k) => used.add(k));
        break outer;
      }
    }
  }

  const walletById = new Map(ctx.wallets.map((w) => [w.id, w]));
  const currencyOf = (id: string | null): CurrencyCode | undefined => (id === null ? undefined : walletById.get(id)?.currency);
  const currency = currencyOf(walletId) ?? currencyOf(ctx.currentWalletId) ?? ctx.wallets[0]?.currency;
  if (currency === undefined) return null;
  const amountMinor = readAmount(tokens[amountIndex]!, currency);
  if (amountMinor === null) return null;

  const restIdx = tokens.map((_, i) => i).filter((i) => !used.has(i));
  const rest = restIdx.map((i) => tokens[i]!).join(' ');
  const restNorm = normNote(rest);

  const categories = ctx.categories.filter((c) => c.kind === kind && c.archivedAt === null);
  const categoryByName = (q: string) => {
    const hit = categories.filter((c) => word(c.name) === q);
    return hit.length === 1 ? hit[0]! : undefined;
  };

  let note = rest;
  let categoryId: string | null = null;
  const whole = restNorm === '' ? undefined : categoryByName(restNorm);
  if (whole) {
    // «еда 30»: слово и есть категория, дублировать его в заметке незачем
    categoryId = whole.id;
    note = '';
  } else if (restNorm !== '') {
    // привычная категория (и кошелёк) для такой заметки: самая частая из истории, при равенстве — свежая
    const known = ctx.noteIndex
      .filter((e) => e.kind === kind && e.norm === restNorm && (e.categoryId === null || categories.some((c) => c.id === e.categoryId)))
      .sort((a, b) => b.count - a.count || (a.lastOn < b.lastOn ? 1 : a.lastOn > b.lastOn ? -1 : 0))[0];
    if (known) {
      categoryId = known.categoryId;
      if (walletId === null && walletById.has(known.walletId)) walletId = known.walletId;
    } else {
      // слово из строки совпало с названием категории: «такси в аэропорт 50» при категории «Такси»
      const byWord = restIdx.map((i) => categoryByName(word(tokens[i]!))).find((c) => c !== undefined);
      if (byWord) categoryId = byWord.id;
    }
  }

  return { note, amountMinor, walletId, categoryId, date };
}
