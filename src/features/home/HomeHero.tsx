import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { addMinor, formatMinor } from '@/domain/money';
import type { CurrencyCode, Minor } from '@/domain/types';
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

/** Разница месяца: приход минус расход; null — сумма не поместилась в безопасное целое (тогда блок просто не рисуем). */
function monthNet(incomeMinor: Minor, expenseMinor: Minor): Minor | null {
  try {
    return addMinor(incomeMinor, -expenseMinor);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
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
  const net = total && flow ? monthNet(flow.incomeMinor, flow.expenseMinor) : null;

  return (
    <section
      aria-label="Всего денег"
      data-testid="home-total"
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-hero-from to-hero p-4 text-white shadow-[0_24px_50px_-22px_rgb(var(--brand)/0.9)] md:p-6"
    >
      {/* Декор: два больших полупрозрачных круга (не мешают тексту и касаниям). */}
      <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 h-64 w-64 animate-[backdrop-drift_9s_ease-in-out_infinite_alternate] rounded-full bg-white/15" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-24 h-44 w-44 animate-[backdrop-drift_12s_ease-in-out_infinite_alternate-reverse] rounded-full bg-white/10" />
      {/* График остатка за две недели — мягкой подложкой внизу карточки. */}
      {flow?.series && !hidden && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 bottom-1 text-white/60">
          <Sparkline points={flow.series} fit />
        </div>
      )}

      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
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
          {net !== null && (
            <div data-testid="home-flow-net" className="min-w-0 text-right leading-tight">
              <p className="text-[11px] font-medium opacity-80">За месяц</p>
              <HomeMoney minor={net} currency={base} tone="none" sign="always" animated className="block truncate text-sm font-bold" />
            </div>
          )}
        </div>

        {total ? (
          <>
            {/* Размер цифр плавно уменьшается на узком экране: длинная сумма не должна уходить за край (и обрезаться). */}
            <p className="mt-0.5 text-[clamp(1.75rem,9vw,2.75rem)] font-extrabold leading-tight tracking-tight">
              {total.approximate && <span title="Приблизительно: часть денег пересчитана по курсу">≈ </span>}
              <HomeMoney minor={total.totalMinor} currency={base} tone="none" animated />
            </p>
            {flow && (
              <div className="mt-2 flex flex-wrap gap-2">
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
                className="press relative mt-3 flex min-h-[40px] w-full items-center gap-2 rounded-xl bg-surface px-3 py-1.5 text-left text-sm font-medium text-warning"
              >
                <Icon name="alert" size={16} className="shrink-0" />
                <span className="min-w-0 truncate">Не вошло в итог: нет курса ({total.missing.map((m) => m.currency).join(', ')})</span>
              </button>
            )}
          </>
        ) : (
          <p className="mt-1 text-4xl font-bold">—</p>
        )}
        {/* Место под график: он лежит подложкой, а подписи сверху его не закрывают. */}
        {flow?.series && !hidden && <div aria-hidden="true" className="h-8" />}
      </div>

      {total && (
        <Sheet open={notesOpen} onClose={() => setNotesOpen(false)} title="Как посчитан итог">
          <TotalNotes total={total} hidden={hidden} />
        </Sheet>
      )}
    </section>
  );
}
