import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Glyph } from '@/components/Glyph';
import { MoneyText } from '@/components/MoneyText';
import { formatMinor } from '@/domain/money';
import type { Category, CurrencyCode, LocalRow } from '@/domain/types';
import { transactionsQuery } from '@/features/transactions/txFilters';
import { pluralRu } from '@/lib/plural';
import { percentOf } from '@/domain/budgetLevels';
import { isCompareReady, previousPhrase, type CategoryDelta } from './analytics';

/** Сколько категорий показываем списком; остальные — одной строкой «ещё N». */
export const COMPARE_ROWS = 8;

/** «▲ +50%», «▼ −20%», «новая», «нет трат», «столько же». Рост расходов красный (хуже), снижение зелёное (лучше). */
export function deltaLabel(
  d: Pick<CategoryDelta, 'status' | 'percent'>,
  /** С чем сравнивали: «в прошлом месяце» (по умолчанию) или «за те же 15 дней прошлого месяца». */
  then = 'в прошлом месяце',
): { text: string; tone: 'expense' | 'income' | 'muted'; aria: string } {
  const pct = d.percent;
  switch (d.status) {
    case 'new':
      return { text: 'новая', tone: 'expense', aria: `${then} трат не было` };
    case 'later':
      // в прошлом месяце категория была, но позже — «новой» её называть нельзя
      return { text: 'без сравнения', tone: 'muted', aria: `${then} трат не было, но в прошлом месяце они были позже` };
    case 'gone':
      return { text: 'нет трат', tone: 'income', aria: 'в этом месяце трат нет' };
    case 'up':
      return { text: `▲ +${pct}%`, tone: 'expense', aria: `на ${pct}% больше, чем ${then}` };
    case 'down':
      return { text: `▼ −${Math.abs(pct ?? 0)}%`, tone: 'income', aria: `на ${Math.abs(pct ?? 0)}% меньше, чем ${then}` };
    default:
      return { text: 'столько же', tone: 'muted', aria: `как ${then}` };
  }
}

const TONE = { expense: 'text-expense', income: 'text-income', muted: 'text-muted' } as const;

export interface CategoryCompareProps {
  deltas: readonly CategoryDelta[];
  categories: ReadonlyMap<string, LocalRow<Category>>;
  base: CurrencyCode;
  month: string;
  /** Все расходы месяца: от них считается доля категории. */
  totalMinor: number;
  /** null — сравнение с прошлым месяцем целиком; число — с его первыми днями (идущий месяц). */
  compareDays?: number | null;
}

/**
 * Расходы по категориям против прошлого месяца (идущего — против тех же дней прошлого), с долей от всех расходов. Строка — ссылка на
 * операции этой категории за выбранный месяц. Категорий больше восьми — остальные раскрываются кнопкой «Показать ещё N».
 */
export function CategoryCompare({ deltas, categories, base, month, totalMinor, compareDays = null }: CategoryCompareProps) {
  const [all, setAll] = useState(false);
  const shown = all ? deltas : deltas.slice(0, COMPARE_ROWS);
  const rest = deltas.length - COMPARE_ROWS;
  const then = previousPhrase(compareDays);
  const ready = isCompareReady(compareDays);
  return (
    <>
      {compareDays !== null && (
        <p className="mb-1 text-sm text-muted" data-testid="compare-note">
          {ready
            ? `Месяц ещё идёт, поэтому сравниваем с числами 1–${compareDays} прошлого месяца, а не со всем месяцем.`
            : 'Месяц только начался: сравнение с прошлым месяцем появится через пару дней.'}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border" aria-label="Расходы по категориям">
        {shown.map((d) => {
          const fee = d.kind === 'fee';
          const cat = d.categoryId === null ? undefined : categories.get(d.categoryId);
          const name = fee ? 'Комиссии' : (cat?.name ?? 'Без категории');
          const label = ready ? deltaLabel(d, then) : null;
          const share = percentOf(d.currentMinor, totalMinor);
          const query = fee ? transactionsQuery({ month, kind: 'transfer' }) : transactionsQuery({ month, categoryId: d.categoryId, kind: 'expense' });
          return (
            <li key={d.key}>
              <Link to={`/transactions?${query}`} className="flex min-h-[56px] items-center gap-3 py-2 transition-colors hover:bg-surface-2/60" data-testid={`compare-${d.key}`}>
                <Glyph value={fee ? '🏦' : (cat?.icon ?? '➖')} color={fee ? undefined : cat?.color} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate font-medium">{name}</span>
                    {d.currentMinor > 0 && (
                      <span className="shrink-0 text-xs text-muted" data-testid={`share-${d.key}`}>
                        {share === 0 ? '<1%' : `${share}%`}
                      </span>
                    )}
                  </span>
                  {d.currentMinor > 0 && (
                    <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-pill bg-surface-2">
                      <span className="block h-full rounded-pill bg-brand/70" style={{ width: `${Math.max(share, 2)}%` }} />
                    </span>
                  )}
                  {ready && (
                    <span className="mt-0.5 block text-xs text-muted">
                      {d.previousMinor > 0 ? `${capitalize(then)} ${formatMinor(d.previousMinor, base)}` : `${capitalize(then)} трат не было`}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <MoneyText minor={d.currentMinor} currency={base} tone="none" className="block font-semibold" />
                  {label && (
                    <span className={`block text-xs font-semibold ${TONE[label.tone]}`} aria-label={label.aria}>
                      {label.text}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {rest > 0 && (
        // переключатель, а не одноразовая кнопка: после «Показать ещё» она не пропадает, и фокус клавиатуры не теряется
        <Button variant="ghost" fullWidth className="mt-1" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Свернуть' : `Показать ещё ${rest} ${pluralRu(rest, 'категорию', 'категории', 'категорий')}`}
        </Button>
      )}
    </>
  );
}

const capitalize = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
