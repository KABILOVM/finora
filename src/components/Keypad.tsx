import { cn } from '@/lib/cn';
import type { AmountKey } from './amountText';
import { Icon } from './Icon';

export interface KeypadProps {
  onKey: (key: AmountKey) => void;
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

const KEY_CLASS =
  'flex min-h-[56px] select-none items-center justify-center rounded-2xl bg-surface-2 text-2xl font-semibold text-text ' +
  'transition-colors active:bg-border disabled:opacity-40';

/** Цифровая клавиатура 0–9, «,» и «⌫». Только сообщает о нажатиях — состояние хранит AmountInput. */
export function Keypad({ onKey, allowComma = true, disabled = false, className }: KeypadProps) {
  // preventDefault на mousedown: кнопка не забирает фокус у поля суммы (на ПК можно продолжать печатать).
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const press = (key: AmountKey) => () => onKey(key);

  return (
    <div role="group" aria-label="Цифровая клавиатура" className={cn('grid grid-cols-3 gap-2', className)}>
      {DIGIT_ROWS.flat().map((d) => (
        <button key={d} type="button" className={KEY_CLASS} disabled={disabled} onMouseDown={keep} onClick={press(d)}>
          {d}
        </button>
      ))}
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
    </div>
  );
}
