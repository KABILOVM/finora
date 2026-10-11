import type { RecurringInput, RecurringPatch } from '@/db';
import { INTERVAL_MAX, INTERVAL_MIN, isValidSchedule, nextOccurrence } from '@/domain/schedule';
import type { Debt, Frequency, IsoDate, Minor, RecurringRule, Wallet, TxKind } from '@/domain/types';
import { checkDate, NOTE_MAX } from '@/features/transactions/txForm';
import type { ReceivedView } from '@/features/transactions/useTxFormController';
import { addDays } from '@/lib/dates';
import { receivedAmount } from './received';

/** Форма «Новый / Правка регулярного платежа»: чистая логика (без React и без базы). */

export interface RuleFormState {
  kind: TxKind;
  walletId: string | null;
  toWalletId: string | null;
  amountMinor: Minor | null;
  /** Перевод: «Получено», как ввёл человек (undefined — не трогал, считается само). */
  receivedOverride: Minor | null | undefined;
  feeOpen: boolean;
  categoryId: string | null;
  debtId: string | null;
  note: string;
  frequency: Frequency;
  /** «Каждые N» как набрал человек. */
  intervalText: string;
  startOn: string;
  hasEnd: boolean;
  endOn: string;
  autoPost: boolean;
}

export interface RuleFormErrors {
  amount?: string;
  wallet?: string;
  toWallet?: string;
  toAmount?: string;
  category?: string;
  debt?: string;
  note?: string;
  interval?: string;
  startOn?: string;
  endOn?: string;
  form?: string;
}

export function emptyRuleForm(walletId: string | null, today: IsoDate): RuleFormState {
  return {
    kind: 'expense',
    walletId,
    toWalletId: null,
    amountMinor: null,
    receivedOverride: undefined,
    feeOpen: false,
    categoryId: null,
    debtId: null,
    note: '',
    frequency: 'monthly',
    intervalText: '1',
    startOn: today,
    hasEnd: false,
    endOn: '',
    autoPost: false,
  };
}

export function formFromRule(
  rule: RecurringRule,
  currencyOf: (walletId: string) => string | undefined,
): RuleFormState {
  const transfer = rule.kind === 'transfer';
  const same =
    transfer && rule.toWalletId !== null && currencyOf(rule.walletId) !== undefined && currencyOf(rule.walletId) === currencyOf(rule.toWalletId);
  return {
    kind: rule.kind,
    walletId: rule.walletId,
    toWalletId: rule.toWalletId,
    amountMinor: rule.amountMinor,
    receivedOverride: transfer ? rule.toAmountMinor : undefined,
    feeOpen: same && rule.toAmountMinor !== null && rule.toAmountMinor !== rule.amountMinor,
    categoryId: rule.categoryId,
    debtId: rule.debtId,
    note: rule.note,
    frequency: rule.frequency,
    intervalText: String(rule.intervalN),
    startOn: rule.startOn,
    hasEnd: rule.endOn !== null,
    endOn: rule.endOn ?? '',
    autoPost: rule.autoPost === 1,
  };
}

/** «Каждые N»: целое число от 1 до 1000; иначе null. */
export function parseInterval(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= INTERVAL_MIN && n <= INTERVAL_MAX ? n : null;
}

export interface RuleCheckContext {
  wallet: Pick<Wallet, 'name' | 'currency'> | undefined;
  toWallet: Pick<Wallet, 'name' | 'currency'> | null | undefined;
  debt: Pick<Debt, 'counterparty' | 'currency'> | undefined;
  received: ReceivedView | null;
}

export type RuleCheck = { ok: true; input: RecurringInput } | { ok: false; errors: RuleFormErrors };

/** Проверки на экране до сохранения (остальное проверит репозиторий): подсказки появляются у своего поля, а не «где-то». */
export function checkRuleForm(f: RuleFormState, ctx: RuleCheckContext): RuleCheck {
  const errors: RuleFormErrors = {};
  const transfer = f.kind === 'transfer';

  if (f.walletId === null || !ctx.wallet) errors.wallet = transfer ? 'Выберите, откуда списывать' : 'Выберите кошелёк';
  if (f.amountMinor === null) errors.amount = 'Введите сумму';
  else if (f.amountMinor <= 0) errors.amount = 'Сумма должна быть больше нуля';

  let toAmount: Minor | null = null;
  if (transfer) {
    if (f.toWalletId === null || !ctx.toWallet) errors.toWallet = 'Выберите, куда переводить';
    else if (f.toWalletId === f.walletId) errors.toWallet = 'Кошельки списания и зачисления должны быть разными';
    else {
      const r = receivedAmount(ctx.received, f.amountMinor);
      toAmount = r.toAmount;
      if (r.error) errors.toAmount = r.error;
    }
  } else if (f.debtId !== null) {
    if (!ctx.debt) errors.debt = 'Долг не найден: выберите другой или уберите связь с долгом';
    else if (ctx.wallet && ctx.debt.currency !== ctx.wallet.currency) {
      errors.debt = `Валюта кошелька «${ctx.wallet.name}» (${ctx.wallet.currency}) не совпадает с валютой долга «${ctx.debt.counterparty}» (${ctx.debt.currency}). Выберите другой кошелёк или другой долг.`;
    }
  }

  const note = f.note.trim();
  if (note.length > NOTE_MAX) errors.note = `Заметка не длиннее ${NOTE_MAX} символов (сейчас ${note.length})`;

  const intervalN = parseInterval(f.intervalText);
  if (intervalN === null) errors.interval = `Введите целое число от ${INTERVAL_MIN} до ${INTERVAL_MAX}`;

  const startError = checkDate(f.startOn);
  if (startError) errors.startOn = startError;
  let endOn: string | null = null;
  if (f.hasEnd) {
    const endError = checkDate(f.endOn);
    if (endError) errors.endOn = endError;
    else if (!startError && f.endOn < f.startOn) errors.endOn = 'Дата окончания не может быть раньше первого платежа';
    else endOn = f.endOn;
  }

  if (Object.keys(errors).length > 0 || f.walletId === null || f.amountMinor === null || intervalN === null) {
    return { ok: false, errors };
  }
  const input: RecurringInput = {
    kind: f.kind,
    walletId: f.walletId,
    amountMinor: f.amountMinor,
    note,
    frequency: f.frequency,
    intervalN,
    startOn: f.startOn,
    endOn,
    autoPost: f.autoPost ? 1 : 0,
    ...(transfer
      ? { toWalletId: f.toWalletId, toAmountMinor: toAmount, categoryId: null, debtId: null }
      : { toWalletId: null, toAmountMinor: null, categoryId: f.categoryId, debtId: f.debtId }),
  };
  return { ok: true, input };
}

