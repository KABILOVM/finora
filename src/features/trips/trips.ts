import { summarizeDay, type CategoryTotal } from '@/db';
import { isAdjustment } from '@/domain/adjustment';
import { daysBetween, floorDiv } from '@/domain/forecast';
import { addMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, Minor, Transaction, UUID } from '@/domain/types';
import { isSpend, type AnomalyTx } from '@/features/analytics/anomalies';
import { NOTE_MAX } from '@/features/transactions/txForm';

/**
 * Поездки. Поездка — это метка `#Самарканд` в заметках операций: никакой новой таблицы и ничего в облаке, метки уже ездят вместе с
 * операциями между устройствами, а «режим поездки» (новые операции получают метку сами) — настройка устройства (activeTrip.ts).
 * Отчёт по поездке собирается из всех операций с этой меткой: сколько потрачено, сколько дней, по категориям, по дням, по валютам.
 * ЧИСТЫЕ функции (без React и базы); суммы — по снимкам в основной валюте, как в «Аналитике».
 */

/** Метка: `#` и 2–40 букв, цифр, `_` или `-` (в заметке перед ней пробел или начало строки). */
export const TAG_MIN = 2;
export const TAG_MAX = 40;
const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]{2,40})(?![\p{L}\p{N}_-])/gu;

export type TripTx = AnomalyTx &
  Pick<Transaction, 'amountMinor' | 'toWalletId' | 'createdAt'> & {
    /** Сколько зачислено на кошелёк «куда» (у перевода). Нет — как у старых строк: считаем равным списанию. */
    toAmountMinor?: Minor | null | undefined;
    /** «Сумма в валюте» траты, оплаченной картой в другой валюте (например, 50 AED, а карта в сомони). */
    foreignCurrency?: CurrencyCode | null | undefined;
    foreignAmountMinor?: Minor | null | undefined;
  };

/** Ключ метки: без регистра и «ё», чтобы `#Самарканд` и `#самарканд` были одной поездкой. */
export const tagKey = (tag: string): string => tag.toLocaleLowerCase('ru').replace(/ё/g, 'е');

/** «Поездка в Самарканд» → `Поездка_в_Самарканд`; null — из названия метку не сделать (пусто, короче двух знаков, слишком длинное). */
export function tagFromName(name: string): string | null {
  const cleaned = name.replace(/[^\p{L}\p{N}\s_-]/gu, ' ').trim().replace(/\s+/g, '_');
  const tag = cleaned.replace(/^[_-]+|[_-]+$/g, '');
  return tag.length >= TAG_MIN && tag.length <= TAG_MAX ? tag : null;
}

/** `Поездка_в_Самарканд` → «Поездка в Самарканд» (как показываем человеку). */
export const tagLabel = (tag: string): string => tag.replace(/_/g, ' ');

/** Метки из заметки в порядке появления (с исходным написанием). */
export function tagsOf(note: string): string[] {
  const out: string[] = [];
  for (const m of note.matchAll(TAG_RE)) out.push(m[2]!);
  return out;
}

/** Заметка без меток (как показываем в списках поездки, где метка и так в заголовке). */
export const withoutTags = (note: string): string => note.replace(TAG_RE, '$1').replace(/\s+/g, ' ').trim();

export const hasTag = (note: string, tag: string): boolean => tagsOf(note).some((t) => tagKey(t) === tagKey(tag));

/** Заметка без этой метки (все её вхождения, с любым регистром и «ё»); остальные метки и слова остаются. Лишние пробелы сворачиваются. */
export const withoutTag = (note: string, tag: string): string =>
  note
    .replace(TAG_RE, (whole, lead: string, found: string) => (tagKey(found) === tagKey(tag) ? lead : whole))
    .replace(/\s+/g, ' ')
    .trim();

/** Заметка с меткой в конце (`кофе #Самарканд`). Метка уже есть или заметка стала бы длиннее предела — заметка как есть. */
export function withTag(note: string, tag: string | null): string {
  if (tag === null || hasTag(note, tag)) return note;
  const base = note.trim();
  const next = base === '' ? `#${tag}` : `${base} #${tag}`;
  return next.length > NOTE_MAX ? note : next;
}

export interface TripInfo {
  /** tagKey метки. */
  key: string;
  /** Как показываем: самое частое написание метки без «_». */
  label: string;
  /** Метка как в заметках (для новых операций). */
  tag: string;
  firstOn: IsoDate;
  lastOn: IsoDate;
  /** Сколько операций с меткой (любых: расходы, доходы, переводы). */
  count: number;
  /** Расходы по снимкам в основной валюте. */
  expenseMinor: Minor;
}

const live = (t: TripTx): boolean => t.deletedAt === null && !isAdjustment(t) && (t.debtId ?? null) === null;

/**
 * Все поездки по меткам в заметках: недавние первыми (по дате последней операции). Расходы — только настоящие траты основной валюты
 * (isSpend); остальные операции с меткой (доходы, переводы) считаются в `count`, но в сумму не входят.
 */
