import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { currencyInfo, exponentOf } from '@/domain/currency';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, Minor } from '@/domain/types';
import { cn } from '@/lib/cn';
import { applyKey, clampToCurrency, draftToMinor, formatDraft, minorToDraft, sanitizeAmountText } from './amountText';
import { acceptExpr, applyExprKey, evalExpr, formatExpr, hasOperator, isOpKey, normalizeExprText } from './amountExpr';
import { Keypad, type KeypadKey } from './Keypad';

export interface AmountInputProps {
  currency: CurrencyCode;
  /**
   * Текущая сумма. Строка-черновик ('12,' или '12,50') хранится внутри компонента, поэтому внешний value
   * подхватывается, только когда он отличается от разобранного черновика (сброс формы, редактирование операции).
   */
  value: Minor | null;
  /** Сумма в минорных единицах или null (пусто). Ноль отдаётся как 0 — проверку «> 0» делает вызывающий код. */
  onChange: (value: Minor | null) => void;
  /** Подпись для скринридера (визуально скрыта: сумма и так самый крупный элемент экрана). */
  label?: string;
  error?: string | null;
  /** Цвет суммы: расход — красный, доход — зелёный. */
  tone?: 'neutral' | 'income' | 'expense';
  /** Показывать экранную цифровую клавиатуру (по умолчанию да). */
  showKeypad?: boolean;
  /** Системную клавиатуру на телефоне не показывать, даже если своей клавиатуры в этом поле нет (печатает чужая, например в комиссию). */
  noSystemKeyboard?: boolean;
  /**
   * Калькулятор: знаки + − × ÷ на экранной клавиатуре и с клавиатуры ПК, «=» или Enter — посчитать.
   * Пока в поле выражение, родителю отдаётся его результат (null, если выражение не дописано или не считается).
   */
  calculator?: boolean;
  autoFocus?: boolean;
  className?: string;
  /** Кнопки по краям поля суммы (комиссия слева, заметка справа): внутри рамки, сумма остаётся по центру. */
  start?: ReactNode;
  end?: ReactNode;
  /** Без рамки поля (узкие места вроде строки комиссии рисуют свою). */
  bare?: boolean;
  /** Рамка «в работе»: true — выделена, false — приглушена; без значения — по фокусу. Нужна, когда клавиатура печатает в соседнее поле. */
  active?: boolean;
  /** Всплывающая панель над полем суммы (комиссия, заметка): рисуется поверх формы и ничего не сдвигает. */
  overlay?: ReactNode;
  /** Нажали на поле суммы. */
  onActivate?: () => void;
  /** Перехват клавиш экранной клавиатуры: true — клавишу забрал кто-то другой (например, поле процента). */
  onKeyIntercept?: (key: KeypadKey) => boolean;
}

const TONE = { neutral: 'text-text', income: 'text-income', expense: 'text-expense' } as const;

export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Главный элемент быстрого ввода: крупная сумма с символом валюты + цифровая клавиатура.
 * Работает и с системной клавиатурой (ПК): inputmode="decimal", вставка очищается тем же правилом, что и нажатия.
 * Строка вида '12,5' превращается в число ТОЛЬКО через parseAmountToMinor (см. amountText.ts).
 */
