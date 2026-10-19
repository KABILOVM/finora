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

/** Как на калькуляторе: сверху 7-8-9. */
const CALC_ROWS: AmountKey[][] = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
];
const OPS: OpKey[] = ['÷', '×', '−', '+'];

const OP_LABEL: Record<OpKey, string> = { '+': 'Плюс', '−': 'Минус', '×': 'Умножить', '÷': 'Разделить' };

// Клавиши «приподняты»: тонкая рамка, светлая кромка сверху и мягкая тень; при нажатии уменьшаются и темнеют.
// Клавиши не ниже 56px: так требует проект (удобно попадать пальцем).
const BASE_KEY =
  'flex min-h-[56px] select-none items-center justify-center rounded-[1.1rem] border text-[1.75rem] font-semibold leading-none ' +
  'tracking-tight transition duration-150 ease-spring active:scale-[0.93] disabled:opacity-40 disabled:active:scale-100 ' +
  'shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_6px_14px_-9px_rgb(var(--brand)/0.55)]';
const KEY_CLASS = `${BASE_KEY} border-border/80 bg-surface text-text active:bg-brand/10`;
const SERVICE_CLASS = `${BASE_KEY} border-border/60 bg-surface-2 text-muted active:bg-border`;
// Знаки действий нужны реже цифр: строка над цифрами 44 px (в низких окнах — 40, см. COMPACT_KEYPAD), значки рисуются сами — шрифт «÷» и «×» искажал.
const OP_CLASS =
  'flex h-11 min-h-0 select-none items-center justify-center rounded-xl border border-brand/25 bg-brand/10 text-brand transition duration-150 ease-spring ' +
  'active:scale-[0.93] active:bg-brand/25 disabled:opacity-40 disabled:active:scale-100';
const EQUAL_CLASS =
  'flex h-11 min-h-0 select-none items-center justify-center rounded-xl border border-transparent bg-gradient-to-br from-brand to-accent text-brand-fg ' +
  'transition duration-150 ease-spring active:scale-[0.93] active:brightness-90 disabled:bg-none disabled:bg-brand/30 disabled:active:scale-100';

/** Значки действий: линии одной толщины, одинаковые на любом телефоне. */
function OpGlyph({ op }: { op: OpKey | '=' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      {op === '+' && <path {...common} d="M12 5v14M5 12h14" />}
      {op === '−' && <path {...common} d="M5 12h14" />}
      {op === '×' && <path {...common} d="M6.5 6.5l11 11M17.5 6.5l-11 11" />}
      {op === '÷' && (
        <>
          <path {...common} d="M5 12h14" />
          <circle cx="12" cy="6.2" r="1.7" fill="currentColor" />
          <circle cx="12" cy="17.8" r="1.7" fill="currentColor" />
        </>
      )}
      {op === '=' && <path {...common} d="M5.5 9.5h13M5.5 14.5h13" />}
    </svg>
  );
}

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
      data-op=""
      className={OP_CLASS}
      disabled={disabled}
      onMouseDown={keep}
      onClick={press(op)}
    >
      <OpGlyph op={op} />
    </button>
  );

  const digit = (d: AmountKey, extra = '') => (
    <button key={d} type="button" className={cn(KEY_CLASS, extra)} disabled={disabled} onMouseDown={keep} onClick={press(d)}>
      {d}
    </button>
  );
  const comma =
    allowComma || ops ? (
      <button
        type="button"
        aria-label="Запятая"
        className={KEY_CLASS}
        disabled={disabled || !allowComma}
        onMouseDown={keep}
        onClick={press(',')}
      >
        ,
      </button>
    ) : (
      <span aria-hidden="true" />
    );
  const backspace = (
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
  );
  // Цифры, внизу «, 0 ⌫». Калькулятор: 7-8-9 сверху, как на нём; обычный ввод: 1-2-3 сверху, как на телефоне.
  const pad = (
    <div
      data-pad=""
      className={cn('grid grid-cols-3 gap-2', ops ? '' : className)}
      {...(ops ? {} : { role: 'group', 'aria-label': 'Цифровая клавиатура' })}
    >
      {(ops ? CALC_ROWS : DIGIT_ROWS).flatMap((row) => row.map((d) => digit(d)))}
      {comma}
      {digit('0')}
      {backspace}
    </div>
  );

  if (!ops) return pad;
  // Сверху узкая строка действий и «=»: они нужны реже цифр.
  return (
    <div role="group" aria-label="Цифровая клавиатура" className={cn('flex flex-col gap-2', className)}>
      <div className="grid grid-cols-5 gap-2">
        {OPS.map(opButton)}
        <button
          type="button"
          aria-label="Равно"
          data-op=""
          className={EQUAL_CLASS}
          disabled={disabled || !canEqual}
          onMouseDown={keep}
          onClick={press('=')}
        >
          <OpGlyph op="=" />
        </button>
      </div>
      {pad}
    </div>
  );
}
