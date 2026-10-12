import { cn } from '@/lib/cn';
import { OP_KEYS, type OpKey } from './amountExpr';
import type { AmountKey } from './amountText';
import { Icon } from './Icon';

export type KeypadKey = AmountKey | OpKey;

export interface KeypadProps {
  onKey: (key: KeypadKey) => void;
  /** Справа столбец знаков ÷ × − + (калькулятор в поле суммы). */
  ops?: boolean;
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

const OP_LABEL: Record<OpKey, string> = { '+': 'Плюс', '−': 'Минус', '×': 'Умножить', '÷': 'Разделить' };

const BASE_KEY =
  'flex min-h-[56px] select-none items-center justify-center rounded-2xl bg-surface-2 text-2xl font-semibold ' +
  'transition-colors active:bg-border disabled:opacity-40';
const KEY_CLASS = `${BASE_KEY} text-text`;
const OP_CLASS = `${BASE_KEY} text-brand`;

/** Цифровая клавиатура 0–9, «,» и «⌫». Только сообщает о нажатиях — состояние хранит AmountInput. */
export function Keypad({ onKey, ops = false, allowComma = true, disabled = false, className }: KeypadProps) {
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

  return (
    <div role="group" aria-label="Цифровая клавиатура" className={cn('grid gap-2', ops ? 'grid-cols-4' : 'grid-cols-3', className)}>
      {DIGIT_ROWS.flatMap((row, r) => [
        ...row.map((d) => (
          <button key={d} type="button" className={KEY_CLASS} disabled={disabled} onMouseDown={keep} onClick={press(d)}>
            {d}
          </button>
        )),
        ...(ops ? [opButton(OP_KEYS[r]!)] : []),
      ])}
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
        className={KEY_CLASS}
        disabled={disabled}
        onMouseDown={keep}
        onClick={press('backspace')}
      >
        <Icon name="backspace" size={28} />
      </button>
      {ops && opButton(OP_KEYS[3]!)}
    </div>
  );
}
