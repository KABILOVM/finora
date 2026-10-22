import { MoneyText } from '@/components/MoneyText';
import type { CurrencyCode } from '@/domain/types';
import { changeText, percentChange } from './periodText';

export const capitalize = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

export type Good = 'up' | 'down';

/** Цвет сдвига: хорошо (зелёный), плохо (красный), без изменений (серый). Расходы растут — плохо, доходы растут — хорошо. */
export function deltaTone(current: number, previous: number, goodWhen: Good): 'income' | 'expense' | 'muted' {
  const pct = percentChange(current, previous);
  if (pct === null || pct === 0) return 'muted';
  return (pct > 0) === (goodWhen === 'up') ? 'income' : 'expense';
}

const TONE = { expense: 'text-expense', income: 'text-income', muted: 'text-muted' } as const;

/** Для скринридера: «▲ +12%» читается как геометрическая фигура, поэтому говорим словами. */
function deltaAria(current: number, previous: number): string {
  const pct = percentChange(current, previous);
  if (pct === null || pct === 0) return 'без изменений';
  return pct > 0 ? `на ${pct}% больше` : `на ${-pct}% меньше`;
}

export interface DeltaLineProps {
  current: number;
  previous: number;
  base: CurrencyCode;
  /** «в прошлом году», «за те же дни прошлого квартала»… */
  phrase: string;
  /** «расходов», «доходов»: для «В прошлом году расходов не было». */
  noun: string;
  goodWhen: Good;
  testId?: string;
}

/** «▲ +12% · в прошлом году 53 000 с.»; если раньше было ноль — «В прошлом году расходов не было»; если и сейчас ноль — ничего. */
export function DeltaLine({ current, previous, base, phrase, noun, goodWhen, testId }: DeltaLineProps) {
  if (previous <= 0) {
    return current > 0 ? (
      <p data-testid={testId} className="text-sm text-muted">
        {capitalize(phrase)} {noun} не было
      </p>
    ) : null;
  }
  const text = changeText(current, previous);
  return (
    <p data-testid={testId} className="text-sm">
      <span className={`font-semibold ${TONE[deltaTone(current, previous, goodWhen)]}`} aria-label={deltaAria(current, previous)}>
        {text}
      </span>
      <span className="text-muted">
        {' '}
        · {phrase} <MoneyText minor={previous} currency={base} tone="none" />
      </span>
    </p>
  );
}
