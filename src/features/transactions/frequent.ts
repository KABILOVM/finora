import { isAdjustment } from '@/domain/adjustment';
import type { IsoDate, Minor, Transaction } from '@/domain/types';
import { addDays } from '@/lib/dates';

/** За сколько последних дней ищем повторяющиеся операции. */
export const FREQUENT_OPS_DAYS = 90;
/** Сколько раз операция должна повториться, чтобы считаться «частой»: одно совпадение — случайность. */
export const FREQUENT_OPS_MIN = 2;
/** Сколько частых операций показываем. */
export const FREQUENT_OPS_LIMIT = 6;

/**
 * Операция, которую вносят снова и снова: тот же вид, кошелёк, категория, сумма и заметка («Кофе», 15 с., «Карта»).
 * Не хранится нигде — считается из самих операций, поэтому одинакова на всех устройствах и не требует синхронизации.
 */
export interface FrequentOp {
  kind: 'expense' | 'income';
  walletId: string;
  categoryId: string | null;
  amountMinor: Minor;
  /** Заметка последней такой операции, как её написал человек (без пробелов по краям). */
  note: string;
  count: number;
  /** Дата последней такой операции. */
  lastOn: IsoDate;
}

type Row = Pick<
  Transaction,
  'kind' | 'walletId' | 'categoryId' | 'amountMinor' | 'note' | 'occurredOn' | 'debtId' | 'recurringRuleId' | 'fxSource'
> & { deletedAt: unknown };

/** «Кофе », «кофе» и «Кофе  с  собой» — разные записи только по смыслу, а не по регистру и пробелам. */
const normNote = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Самые частые операции за FREQUENT_OPS_DAYS дней до `today` включительно. В счёт не идут: удалённые, переводы, движение по долгам,
 * операции по расписанию (они и так проводятся сами), корректировки остатка и записи «из будущего». Порядок: чаще — выше,
 * при равенстве свежее — выше. Результат не зависит от порядка входных строк.
 */
export function frequentOps(rows: readonly Row[], today: IsoDate, limit = FREQUENT_OPS_LIMIT): FrequentOp[] {
  const since = addDays(today, -FREQUENT_OPS_DAYS);
  const groups = new Map<string, FrequentOp>();
  for (const t of rows) {
    if (t.deletedAt !== null) continue;
    if (t.kind !== 'expense' && t.kind !== 'income') continue;
    if (t.debtId !== null || t.recurringRuleId !== null || isAdjustment(t)) continue;
    if (t.occurredOn < since || t.occurredOn > today) continue;
    const note = t.note.trim();
    const key = [t.kind, t.walletId, t.categoryId ?? '', t.amountMinor, normNote(note)].join('|');
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        kind: t.kind,
        walletId: t.walletId,
        categoryId: t.categoryId,
        amountMinor: t.amountMinor,
        note,
        count: 1,
        lastOn: t.occurredOn,
      });
    } else {
      g.count++;
      if (t.occurredOn > g.lastOn) {
        g.lastOn = t.occurredOn;
        g.note = note;
      }
    }
  }
  return [...groups.entries()]
    .filter(([, g]) => g.count >= FREQUENT_OPS_MIN)
    .sort(([ka, a], [kb, b]) => b.count - a.count || (a.lastOn < b.lastOn ? 1 : a.lastOn > b.lastOn ? -1 : 0) || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .slice(0, limit)
    .map(([, g]) => g);
}
