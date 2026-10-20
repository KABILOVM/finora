import { currencyInfo } from '@/domain/currency';
import { formatMinor } from '@/domain/money';
import { categoryKey } from '@/import/ids';
import type { ImportPlan, IssueCode, OpStatus, PlanOp, PlanWallet, SkipCode, WalletTarget } from '@/import/types';
import { pluralRu } from '@/lib/plural';

export const SKIP_LABELS: Record<SkipCode, string> = {
  'no-date': 'Нет даты',
  zero: 'Нулевая сумма',
};

/** Причины «Нужно проверить» заголовками групп: когда таких строк много, они собираются по причине. */
export const ISSUE_LABELS: Record<IssueCode, string> = {
  columns: 'Не совпало число столбцов',
  date: 'Непонятная дата',
  'date-range': 'Дата вне допустимых пределов',
  'amount-unreadable': 'Сумма не читается',
  'amount-ambiguous': 'Неоднозначная сумма',
  'amount-precision': 'Больше знаков после запятой, чем у валюты',
  'amount-negative': 'Отрицательная сумма',
  'amount-big': 'Слишком большая сумма',
  currency: 'Непонятная валюта',
  account: 'Не указан счёт',
  'same-account': 'Перевод на тот же счёт',
  'creates-money': 'Зачислено больше, чем списано',
  'same-wallet': 'Один кошелёк на обе стороны перевода',
  'fx-overflow': 'Слишком большая сумма для пересчёта',
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

/** Название кошелька, в который попадёт операция: тот, что выбран или будет создан (не название счёта в Дзен-мани). */
function walletLabel(w: PlanWallet | undefined, fallback: string): string {
  if (!w) return fallback;
  return w.target.kind === 'blocked' ? `${fallback} (нет кошелька)` : w.target.name;
}

/**
 * Подпись операции для предпросмотра: «Еда / Кафе · Наличные» или «Перевод: Наличные → Карта». Кошелёк — тот, что выбран на этом
 * экране (а не счёт из файла), категория — «Без категории», если из-за удалённой категории прошлого импорта она не определится.
 */
export function makeOpTitler(plan: ImportPlan): (op: PlanOp) => string {
  const wallets = new Map(plan.wallets.map((w) => [w.key, w] as const));
  const cats = new Map(plan.categories.map((c) => [c.key, c] as const));
  return (op) => {
    const r = op.row;
    const name = (side: { account: { key: string; name: string } }) => walletLabel(wallets.get(side.account.key), side.account.name);
    if (r.kind === 'transfer') return `Перевод: ${name(r.outcome!)} → ${name(r.income!)}`;
    const cat = r.categoryPath.length === 0 || cats.get(categoryKey(r.kind, r.categoryPath))?.target.kind === 'missing' ? 'Без категории' : r.categoryPath.join(' / ');
    return `${cat} · ${name((r.outcome ?? r.income)!)}`;
  };
}

export const symbolOf = (code: string): string => currencyInfo(code).symbol;