export function listTrips(txs: readonly TripTx[], base: CurrencyCode): TripInfo[] {
  const groups = new Map<string, { spellings: Map<string, number>; txs: TripTx[] }>();
  for (const t of txs) {
    if (!live(t)) continue;
    const seen = new Set<string>();
    for (const tag of tagsOf(t.note)) {
      const key = tagKey(tag);
      if (seen.has(key)) continue;
      seen.add(key);
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { spellings: new Map(), txs: [] }));
      g.spellings.set(tag, (g.spellings.get(tag) ?? 0) + 1);
      g.txs.push(t);
    }
  }
  const out: TripInfo[] = [];
  for (const [key, g] of groups) {
    const tag = [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
    let firstOn = g.txs[0]!.occurredOn;
    let lastOn = firstOn;
    let expenseMinor = 0;
    for (const t of g.txs) {
      if (t.occurredOn < firstOn) firstOn = t.occurredOn;
      if (t.occurredOn > lastOn) lastOn = t.occurredOn;
      if (isSpend(t, base)) expenseMinor = addMinor(expenseMinor, t.baseAmountMinor);
    }
    out.push({ key, label: tagLabel(tag), tag, firstOn, lastOn, count: g.txs.length, expenseMinor });
  }
  return out.sort((a, b) => (a.lastOn < b.lastOn ? 1 : a.lastOn > b.lastOn ? -1 : a.key < b.key ? -1 : 1));
}

export interface TripDay {
  date: IsoDate;
  expenseMinor: Minor;
}

export interface TripReport extends TripInfo {
  /** Сколько календарных дней от первой до последней операции включительно. */
  days: number;
  /** Расходы в день: всего ÷ дней, вниз до целого. */
  perDayMinor: Minor;
  /** Расходы по категориям, от большего к меньшему (комиссии переводов — отдельной строкой). */
  byCategory: CategoryTotal[];
  /** Расходы по дням (только дни с расходами), по возрастанию дат. */
  byDay: TripDay[];
  /** Самые крупные траты (до пяти). */
  biggest: { txId: UUID; categoryId: UUID | null; note: string; amountMinor: Minor; occurredOn: IsoDate }[];
  /**
   * Расходы по валютам («в долларах 120»): то, что человек реально платил. Оплата картой в другой валюте считается в валюте чека
   * («50 AED»), а сколько с карты списано — в `charged` (есть только у таких валют).
   */
  byCurrency: { currency: CurrencyCode; minor: Minor; charged?: { currency: CurrencyCode; minor: Minor }[] }[];
  /** Операций с меткой, но в другой основной валюте (в сумму не вошли). */
  excludedCount: number;
}

/** Отчёт по поездке `key`; null — операций с такой меткой нет. `currencyOf` — валюта кошелька по id (нет — основная). */
export function tripReport(txs: readonly TripTx[], key: string, base: CurrencyCode, currencyOf: ReadonlyMap<UUID, CurrencyCode>): TripReport | null {
  const info = listTrips(txs, base).find((t) => t.key === key);
  if (!info) return null;
  const mine = txs.filter((t) => live(t) && tagsOf(t.note).some((x) => tagKey(x) === key));
  const summary = summarizeDay(mine, base);
  const spends = mine.filter((t) => isSpend(t, base));
  const days = daysBetween(info.firstOn, info.lastOn) + 1;

  const byDayMap = new Map<IsoDate, Minor>();
  for (const t of spends) byDayMap.set(t.occurredOn, addMinor(byDayMap.get(t.occurredOn) ?? 0, t.baseAmountMinor));
  const byDay = [...byDayMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, expenseMinor]) => ({ date, expenseMinor }));

  const currencies = new Map<CurrencyCode, { minor: Minor; charged: Map<CurrencyCode, Minor> }>();
  for (const t of spends) {
    const walletCurrency = currencyOf.get(t.walletId) ?? base;
    const fc = t.foreignCurrency ?? null;
    const fa = t.foreignAmountMinor ?? null;
    const onReceipt = fc !== null && fa !== null;
    const currency = onReceipt ? fc : walletCurrency;
    const entry = currencies.get(currency) ?? { minor: 0, charged: new Map<CurrencyCode, Minor>() };
    entry.minor = addMinor(entry.minor, onReceipt ? fa : t.amountMinor);
    if (onReceipt) entry.charged.set(walletCurrency, addMinor(entry.charged.get(walletCurrency) ?? 0, t.amountMinor));
    currencies.set(currency, entry);
  }
  const byCurrency = [...currencies.entries()]
    .map(([currency, e]) => ({
      currency,
      minor: e.minor,
      ...(e.charged.size > 0 ? { charged: [...e.charged.entries()].map(([c, minor]) => ({ currency: c, minor })) } : {}),
    }))
    .sort((a, b) => Number(b.currency === base) - Number(a.currency === base) || (a.currency < b.currency ? -1 : 1));

  const biggest = [...spends]
    .filter((t) => t.baseAmountMinor > 0)
    .sort((a, b) => b.baseAmountMinor - a.baseAmountMinor || (a.id < b.id ? -1 : 1))
    .slice(0, 5)
    .map((t) => ({ txId: t.id, categoryId: t.categoryId, note: withoutTags(t.note), amountMinor: t.baseAmountMinor, occurredOn: t.occurredOn }));

  return {
    ...info,
    days,
    perDayMinor: floorDiv(summary.expenseMinor, days),
    byCategory: summary.byCategory,
    byDay,
    biggest,
    byCurrency,
    excludedCount: summary.excludedCount,
  };
}
