import type { IsoDate } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { isOwing, type DebtItem } from '@/features/debts/debtSummary';

export type AttentionKind = 'debt' | 'payment' | 'budget' | 'saving';

/** Адреса, куда ведёт строка «Требует внимания». */
export type AttentionPath = '/debts' | '/debts?dir=lent' | '/debts?dir=borrowed' | '/debts?dir=people' | '/recurring' | '/budgets' | '/wallets' | `/debts/${string}`;

export interface AttentionItem {
  /** Стабильный ключ для списка. */
  id: string;
  kind: AttentionKind;
  /** Короткая фраза для строки: «Долг просрочен: Рустам». */
  text: string;
  /** Куда ведёт нажатие: только внутренние разделы приложения (id долга кодируется, на чужой адрес ссылка не уйдёт). */
  to: AttentionPath;
  /** Красная ('danger') или жёлтая ('warning') — по важности. */
  tone: 'danger' | 'warning';
}

export interface AttentionInput {
  today: IsoDate;
  debts: readonly DebtItem[];
  /** Названия просроченных платежей (в порядке даты). */
  overduePayments: readonly string[];
  /** Названия лимитов, которые уже превышены. */
  overBudgets: readonly string[];
  /** Названия кошельков-накоплений, в которые «пора отложить». */
  savingNudges: readonly string[];
}

/** «Просрочен долг: Рустам» для одного; «Просрочено долгов: 3» для нескольких. */
function listed(one: (name: string) => string, many: (n: number) => string, names: readonly string[]): string {
  const first = names[0];
  return names.length === 1 && first !== undefined ? one(first) : many(names.length);
}

/** Несколько просроченных долгов: список той вкладки, где они все; если и «мне должны», и «я должен» — вкладка «Люди». */
function lateDebtsPath(late: readonly DebtItem[]): AttentionPath {
  const dirs = new Set(late.map((it) => it.debt.direction));
  if (dirs.size > 1) return '/debts?dir=people';
  return dirs.has('borrowed') ? '/debts?dir=borrowed' : '/debts?dir=lent';
}

/**
 * Что требует внимания на «Главной», от важного к менее важному: просроченные долги и платежи, превышенные лимиты (красным), «пора
 * отложить» (жёлтым). Пусто — всё спокойно, строки на экране нет. Чистая функция: данные читает хук useAttention.
 */
export function buildAttention(input: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];

  const lateDebts = input.debts
    .filter((it) => isOwing(it) && it.debt.dueOn !== null && it.debt.dueOn < input.today)
    .sort((a, b) => (a.debt.dueOn! < b.debt.dueOn! ? -1 : a.debt.dueOn! > b.debt.dueOn! ? 1 : 0));
  if (lateDebts.length > 0) {
    out.push({
      id: 'debts',
      kind: 'debt',
      text: listed((n) => `Долг просрочен: ${n}`, (n) => `Просрочено долгов: ${n}`, lateDebts.map((it) => it.debt.counterparty)),
      to: lateDebts.length === 1 ? `/debts/${encodeURIComponent(lateDebts[0]!.debt.id)}` : lateDebtsPath(lateDebts),
      tone: 'danger',
    });
  }

  if (input.overduePayments.length > 0) {
    out.push({
      id: 'payments',
      kind: 'payment',
      text: listed((n) => `Платёж просрочен: ${n}`, (n) => `Просрочено платежей: ${n}`, input.overduePayments),
      to: '/recurring',
      tone: 'danger',
    });
  }

  if (input.overBudgets.length > 0) {
    out.push({
      id: 'budgets',
      kind: 'budget',
      text: listed((n) => `Лимит превышен: ${n}`, (n) => `Лимитов превышено: ${n}`, input.overBudgets),
      to: '/budgets',
      tone: 'danger',
    });
  }

  if (input.savingNudges.length > 0) {
    out.push({
      id: 'saving',
      kind: 'saving',
      text: listed((n) => `Пора отложить: ${n}`, (n) => `Пора отложить: ${n} ${pluralRu(n, 'цель', 'цели', 'целей')}`, input.savingNudges),
      to: '/wallets',
      tone: 'warning',
    });
  }

  return out;
}
