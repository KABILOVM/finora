import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode } from '@/domain/types';
import { endSentence } from '@/features/transactions/txDisplay';
import { ruDate } from '@/features/transactions/txForm';
import { enteredNote } from '@/rates/enteredText';
import type { HomeTotal } from './homeData';
import { HomeMoney, useHideAmounts } from './hideAmounts';
import { Sparkline } from './Sparkline';
import { useHomeFlow } from './useHomeFlow';

export interface HomeHeroProps {
  total: HomeTotal | null;
  base: CurrencyCode;
}

function Capsule({ testId, icon, index, children }: { testId: string; icon: 'income' | 'expense'; index: number; children: React.ReactNode }) {
  return (
    <span
      data-testid={testId}
      style={{ '--i': index } as React.CSSProperties}
      className="pop-spring inline-flex items-center gap-2 rounded-full bg-white/15 py-1 pl-1 pr-3 text-sm font-semibold backdrop-blur"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/25">
        <Icon name={icon} size={15} />
      </span>
      {children}
    </span>
  );
}

/**
 * Размер цифр итога: на телефоне 9vw (от 1,75 до 2,75 rem), но так, чтобы справа осталось место для графика (около 5,5 rem; знак
 * 0,56 em, плюс поля страницы и карточки около 5 rem). Длинная сумма (сум, тенге) просто становится мельче.
 */
function totalFontSize(chars: number): string {
  const n = Math.max(1, chars);
  return `min(clamp(1.75rem, 9vw, 2.75rem), calc((100vw - 10.5rem) / ${(n * 0.56).toFixed(2)}))`;
}

/**
 * Пояснения к итогу: всё, что раньше стояло строками под суммой. Показываются по нажатию на ⓘ или на жёлтую строку.
 * Когда суммы скрыты глазом, вместо остатков называем только валюты.
 */
function TotalNotes({ total, hidden }: { total: HomeTotal; hidden: boolean }) {
  const notes: string[] = [];
  if (total.approximate && total.missing.length === 0 && total.viaOtherRates) notes.push('Остатки в других валютах пересчитаны по курсу.');
  if (total.entered.length > 0) notes.push(enteredNote(total.entered));
  if (total.missing.length > 0) {
    const what = hidden ? total.missing.map((m) => m.currency).join(', ') : total.missing.map((m) => formatMinor(m.balanceMinor, m.currency)).join(', ');
    notes.push(`Не вошло в итог — нет курса: ${endSentence(what)}`);
  }
  if (total.stale.length > 0) {
    notes.push(`Курс устарел (${total.stale.map((s) => `${s.currency} на ${ruDate(s.asOf)}`).join(', ')}) — итог может быть неточным.`);
  }
  return (
    <ul className="flex flex-col gap-3 text-base">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

/**
 * Верхняя карточка главной: «Всего», приход и расход месяца и график остатка за две недели фоном. Пояснения про курсы
 * спрятаны за значок ⓘ; снаружи остаётся только короткая жёлтая строка, если часть денег не вошла в итог.
 */
export function HomeHero({ total, base }: HomeHeroProps) {
  const flow = useHomeFlow(total ? total.totalMinor : null, base);
  const { hidden, toggle } = useHideAmounts();
  const [notesOpen, setNotesOpen] = useState(false);

  const hasNotes = total !== null && (total.approximate || total.entered.length > 0 || total.missing.length > 0 || total.stale.length > 0);
  const stale = total !== null && total.stale.length > 0;

  return (
    <section
      aria-label="Всего денег"
      data-testid="home-total"
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-hero-from to-hero p-4 text-white shadow-[0_24px_50px_-22px_rgb(var(--brand)/0.9)] md:p-6"
    >
      {/* Декор: два больших полупрозрачных круга (не мешают тексту и касаниям). */}
      <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 h-64 w-64 animate-[backdrop-drift_9s_ease-in-out_infinite_alternate] rounded-full bg-white/15" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-24 h-44 w-44 animate-[backdrop-drift_12s_ease-in-out_infinite_alternate-reverse] rounded-full bg-white/10" />
      <div className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
        <div className="col-start-1 flex items-center gap-1.5">
          <p className="text-sm font-medium opacity-90">Всего</p>
          <button
            type="button"
            onClick={toggle}
            aria-pressed={hidden}
            aria-label={hidden ? 'Показать суммы' : 'Скрыть суммы'}
            className="press flex h-8 w-8 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
          >
            <Icon name={hidden ? 'eye-off' : 'eye'} size={17} />
          </button>
          {hasNotes && (
            <button
              type="button"
              onClick={() => setNotesOpen(true)}
              aria-label="Как посчитан итог"
              className="press relative flex h-8 w-8 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
            >
              <Icon name="info" size={17} />
              {stale && <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-amber-300 ring-2 ring-hero" />}
            </button>
          )}
        </div>

        {total ? (
          <>
            {/* Размер цифр плавно уменьшается на узком экране и при длинной сумме: справа должно остаться место для графика. */}
            <p
              className="col-start-1 mt-0.5 font-extrabold leading-tight tracking-tight"
              style={{ fontSize: totalFontSize(formatMinor(total.totalMinor, base).length + (total.approximate ? 2 : 0)) }}
            >
              {total.approximate && <span title="Приблизительно: часть денег пересчитана по курсу">≈ </span>}
              <HomeMoney minor={total.totalMinor} currency={base} tone="none" animated />
            </p>
            {/* График остатка за две недели стоит справа от суммы, на месте, которое иначе пустовало. Скрыты суммы — скрыт и он. */}
            {flow?.series && !hidden && (
              <div aria-hidden="true" className="pointer-events-none col-start-2 row-span-2 row-start-1 flex w-full max-w-[10.5rem] items-center justify-self-end text-white/70">
                <Sparkline points={flow.series} slot className="w-full" />
              </div>
            )}
            {flow && (
              <div className="col-span-2 mt-2 flex flex-wrap gap-2">
                <Capsule testId="home-flow-income" icon="income" index={0}>
                  <HomeMoney minor={flow.incomeMinor} currency={base} tone="none" sign="always" animated />
                </Capsule>
                <Capsule testId="home-flow-expense" icon="expense" index={1}>
                  <HomeMoney minor={-flow.expenseMinor} currency={base} tone="none" sign="auto" animated />
                </Capsule>
              </div>
            )}
            {total.missing.length > 0 && (
              <button
                type="button"
                onClick={() => setNotesOpen(true)}
                className="press relative col-span-2 mt-3 flex min-h-[40px] w-full items-center gap-2 rounded-xl bg-surface px-3 py-1.5 text-left text-sm font-medium text-warning"
              >
                <Icon name="alert" size={16} className="shrink-0" />
                <span className="min-w-0 truncate">Не вошло в итог: нет курса ({total.missing.map((m) => m.currency).join(', ')})</span>
              </button>
            )}
          </>
        ) : (
          <p className="col-span-2 mt-1 text-4xl font-bold">—</p>
        )}
      </div>

      {total && (
        <Sheet open={notesOpen} onClose={() => setNotesOpen(false)} title="Как посчитан итог">
          <TotalNotes total={total} hidden={hidden} />
        </Sheet>
      )}
    </section>
  );
}
