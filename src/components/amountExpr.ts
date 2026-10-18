import { exponentOf } from '@/domain/currency';
import type { CurrencyCode, Minor } from '@/domain/types';
import { MAX_DIGITS } from './amountText';

/**
 * Калькулятор в поле суммы: «12,5+3×2». Выражение — строка без пробелов: числа с запятой и знаки + − × ÷.
 * Считается в целых числах (BigInt, дроби), без float: «0,1+0,2» ровно «0,3». Умножение и деление раньше сложения.
 * В сумму (Minor) результат округляется до наименьшей единицы валюты (0,5 и больше — вверх); результат меньше нуля,
 * деление на ноль и число длиннее лимита ввода — ошибка, суммы не будет.
 */

export type OpKey = '+' | '−' | '×' | '÷';
export const OP_KEYS: readonly OpKey[] = ['÷', '×', '−', '+'];

/** Знаков после запятой в одном числе выражения (курс «×10,8525» помещается). */
const OPERAND_FRAC = 4;
const OPERAND_INT = MAX_DIGITS - 2;
/** Длина выражения: дольше на телефоне не поместится в строку суммы. */
export const EXPR_MAX = 26;

const OP_CHAR = /[+−×÷]/;
const OP_SPLIT = /[+−×÷]/g;

export type ExprResult = { kind: 'ok'; minor: Minor } | { kind: 'incomplete' } | { kind: 'error'; message: string };

export function hasOperator(text: string): boolean {
  return OP_CHAR.test(text);
}

export function isOpKey(key: string): key is OpKey {
  return key === '+' || key === '−' || key === '×' || key === '÷';
}

/**
 * В тексте есть слова: буквы, кроме одиночной «x»/«х» между числами (знак умножения с клавиатуры ПК).
 * Такой текст — не выражение («Расход 150 TJS»: «х» в слове не умножение), сумму из него читают как обычное число.
 */
export function hasWords(raw: string): boolean {
  return (raw.match(/\p{L}+/gu) ?? []).some((w) => !/^[xXхХ]$/.test(w));
}

/** Приводит набранное на клавиатуре ПК к виду выражения: «*», «x» → ×; «/» → ÷; «-» → −; «.» → «,»; лишнее выкидывает. */
export function normalizeExprText(raw: string): string {
  return raw
    .replace(/[*xXхХ]/g, '×')
    .replace(/[/÷]/g, '÷')
    .replace(/[-–—−]/g, '−')
    .replace(/\./g, ',')
    .replace(/[^\d,+−×÷]/g, '');
}

function operandOk(s: string): boolean {
  return new RegExp(String.raw`^(\d{1,${OPERAND_INT}}(,\d{0,${OPERAND_FRAC}})?|,\d{0,${OPERAND_FRAC}})?$`).test(s);
}

/**
 * Проверяет выражение целиком. Возвращает нормальный вид или null — «так вводить нельзя» (тогда прежнее остаётся):
 * знак в начале, два знака подряд, второй разделитель в числе, больше знаков после запятой, чем разрешено, длиннее EXPR_MAX.
 */
export function acceptExpr(raw: string): string | null {
  const s = normalizeExprText(raw);
  if (s.length > EXPR_MAX) return null;
  const operands = s.split(OP_SPLIT);
  const ops = s.match(OP_SPLIT) ?? [];
  if (ops.length > 0 && operands[0] === '') return null;
  // пустое число допустимо только в самом конце («12+»)
  if (operands.slice(0, -1).some((o) => o === '')) return null;
  if (!operands.every(operandOk)) return null;
  const fixed = operands.map((o) => {
    const t = o.startsWith(',') ? `0${o}` : o;
    return t.replace(/^0+(?=\d)/, '');
  });
  return fixed.reduce((acc, o, i) => acc + o + (ops[i] ?? ''), '');
}

/** Одно нажатие экранной клавиатуры внутри выражения. Недопустимое нажатие возвращает выражение без изменений. */
export function applyExprKey(expr: string, key: string): string {
  if (key === 'backspace') return expr.slice(0, -1);
  if (isOpKey(key)) {
    if (expr === '') return expr;
    if (OP_CHAR.test(expr.slice(-1))) return expr.slice(0, -1) + key; // знак заменяется знаком
    const next = (expr.endsWith(',') ? expr.slice(0, -1) : expr) + key;
    return next.length > EXPR_MAX ? expr : next;
  }
  if (expr.length >= EXPR_MAX) return expr;
  const at = Math.max(...[...'+−×÷'].map((c) => expr.lastIndexOf(c))) + 1;
  const head = expr.slice(0, at);
  const last = expr.slice(at);
  const comma = last.indexOf(',');
  if (key === ',') {
    if (comma >= 0) return expr;
    return head + (last === '' ? '0,' : `${last},`);
  }
  if (!/^\d$/.test(key)) return expr;
  if (comma >= 0) return last.length - comma - 1 >= OPERAND_FRAC ? expr : expr + key;
  if (last === '0') return key === '0' ? expr : head + key; // без ведущих нулей
  return last.length >= OPERAND_INT ? expr : expr + key;
}

interface Frac {
  n: bigint;
  d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
};

function frac(n: bigint, d: bigint): Frac {
  const g = gcd(n, d);
  return d < 0n ? { n: -n / g, d: -d / g } : { n: n / g, d: d / g };
}

function toFrac(operand: string): Frac {
  const [i = '', f = ''] = operand.split(',');
  return frac(BigInt((i || '0') + f), 10n ** BigInt(f.length));
}

/** Считает выражение. Пока оно не дописано («12+», «×3») — incomplete: суммы ещё нет. */
export function evalExpr(expr: string, currency: CurrencyCode): ExprResult {
  const operands = expr.split(OP_SPLIT);
  const ops = expr.match(OP_SPLIT) ?? [];
  if (operands.some((o) => o === '' || o === ',')) return { kind: 'incomplete' };

  // Первый проход: × и ÷ слева направо складывают числа в слагаемые; второй — слагаемые со знаками.
  let cur = toFrac(operands[0]!);
  let sign = 1n;
  let total: Frac = { n: 0n, d: 1n };
  const flush = () => {
    total = frac(total.n * cur.d + sign * cur.n * total.d, total.d * cur.d);
  };
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    const next = toFrac(operands[i + 1]!);
    if (op === '×') cur = frac(cur.n * next.n, cur.d * next.d);
    else if (op === '÷') {
      if (next.n === 0n) return { kind: 'error', message: 'На ноль делить нельзя' };
      cur = frac(cur.n * next.d, cur.d * next.n);
    } else {
      flush();
      sign = op === '+' ? 1n : -1n;
      cur = next;
    }
  }
  flush();

  if (total.n < 0n) return { kind: 'error', message: 'Результат меньше нуля' };
  const scale = 10n ** BigInt(exponentOf(currency));
  const minor = (2n * total.n * scale + total.d) / (2n * total.d); // округление до ближайшей единицы, .5 — вверх
  if (minor >= 10n ** BigInt(MAX_DIGITS)) return { kind: 'error', message: 'Слишком большая сумма' };
  return { kind: 'ok', minor: Number(minor) };
}

/** Выражение для крупного показа: числа с пробелами тысяч, вокруг знаков тонкие пробелы. '1234,5+3' → '1 234,5 + 3'. */
export function formatExpr(expr: string): string {
  return expr
    .split(/([+−×÷])/)
    .map((part) =>
      OP_CHAR.test(part) ? ` ${part} ` : part.replace(/^[^,]*/, (int) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')),
    )
    .join('');
}
