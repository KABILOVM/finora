import { useState } from 'react';
import { Button } from '@/components/Button';
import { Glyph } from '@/components/Glyph';
import { MoneyText } from '@/components/MoneyText';
import { percentOf } from '@/domain/budgetLevels';
import { formatMinor } from '@/domain/money';
import type { Category, CurrencyCode, LocalRow } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import type { CategoryDelta } from './analytics';
import { capitalize } from './PeriodDelta';
import { changeText, percentChange } from './periodText';

/** Сколько категорий показываем списком; остальные — по кнопке. */
export const PERIOD_ROWS = 8;

export type ListKind = 'expense' | 'income';

type Tone = 'expense' | 'income' | 'muted';
const TONE: Record<Tone, string> = { expense: 'text-expense', income: 'text-income', muted: 'text-muted' };

/**
 * Подпись сдвига категории против сравниваемого периода. Для расходов рост плох (красный), для доходов — хорош (зелёный).
 * «новая» — раньше в этой категории ничего не было, «нет трат/доходов» — теперь ничего нет.
 */
export function periodDeltaLabel(d: Pick<CategoryDelta, 'currentMinor' | 'previousMinor'>, kind: ListKind): { text: string; tone: Tone; aria: string } | null {
  const { currentMinor: cur, previousMinor: prev } = d;
  if (cur <= 0 && prev <= 0) return null;
  const worseWhenUp = kind === 'expense';
  if (prev <= 0) return { text: 'новая', tone: worseWhenUp ? 'expense' : 'income', aria: 'раньше такой категории не было' };
  if (cur <= 0) return { text: kind === 'expense' ? 'нет трат' : 'нет доходов', tone: worseWhenUp ? 'income' : 'expense', aria: kind === 'expense' ? 'теперь трат нет' : 'теперь доходов нет' };
  const pct = percentChange(cur, prev);
  if (pct === null || pct === 0) return { text: 'столько же', tone: 'muted', aria: 'без изменений' };
  return {
    text: changeText(cur, prev) ?? '',
    tone: (pct > 0) === worseWhenUp ? 'expense' : 'income',
    aria: pct > 0 ? `на ${pct}% больше` : `на ${-pct}% меньше`,
  };
}

export interface PeriodCategoriesProps {
  deltas: readonly CategoryDelta[];
  categories: ReadonlyMap<string, LocalRow<Category>>;
  base: CurrencyCode;
  /** Все расходы (доходы) периода: от них считается доля категории. */
  totalMinor: number;
  kind: ListKind;
  /** «в прошлом году»…; пусто — без сравнения: показываем только суммы и доли. */
  phrase: string;
}

/** Расходы (или доходы) периода по категориям: доля от всего, сумма и сдвиг против сравниваемого периода. Больше восьми — «Показать ещё N». */
export function PeriodCategories({ deltas, categories, base, totalMinor, kind, phrase }: PeriodCategoriesProps) {
  const [all, setAll] = useState(false);
  const shown = all ? deltas : deltas.slice(0, PERIOD_ROWS);
  const rest = deltas.length - PERIOD_ROWS;
  const compared = phrase !== '';
  const label = kind === 'expense' ? 'Расходы по категориям' : 'Доходы по категориям';
  return (
    <>
      <ul className="flex flex-col divide-y divide-border" aria-label={label}>
        {shown.map((d) => {
          const fee = d.kind === 'fee';
          const cat = d.categoryId === null ? undefined : categories.get(d.categoryId);
          const name = fee ? 'Комиссии' : (cat?.name ?? 'Без категории');
          const share = percentOf(d.currentMinor, totalMinor);
          const delta = compared ? periodDeltaLabel(d, kind) : null;
          return (
            <li key={d.key} className="flex min-h-[56px] items-center gap-3 py-2" data-testid={`${kind}-cat-${d.key}`}>
              <Glyph value={fee ? '🏦' : (cat?.icon ?? '➖')} color={fee ? undefined : cat?.color} size={32} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-medium">{name}</span>
                  {d.currentMinor > 0 && <span className="shrink-0 text-xs text-muted">{share === 0 ? '<1%' : `${share}%`}</span>}
                </span>
                {d.currentMinor > 0 && (
                  <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-pill bg-surface-2">
                    <span className={`block h-full rounded-pill ${kind === 'income' ? 'bg-income/70' : 'bg-brand/70'}`} style={{ width: `${Math.max(share, 2)}%` }} />
                  </span>
                )}
                {compared && d.previousMinor > 0 && (
                  <span className="mt-0.5 block text-xs text-muted">
                    {capitalize(phrase)} {formatMinor(d.previousMinor, base)}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <MoneyText minor={d.currentMinor} currency={base} tone="none" className="block font-semibold" />
                {delta && (
                  <span className={`block text-xs font-semibold ${TONE[delta.tone]}`} aria-label={delta.aria}>
                    {delta.text}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {rest > 0 && (
        <Button variant="ghost" fullWidth className="mt-1" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Свернуть' : `Показать ещё ${rest} ${pluralRu(rest, 'категорию', 'категории', 'категорий')}`}
        </Button>
      )}
    </>
  );
}
