import { useEffect, useId, useRef, useState } from 'react';
import { currencyInfo, exponentOf } from '@/domain/currency';
import type { CurrencyCode, Minor } from '@/domain/types';
import { cn } from '@/lib/cn';
import {
  applyKey,
  clampToCurrency,
  draftToMinor,
  formatDraft,
  minorToDraft,
  sanitizeAmountText,
  type AmountKey,
} from './amountText';
import { Keypad } from './Keypad';

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
  autoFocus?: boolean;
  className?: string;
}

const TONE = { neutral: 'text-text', income: 'text-income', expense: 'text-expense' } as const;

function isCoarsePointer(): boolean {
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
  autoFocus = false,
  className,
}: AmountInputProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const info = currencyInfo(currency);
  const exp = exponentOf(currency);

  const [text, setText] = useState(() => minorToDraft(value, currency));
  const [seen, setSeen] = useState({ value, currency });
  const [notice, setNotice] = useState<string | null>(null);
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
    if (seen.value !== value && draftToMinor(clamped, currency) !== value) setText(minorToDraft(value, currency));
    else if (clamped !== text) setText(clamped);
  }

  // Сменилась валюта, а значение осталось — сообщаем родителю пересчитанную сумму (например, 12,5 → 12 для иены).
  const lastCurrency = useRef(currency);
  useEffect(() => {
    if (lastCurrency.current === currency) return;
    lastCurrency.current = currency;
    const m = draftToMinor(text, currency);
    if (m !== valueRef.current) onChangeRef.current(m);
  }, [currency]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const shown = formatDraft(text);

  const commit = (next: string) => {
    setNotice(null);
    if (next === text) return;
    setText(next);
    onChange(draftToMinor(next, currency));
  };

  // Набор и вставка с системной клавиатуры. Строку, которую нельзя прочитать однозначно («1.234», лишние знаки,
  // два числа), не принимаем целиком — прежняя сумма остаётся. Нажатие лишней цифры молча игнорируется, как на
  // экранной клавиатуре, а вставка чужого текста объясняется сообщением.
  const onType = (raw: string) => {
    const next = sanitizeAmountText(raw, currency);
    if (next === '' && /\d/.test(raw)) {
      if (raw.length > shown.length + 1) setNotice('Не удалось прочитать сумму. Введите её вручную.');
      return;
    }
    commit(next);
  };

  const message = error || notice;
  // Чем длиннее число, тем мельче шрифт: самая длинная сумма («9 999 999 999 999,99») помещается на iPhone SE.
  const size = shown.length <= 8 ? 'text-5xl' : shown.length <= 11 ? 'text-4xl' : shown.length <= 15 ? 'text-3xl' : 'text-2xl';

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div>
        <label htmlFor={id} className="sr-only">
          {label}, {info.name}
        </label>
        <div
          className={cn('flex items-baseline justify-center gap-2 py-2', TONE[tone])}
          onClick={() => inputRef.current?.focus()}
        >
          {/* Невидимая копия текста задаёт ширину поля: символ валюты стоит вплотную к цифрам. */}
          <span className="inline-grid">
            <span
              aria-hidden="true"
              className={cn('money invisible col-start-1 row-start-1 whitespace-pre px-0.5 font-bold', size)}
            >
              {shown || '0'}
            </span>
            <input
              ref={inputRef}
              id={id}
              type="text"
              inputMode={showKeypad && coarse ? 'none' : exp > 0 ? 'decimal' : 'numeric'}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              placeholder="0"
              value={shown}
              onChange={(e) => onType(e.target.value)}
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
        {message && (
          <p id={`${id}-error`} role="alert" className="text-center text-sm font-medium text-danger">
            {message}
          </p>
        )}
      </div>
      {showKeypad && <Keypad allowComma={exp > 0} onKey={(k: AmountKey) => commit(applyKey(text, k, currency))} />}
    </div>
  );
}