/**
 * Что из проверенной формы изменилось против правила (в базу уходит только это: правка с другого устройства не откатывается).
 * Сумма зачисления перевода едет всегда: без неё репозиторий оставил бы прежнюю пару «списано / получено» при новой сумме.
 */
export function ruleFormPatch(input: RecurringInput, rule: RecurringRule): RecurringPatch {
  const patch: RecurringPatch = {};
  if (input.kind !== rule.kind) patch.kind = input.kind;
  if (input.walletId !== rule.walletId) patch.walletId = input.walletId;
  if ((input.toWalletId ?? null) !== rule.toWalletId) patch.toWalletId = input.toWalletId ?? null;
  if (input.amountMinor !== rule.amountMinor) patch.amountMinor = input.amountMinor;
  if (input.kind === 'transfer') patch.toAmountMinor = input.toAmountMinor ?? null;
  if ((input.categoryId ?? null) !== rule.categoryId) patch.categoryId = input.categoryId ?? null;
  if ((input.debtId ?? null) !== rule.debtId) patch.debtId = input.debtId ?? null;
  if ((input.note ?? '') !== rule.note.trim()) patch.note = input.note ?? '';
  if (input.frequency !== rule.frequency) patch.frequency = input.frequency;
  if ((input.intervalN ?? 1) !== rule.intervalN) patch.intervalN = input.intervalN ?? 1;
  if (input.startOn !== rule.startOn) patch.startOn = input.startOn;
  if ((input.endOn ?? null) !== rule.endOn) patch.endOn = input.endOn ?? null;
  if ((input.autoPost ?? 0) !== rule.autoPost) patch.autoPost = input.autoPost ?? 0;
  return patch;
}

/** К какому полю формы относится сообщение репозитория; неясно — к форме целиком (сообщение не должно потеряться). */
export function ruleErrorField(message: string): keyof RuleFormErrors {
  const m = message.trim();
  if (/сумм[а-яё]* зачисления/i.test(m)) return 'toAmount';
  if (/кошел[её]к зачисления|кошельк[а-яё]* (списания|зачисления)/i.test(m)) return 'toWallet';
  if (/^Долг|с валютой долга/.test(m)) return 'debt';
  if (/^Сумма|слишком велика|^Перевод: комиссия/.test(m)) return 'amount';
  if (/^Заметка/.test(m)) return 'note';
  if (/^Категория/.test(m)) return 'category';
  if (/^Шаг/.test(m)) return 'interval';
  if (/^Начало/.test(m)) return 'startOn';
  if (/^Конец/.test(m)) return 'endOn';
  if (/^Кошел[её]к/.test(m)) return 'wallet';
  return 'form';
}

/** Ближайшие `count` дат платежа, считая с сегодняшнего дня (или с начала расписания, если оно позже). Некорректное расписание — пусто. */
export function previewDates(
  f: Pick<RuleFormState, 'frequency' | 'startOn' | 'hasEnd' | 'endOn' | 'intervalText'>,
  today: IsoDate,
  count = 4,
): IsoDate[] {
  const intervalN = parseInterval(f.intervalText);
  if (intervalN === null) return [];
  const rule = { frequency: f.frequency, intervalN, startOn: f.startOn, endOn: f.hasEnd && f.endOn !== '' ? f.endOn : null };
  if (!isValidSchedule(rule)) return [];
  const from = f.startOn > today ? f.startOn : today;
  const out: IsoDate[] = [];
  let cur = nextOccurrence(rule, addDays(from, -1));
  while (cur !== null && out.length < count) {
    out.push(cur);
    cur = nextOccurrence(rule, cur);
  }
  return out;
}

/**
 * Предупреждение для «Проводить само» при дате начала в прошлом: старые платежи сами не проводятся — они появятся в «Просроченных»
 * и ждут подтверждения.
 */
export function historyNote(f: Pick<RuleFormState, 'autoPost' | 'startOn'>, today: IsoDate): string | null {
  if (!f.autoPost || f.startOn >= today) return null;
  return 'Платежи за прошлые даты сами не проводятся: они появятся в «Просроченных», и вы подтвердите их вручную.';
}
