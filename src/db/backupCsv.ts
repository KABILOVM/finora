import { exponentOf, factorOf } from '@/domain/currency';
import type { CurrencyCode, Minor, Transaction, TxKind } from '@/domain/types';
import type { Store } from './store';

const BOM = '﻿';
const SEP = ';';
const EOL = '\r\n';

const KIND_LABEL: Record<TxKind, string> = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };

const HEADER = [
  'Дата',
  'Вид',
  'Кошелёк',
  'Категория',
  'Сумма',
  'Валюта',
  'Кошелёк зачисления',
  'Сумма зачисления',
  'Валюта зачисления',
  'Заметка',
];

/** 123450 → '1234,50' (основные единицы, запятая, без пробелов-разделителей: в таблице это число). */
function plainAmount(minor: Minor, currency: CurrencyCode): string {
  const exp = exponentOf(currency);
  const factor = factorOf(currency);
  const abs = Math.abs(minor);
  const whole = String(Math.floor(abs / factor));
  const frac = exp > 0 ? ',' + String(abs % factor).padStart(exp, '0') : '';
  return (minor < 0 ? '-' : '') + whole + frac;
}

/**
 * Ячейка CSV. Текст, начинающийся с = + - @ (или табуляции), Excel исполнил бы как формулу — такой текст
 * (название или заметка из чужого файла) помечается апострофом. Кавычки/разделители/переводы строк экранируются.
 */
function cell(value: string, isText = true): string {
  let s = value;
  if (isText && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Операции (только живые) в CSV: UTF-8 с BOM, разделитель «;», суммы в основных единицах с запятой, названия вместо id. */
export async function exportTransactionsCsv(store: Store): Promise<string> {
  const { db } = store;
  const [wallets, categories, txs] = await db.transaction('r', [db.wallets, db.categories, db.transactions], () =>
    Promise.all([db.wallets.toArray(), db.categories.toArray(), db.transactions.toArray()]),
  );
  const walletById = new Map(wallets.map((w) => [w.id, w]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const live = txs
    .filter((t) => t.deletedAt === null)
    .sort((a, b) =>
      a.occurredOn !== b.occurredOn
        ? a.occurredOn < b.occurredOn ? -1 : 1
        : a.createdAt !== b.createdAt
          ? a.createdAt < b.createdAt ? -1 : 1
          : a.id < b.id ? -1 : 1,
    );

  const line = (t: Transaction): string => {
    const w = walletById.get(t.walletId);
    const to = t.toWalletId ? walletById.get(t.toWalletId) : undefined;
    return [
      cell(t.occurredOn, false),
      cell(KIND_LABEL[t.kind], false),
      cell(w?.name ?? ''),
      cell(t.categoryId ? (categoryName.get(t.categoryId) ?? '') : ''),
      cell(w ? plainAmount(t.amountMinor, w.currency) : String(t.amountMinor), false),
      cell(w?.currency ?? '', false),
      cell(to?.name ?? ''),
      cell(to && t.toAmountMinor !== null ? plainAmount(t.toAmountMinor, to.currency) : '', false),
      cell(to?.currency ?? '', false),
      cell(t.note),
    ].join(SEP);
  };

  return BOM + [HEADER.map((h) => cell(h, false)).join(SEP), ...live.map(line)].join(EOL) + EOL;
}
