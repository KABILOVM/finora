import { cn } from '@/lib/cn';
import type { OpKey } from './amountExpr';
import type { AmountKey } from './amountText';
import { Icon } from './Icon';

export type KeypadKey = AmountKey | OpKey | '=';

export interface KeypadProps {
  onKey: (key: KeypadKey) => void;
  /** Раскладка калькулятора: знаки ÷ × − + справа и «=» (калькулятор в поле суммы). */
  ops?: boolean;
  /** «=» нажимается (есть что считать). */
  canEqual?: boolean;
  /** Кнопка «,» активна (у валют без дробной части, например иены, её нет). */
  allowComma?: boolean;
  disabled?: boolean;
  className?: string;
}

const DIGIT_ROWS: AmountKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

/** Как на калькуляторе: сверху 7-8-9, справа знаки, внизу «0 , =». */
const CALC_ROWS: AmountKey[][] = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
];
const CALC_OPS: OpKey[] = ['×', '−', '+'];

const OP_LABEL: Record<OpKey, string> = { '+': 'Плюс', '−': 'Минус', '×': 'Умножить', '÷': 'Разделить' };

// Клавиши «приподняты»: тонкая рамка, светлая кромка сверху и мягкая тень; при нажатии уменьшаются и темнеют.
// Клавиши не ниже 56px: так требует проект (удобно попадать пальцем).
const BASE_KEY =
  'flex min-h-[56px] select-none items-center justify-center rounded-[1.1rem] border text-[1.75rem] font-semibold leading-none ' +
  'tracking-tight transition duration-150 ease-spring active:scale-[0.93] disabled:opacity-40 disabled:active:scale-100 ' +
  'shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_6px_14px_-9px_rgb(var(--brand)/0.55)]';
const KEY_CLASS = `${BASE_KEY} border-border/80 bg-surface text-text active:bg-brand/10`;
const SERVICE_CLASS = `${BASE_KEY} border-border/60 bg-surface-2 text-muted active:bg-border`;
const OP_CLASS = `${BASE_KEY} border-brand/25 bg-brand/10 text-[2rem] font-medium text-brand active:bg-brand/25`;
const EQUAL_CLASS =
  `${BASE_KEY} border-transparent bg-gradient-to-br from-brand to-accent text-[2rem] text-brand-fg ` +
  'active:brightness-90 disabled:bg-none disabled:bg-brand/30';

/** Цифровая клавиатура 0–9, «,» и «⌫». Только сообщает о нажатиях — состояние хранит AmountInput. */
export function Keypad({ onKey, ops = false, canEqual = false, allowComma = true, disabled = false, className }: KeypadProps) {
  // preventDefault на mousedown: кнопка не забирает фокус у поля суммы (на ПК можно продолжать печатать).
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const press = (key: KeypadKey) => () => onKey(key);
  const opButton = (op: OpKey) => (
    <button
      key={op}
      type="button"
      aria-label={OP_LABEL[op]}
      className={OP_CLASS}
      disabled={disabled}
      onMouseDown={keep}
      onClick={press(op)}
    >
      {op}
    </button>
  );

  const digit = (d: AmountKey, extra = '') => (
    <button key={d} type="button" className={cn(KEY_CLASS, extra)} disabled={disabled} onMouseDown={keep} onClick={press(d)}>
      {d}
    </button>
  );
  const comma = (
    <button type="button" aria-label="Запятая" className={KEY_CLASS} disabled={disabled || !allowComma} onMouseDown={keep} onClick={press(',')}>
      ,
    </button>
  );
  const backspace = (extra = '') => (
    <button
      type="button"
      aria-label="Стереть"
      className={cn(SERVICE_CLASS, extra)}
      disabled={disabled}
      onMouseDown={keep}
      onClick={press('backspace')}
    >
      <Icon name="backspace" size={26} />
    </button>
  );

  if (ops) {
    return (
      <div role="group" aria-label="Цифровая клавиатура" className={cn('grid grid-cols-4 gap-2', className)}>
        {backspace('col-span-3')}
        {opButton('÷')}
        {CALC_ROWS.flatMap((row, r) => [...row.map((d) => digit(d)), opButton(CALC_OPS[r]!)])}
        {digit('0', 'col-span-2')}
        {comma}
        <button
          type="button"
          aria-label="Равно"
          className={EQUAL_CLASS}
          disabled={disabled || !canEqual}
          onMouseDown={keep}
          onClick={press('=')}
        >
          =
        </button>
      </div>
    );
  }

  return (
    <div role="group" aria-label="Цифровая клавиатура" className={cn('grid grid-cols-3 gap-2', className)}>
      {DIGIT_ROWS.flatMap((row) => row.map((d) => digit(d)))}
      {allowComma ? (
        <button
          type="button"
          aria-label="Запятая"
          className={KEY_CLASS}
          disabled={disabled}
          onMouseDown={keep}
          onClick={press(',')}
        >
          ,
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      <button type="button" className={KEY_CLASS} disabled={disabled} onMouseDown={keep} onClick={press('0')}>
        0
      </button>
      <button
        type="button"
        aria-label="Стереть"
        className={SERVICE_CLASS}
        disabled={disabled}
        onMouseDown={keep}
        onClick={press('backspace')}
      >
        <Icon name="backspace" size={26} />
      </button>
    </div>
  );
}