export function AmountInput({
  currency,
  value,
  onChange,
  label = 'Сумма',
  error,
  tone = 'neutral',
  showKeypad = true,
  noSystemKeyboard = false,
  calculator = false,
  autoFocus = false,
  className,
  start,
  end,
  bare = false,
  active,
  overlay,
  onActivate,
  onKeyIntercept,
}: AmountInputProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const info = currencyInfo(currency);
  const exp = exponentOf(currency);

  const [text, setText] = useState(() => minorToDraft(value, currency));
  const [seen, setSeen] = useState({ value, currency });
  const [notice, setNotice] = useState<string | null>(null);
  // Выражение калькулятора ('12,5+3×2'); null — обычный ввод числа в text.
  const [expr, setExpr] = useState<string | null>(null);
  const exprEmitted = useRef<Minor | null>(null);
  const calc = expr === null ? null : evalExpr(expr, currency);
  // На телефоне цифры вводятся экранной клавиатурой: системную не показываем (inputmode="none").
  const [coarse] = useState(isCoarsePointer);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  // Подхват внешних изменений во время рендера (без лишнего кадра со старым значением).
  if (seen.value !== value || seen.currency !== currency) {
    setSeen({ value, currency });
    const clamped = clampToCurrency(text, currency); // новая валюта могла сократить число знаков
    if (expr !== null && seen.value !== value && value !== exprEmitted.current) {
      setExpr(null); // сумму сменили снаружи (сброс формы): выражение больше не про неё
      setText(minorToDraft(value, currency));
    } else if (expr === null) {
      if (seen.value !== value && draftToMinor(clamped, currency) !== value) setText(minorToDraft(value, currency));
      else if (clamped !== text) setText(clamped);
    }
  }

  // Сменилась валюта, а значение осталось — сообщаем родителю пересчитанную сумму (например, 12,5 → 12 для иены).
  const lastCurrency = useRef(currency);
  useEffect(() => {
    if (lastCurrency.current === currency) return;
    lastCurrency.current = currency;
    const m = expr !== null ? (calc?.kind === 'ok' ? calc.minor : null) : draftToMinor(text, currency);
    if (expr !== null) exprEmitted.current = m;
    if (m !== valueRef.current) onChangeRef.current(m);
  }, [currency]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const shown = expr !== null ? formatExpr(expr) : formatDraft(text);

  const commit = (next: string) => {
    setNotice(null);
    if (next === text) return;
    setText(next);
    onChange(draftToMinor(next, currency));
  };

  // Выражение: сумма наружу — результат, пока он считается.
  const commitExpr = (next: string) => {
    setNotice(null);
    setExpr(next);
    const r = evalExpr(next, currency);
    const minor = r.kind === 'ok' ? r.minor : null;
    exprEmitted.current = minor;
    onChange(minor);
  };

  // Из выражения обратно к обычному числу (стёрли последний знак).
  const leaveExpr = (plain: string) => {
    setExpr(null);
    setNotice(null);
    setText(plain);
    onChange(draftToMinor(plain, currency));
  };

  // «=»: выражение заменяется результатом.
  const equals = () => {
    if (calc?.kind !== 'ok') return;
    const plain = minorToDraft(calc.minor, currency);
    setExpr(null);
    setNotice(null);
    setText(plain);
    onChange(calc.minor);
  };

  const onKey = (key: KeypadKey) => {
    if (onKeyIntercept?.(key)) return;
    if (key === '=') return equals();
    if (isOpKey(key)) {
      const base = expr ?? text;
      if (base === '') return;
      commitExpr(applyExprKey(base, key));
      return;
    }
    if (expr === null) return commit(applyKey(text, key, currency));
    const next = applyExprKey(expr, key);
    if (!hasOperator(next)) leaveExpr(next);
    else commitExpr(next);
  };

  // Набор и вставка с системной клавиатуры. Строку, которую нельзя прочитать однозначно («1.234», лишние знаки,
  // два числа), не принимаем целиком — прежняя сумма остаётся. Нажатие лишней цифры молча игнорируется, как на
  // экранной клавиатуре, а вставка чужого текста объясняется сообщением.
  const onType = (raw: string) => {
    if (calculator && (expr !== null || hasOperator(normalizeExprText(raw)))) {
      const next = acceptExpr(raw);
      if (next === null) return; // так выражение не записать: прежнее остаётся
      if (hasOperator(next)) return commitExpr(next);
      if (expr !== null) leaveExpr(sanitizeAmountText(next, currency));
      else onTypePlain(next);
      return;
    }
    onTypePlain(raw);
  };

  const onTypePlain = (raw: string) => {
    const next = sanitizeAmountText(raw, currency);
    if (next === '' && /\d/.test(raw)) {
      if (raw.length > shown.length + 1) setNotice('Не удалось прочитать сумму. Введите её вручную.');
      return;
    }
    commit(next);
  };

  const message = error || notice || (calc?.kind === 'error' ? calc.message : null);
  // Чем длиннее число, тем мельче шрифт: самая длинная сумма («9 999 999 999 999,99») помещается на iPhone SE.
  const size =
    expr !== null
      ? shown.length <= 10
        ? 'text-3xl'
        : shown.length <= 16
          ? 'text-2xl'
          : 'text-xl'
      : shown.length <= 8
        ? 'text-5xl'
        : shown.length <= 11
          ? 'text-4xl'
          : shown.length <= 15
            ? 'text-3xl'
            : 'text-2xl';

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="relative">
        {overlay}
        <label htmlFor={id} className="sr-only">
          {label}, {info.name}
        </label>
        {(() => {
          const amountRow = (
            <div className={cn('flex items-baseline justify-center gap-2 py-2', TONE[tone])} onClick={() => inputRef.current?.focus()}>
              {/* Невидимая копия текста задаёт ширину поля: символ валюты стоит вплотную к цифрам. */}
              <span className="inline-grid">
                <span aria-hidden="true" className={cn('money invisible col-start-1 row-start-1 whitespace-pre px-0.5 font-bold', size)}>
                  {shown || '0'}
                </span>
                <input
                  ref={inputRef}
                  id={id}
                  type="text"
                  inputMode={(showKeypad || noSystemKeyboard) && coarse ? 'none' : exp > 0 ? 'decimal' : 'numeric'}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  placeholder="0"
                  value={shown}
                  onChange={(e) => onType(e.target.value)}
                  onKeyDown={(e) => {
                    if (calculator && expr !== null && (e.key === '=' || e.key === 'Enter') && calc?.kind === 'ok') {
                      e.preventDefault();
                      equals();
                    }
                  }}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? `${id}-error` : undefined}
                  className={cn(
                    'money col-start-1 row-start-1 w-0 min-w-full bg-transparent px-0.5 text-center font-bold caret-brand outline-none placeholder:text-muted/60',
                    size,
                  )}
                />
              </span>
              <span className={cn('font-semibold opacity-70', size === 'text-5xl' ? 'text-2xl' : 'text-xl')} aria-hidden="true">
                {info.symbol}
              </span>
            </div>
          );
          if (bare) return amountRow;
          // Поле суммы: рамка с мягкой тенью; кнопки по краям занимают места поровну, чтобы цифры стояли по центру.
          const side = start || end ? 'w-10 shrink-0' : null;
          return (
            <div
              data-amount-card=""
              onFocusCapture={onActivate}
              onClick={onActivate}
              className={cn(
                'flex items-center gap-1 rounded-2xl border bg-surface px-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_8px_18px_-14px_rgb(var(--brand)/0.5)] transition-colors',
                active === undefined
                  ? 'border-border/70 focus-within:border-brand/60 focus-within:ring-2 focus-within:ring-brand/15'
                  : active
                    ? 'border-brand/60 ring-2 ring-brand/15'
                    : 'border-border/70',
                message && 'border-danger/60',
              )}
            >
              {side && <div className={cn(side, 'flex justify-start')}>{start}</div>}
              <div className="min-w-0 flex-1">{amountRow}</div>
              {side && <div className={cn(side, 'flex justify-end')}>{end}</div>}
            </div>
          );
        })()}
        {calc?.kind === 'ok' && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={equals}
            className="mx-auto mt-1 block rounded-full bg-surface-2 px-4 py-1 text-lg font-semibold text-brand"
          >
            = {formatMinor(calc.minor, currency)}
          </button>
        )}
        {message && (
          <p id={`${id}-error`} role="alert" className="text-center text-sm font-medium text-danger">
            {message}
          </p>
        )}
      </div>
      {showKeypad && <Keypad ops={calculator} canEqual={calc?.kind === 'ok'} allowComma={exp > 0} onKey={onKey} />}
    </div>
  );
}
