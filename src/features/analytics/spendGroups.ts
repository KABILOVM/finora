import { addMinor } from '@/domain/money';
import type { CurrencyCode, Minor } from '@/domain/types';
import { tagKey, tagLabel, tagsOf, withoutTags } from '@/features/trips/trips';
import { isSpend, type AnomalyTx } from './anomalies';

/**
 * «Куда уходят деньги»: расходы месяца, сложенные по заметке, кошельку и метке. Чистые расчёты (без React и базы).
 * Берутся те же траты, что в «Самых крупных расходах»: не удалённые расходы в основной валюте, без долгов и корректировок
 * (isSpend); суммы — по снимкам в основной валюте. Комиссии переводов сюда не входят: у них нет ни заметки, ни метки, а по кошелькам
 * «расход» в списке операций (на него ведёт строка кошелька) комиссий не содержит; они видны отдельной строкой в категориях.
 * Бросают RangeError, если суммы не помещаются в безопасное целое — экран тогда пишет «суммы слишком большие».
 */

export type SpendTx = AnomalyTx;

export interface SpendGroup {
  /** Ключ группы: нормализованная заметка, id кошелька или ключ метки. */
  key: string;
  /** Как показать: чаще всего встречавшееся написание (при равенстве — позднее). */
  label: string;
  totalMinor: Minor;
  /** Сколько операций в группе. */
  count: number;
}

/** Заметка (без меток) должна встретиться в месяце не меньше стольких раз, чтобы стать строкой: единичные траты уже видны в «Самых крупных». */
export const MIN_NOTE_REPEATS = 2;

/** Расходы месяца `month` (все дни, как в «Самых крупных расходах»). */
function monthSpends(txs: readonly SpendTx[], month: string, base: CurrencyCode): SpendTx[] {
  const prefix = `${month}-`;
  return txs.filter((t) => isSpend(t, base) && t.occurredOn.startsWith(prefix));
}

/** Все расходы месяца вместе: от них считаются доли. */
export function spendTotal(txs: readonly SpendTx[], month: string, base: CurrencyCode): Minor {
  return monthSpends(txs, month, base).reduce((sum, t) => addMinor(sum, t.baseAmountMinor), 0);
}

const byRank = (a: SpendGroup, b: SpendGroup): number =>
  b.totalMinor - a.totalMinor || b.count - a.count || a.label.localeCompare(b.label, 'ru') || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * Копит суммы по ключу. label — самое частое написание; при равенстве — то, что встретилось позже по дате (в списке операций новое
 * написание человек обычно и хочет видеть).
 */
class Accumulator {
  private readonly groups = new Map<string, { total: Minor; count: number; spellings: Map<string, { n: number; last: string }> }>();

  add(key: string, spelling: string, minor: Minor, date: string): void {
    const g = this.groups.get(key) ?? { total: 0, count: 0, spellings: new Map() };
    g.total = addMinor(g.total, minor);
    g.count += 1;
    const s = g.spellings.get(spelling) ?? { n: 0, last: '' };
    s.n += 1;
    if (date > s.last) s.last = date;
    g.spellings.set(spelling, s);
    this.groups.set(key, g);
  }

  result(label: (spelling: string) => string, minCount = 1): SpendGroup[] {
    const out: SpendGroup[] = [];
    for (const [key, g] of this.groups) {
      if (g.count < minCount) continue;
      const best = [...g.spellings.entries()].sort(([an, a], [bn, b]) => b.n - a.n || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) || (an < bn ? -1 : 1))[0];
      out.push({ key, label: label(best?.[0] ?? key), totalMinor: g.total, count: g.count });
    }
    return out.sort(byRank);
  }
}

/** Заметка без меток и лишних пробелов: по ней и сравниваем, и показываем. */
const plainNote = (note: string): string => withoutTags(note);

/** Ключ заметки для сравнения: без регистра и «ё» (так же, как у меток). */
const noteKey = (note: string): string => tagKey(note);

/**
 * По заметке: «такси», «базар» — все такие траты месяца вместе (без учёта регистра и «ё»; метки `#…` из заметки не в счёт).
 * Только заметки, что встретились не меньше MIN_NOTE_REPEATS раз; траты без заметки в группы не входят.
 */
export function spendByNote(txs: readonly SpendTx[], month: string, base: CurrencyCode): SpendGroup[] {
  const acc = new Accumulator();
  for (const t of monthSpends(txs, month, base)) {
    const note = plainNote(t.note);
    if (note === '') continue;
    acc.add(noteKey(note), note, t.baseAmountMinor, t.occurredOn);
  }
  return acc.result((s) => s, MIN_NOTE_REPEATS);
}

/**
 * По метке `#…` в заметке (поездки и любые свои): траты из разных категорий, собранные одной меткой. Метки без учёта регистра и «ё».
 * У траты бывает несколько меток — тогда она входит в каждую из них, поэтому суммы меток могут вместе превышать расходы месяца.
 */
export function spendByTag(txs: readonly SpendTx[], month: string, base: CurrencyCode): SpendGroup[] {
  const acc = new Accumulator();
  for (const t of monthSpends(txs, month, base)) {
    const seen = new Set<string>(); // одна и та же метка дважды в заметке — одна трата в группе
    for (const tag of tagsOf(t.note)) {
      const key = tagKey(tag);
      if (seen.has(key)) continue;
      seen.add(key);
      acc.add(key, tag, t.baseAmountMinor, t.occurredOn);
    }
  }
  return acc.result((s) => `#${tagLabel(s)}`);
}

/** По кошельку: сколько ушло с каждого. Название кошелька подставляет вызывающий (его нет в операции). */
export function spendByWallet(txs: readonly SpendTx[], month: string, base: CurrencyCode, walletName: (walletId: string) => string): SpendGroup[] {
  const acc = new Accumulator();
  for (const t of monthSpends(txs, month, base)) acc.add(t.walletId, t.walletId, t.baseAmountMinor, t.occurredOn);
  return acc.result((id) => walletName(id));
}

/** Строка запроса для ссылки на расходы с этой меткой за месяц: `/transactions?${tagSpendQuery(…)}` (key — ключ группы: без регистра и «ё»). */
export const tagSpendQuery = (month: string, key: string): string => new URLSearchParams({ month, tag: key, kind: 'expense' }).toString();

/** Строка запроса для ссылки на расходы этого кошелька за месяц: `/transactions?${walletSpendQuery(…)}` (адрес в самой ссылке фиксирован). */
export const walletSpendQuery = (month: string, walletId: string): string => new URLSearchParams({ month, wallet: walletId, kind: 'expense' }).toString();
