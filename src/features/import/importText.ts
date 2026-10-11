import { currencyInfo } from '@/domain/currency';
import { formatMinor } from '@/domain/money';
import type { OpStatus, PlanOp, SkipCode, WalletTarget } from '@/import/types';
import { pluralRu } from '@/lib/plural';

export const SKIP_LABELS: Record<SkipCode, string> = {
  'no-date': 'Нет даты',
  zero: 'Нулевая сумма',
};

/** '2026-09-05' → '05.09.2026'. */
export function ruDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

export const opsWord = (n: number): string => pluralRu(n, 'операция', 'операции', 'операций');
export const rowsWord = (n: number): string => pluralRu(n, 'строка', 'строки', 'строк');

/** Строка про выбранный кошелёк под списком выбора. */
export function walletNote(t: WalletTarget): string {
  switch (t.kind) {
    case 'create':
      return 'Будет создан новый кошелёк, начальный остаток 0.';
    case 'blocked':
      return t.reason;
    case 'existing':
      if (t.how === 'saved') return 'Кошелёк, созданный прошлым импортом.';
      if (t.how === 'history') return 'Сюда уже попали операции этого счёта при прошлой загрузке: новые пойдут туда же.';
      if (t.how === 'name') return 'Найден у вас по названию и валюте.';
      return 'Выбран вами.';
  }
}

export const STATUS_LABELS: Record<OpStatus, { text: string; tone: 'income' | 'neutral' | 'warning' | 'danger' }> = {
  add: { text: 'Добавится', tone: 'income' },
  exists: { text: 'Уже есть', tone: 'neutral' },
  'wait-rate': { text: 'Ждёт курса', tone: 'warning' },
  review: { text: 'Нужно проверить', tone: 'warning' },
  blocked: { text: 'Нет кошелька', tone: 'danger' },
};

/** «−120,50 с.» / «+5 000 с.» / «1 090 с. → 100 $» для строки предпросмотра. */
export function opAmountText(op: PlanOp): string {
  const { outcome, income, kind } = op.row;
  if (kind === 'transfer' && outcome && income) {
    return `${formatMinor(outcome.amountMinor, outcome.account.currency)} → ${formatMinor(income.amountMinor, income.account.currency)}`;
  }
  if (kind === 'expense' && outcome) return formatMinor(-outcome.amountMinor, outcome.account.currency);
  if (kind === 'income' && income) return formatMinor(income.amountMinor, income.account.currency, { sign: 'always' });
  return '';
}

export const symbolOf = (code: string): string => currencyInfo(code).symbol;
