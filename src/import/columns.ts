/**
 * Поиск столбцов по названиям заголовков. Формат Zenmoney по памяти: date, categoryName, payee, comment,
 * outcomeAccountName, outcome, outcomeCurrencyShortTitle, incomeAccountName, income, incomeCurrencyShortTitle,
 * createdDate, changedDate, qrCode. Названия ищутся с вариантами (английские и русские), регистр, пробелы,
 * подчёркивания и «ё/е» не важны. Если нужного не нашли — не гадаем, а говорим словами (см. notZenmoneyMessage).
 */

export interface SideColumns {
  account: number;
  amount: number;
  currency: number;
}

export interface ColumnIndex {
  date: number;
  category?: number;
  payee?: number;
  comment?: number;
  /** Списание: счёт, сумма, валюта. Есть, только если найдены все три столбца. */
  outcome?: SideColumns;
  /** Зачисление. */
  income?: SideColumns;
}

type ColumnId =
  | 'date'
  | 'category'
  | 'payee'
  | 'comment'
  | 'outAccount'
  | 'outAmount'
  | 'outCurrency'
  | 'inAccount'
  | 'inAmount'
  | 'inCurrency';

const ALIASES: Record<ColumnId, readonly string[]> = {
  date: ['date', 'дата'],
  category: ['categoryname', 'category', 'категория'],
  payee: ['payee', 'получатель'],
  comment: ['comment', 'комментарий'],
  outAccount: ['outcomeaccountname', 'outcomeaccount', 'счетсписания'],
  outAmount: ['outcome', 'суммасписания'],
  outCurrency: ['outcomecurrencyshorttitle', 'outcomecurrency', 'валютасписания'],
  inAccount: ['incomeaccountname', 'incomeaccount', 'счетзачисления'],
  inAmount: ['income', 'суммазачисления'],
  inCurrency: ['incomecurrencyshorttitle', 'incomecurrency', 'валютазачисления'],
};

/** «Счёт списания», "outcome_Account Name" → 'счетсписания', 'outcomeaccountname'. */
export function headerKey(raw: string): string {
  return raw
    .replace(/^\ufeff/, '')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/g, '');
}

export const ZENMONEY_NEEDS =
  'Нужны столбцы: дата, а также счёт, сумма и валюта списания или зачисления (например, date, outcomeAccountName, outcome, outcomeCurrencyShortTitle).';

/** «Не похоже на файл Zenmoney. Нашли столбцы: …» */
export function notZenmoneyMessage(headers: readonly string[]): string {
  const shown = headers
    .map((h) => h.replace(/\s+/g, ' ').trim())
    .filter((h) => h !== '')
    .slice(0, 15)
    .map((h) => (h.length > 40 ? `${h.slice(0, 39)}…` : h));
  const more = headers.length > shown.length && shown.length === 15 ? ' и другие' : '';
  const found = shown.length > 0 ? `${shown.join(', ')}${more}` : 'ни одного';
  return `Не похоже на файл Zenmoney. Нашли столбцы: ${found}. ${ZENMONEY_NEEDS}`;
}

export type ColumnsResult = { ok: true; index: ColumnIndex } | { ok: false; message: string };

export function mapColumns(headers: readonly string[]): ColumnsResult {
  const found: Partial<Record<ColumnId, number>> = {};
  headers.forEach((h, i) => {
    const key = headerKey(h);
    if (key === '') return;
    for (const id of Object.keys(ALIASES) as ColumnId[]) {
      if (found[id] === undefined && ALIASES[id].includes(key)) {
        found[id] = i;
        break;
      }
    }
  });

  const side = (a?: number, m?: number, c?: number): SideColumns | undefined =>
    a !== undefined && m !== undefined && c !== undefined ? { account: a, amount: m, currency: c } : undefined;
  const outcome = side(found.outAccount, found.outAmount, found.outCurrency);
  const income = side(found.inAccount, found.inAmount, found.inCurrency);

  if (found.date === undefined || (!outcome && !income)) return { ok: false, message: notZenmoneyMessage(headers) };
  const index: ColumnIndex = { date: found.date };
  if (found.category !== undefined) index.category = found.category;
  if (found.payee !== undefined) index.payee = found.payee;
  if (found.comment !== undefined) index.comment = found.comment;
  if (outcome) index.outcome = outcome;
  if (income) index.income = income;
  return { ok: true, index };
}
