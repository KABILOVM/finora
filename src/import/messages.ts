import type { AmountBadCode } from './amount';
import type { DateParse } from './zenDate';
import { sanitizeText } from './text';

/** Тексты причин простыми словами. Всё, что приходит из файла, подаётся в «ёлочках» и укорачивается. */

export function quoted(raw: string, max = 30): string {
  const s = sanitizeText(raw);
  return `«${s.length > max ? `${s.slice(0, max - 1)}…` : s}»`;
}

export function amountMessage(code: AmountBadCode, raw: string, label: 'списания' | 'зачисления', currency?: string): string {
  const q = quoted(raw);
  switch (code) {
    case 'unreadable':
      return `Не удалось прочитать сумму ${label}: ${q}`;
    case 'negative':
      return `Сумма ${label} отрицательная: ${q} (в файле Zenmoney суммы идут без минуса)`;
    case 'ambiguous':
      return `Сумма ${label} ${q} неоднозначна: неясно, знак «,» или «.» отделяет тысячи или доли. Допишите доли в файле (например, 1000,00)`;
    case 'precision':
      return `В сумме ${label} ${q} знаков после запятой больше, чем у валюты${currency ? ` ${currency}` : ''}`;
    case 'big':
      return `Сумма ${label} ${q} слишком большая`;
  }
}

export function dateMessage(reason: Exclude<DateParse, { ok: true }>['reason'], raw: string): string {
  const q = quoted(raw);
  switch (reason) {
    case 'empty':
      return 'В строке нет даты';
    case 'format':
      return `Непонятная дата ${q}: ожидается ГГГГ-ММ-ДД или ДД.ММ.ГГГГ`;
    case 'calendar':
      return `Такой даты нет в календаре: ${q}`;
    case 'range':
      return `Дата ${q} вне допустимых пределов (с 2000 по 2100 год)`;
  }
}
