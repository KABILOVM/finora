import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { addMinor, formatMinor } from '@/domain/money';
import type { CurrencyCode, Minor } from '@/domain/types';
import { endSentence } from '@/features/transactions/txDisplay';
import { ruDate } from '@/features/transactions/txForm';
import { enteredNote } from '@/rates/enteredText';
import type { WalletsTotal } from '@/rates/walletsTotal';
import { HomeMoney, useHideAmounts } from './hideAmounts';
import { Sparkline } from './Sparkline';
import { useHomeFlow } from './useHomeFlow';

export interface HomeHeroProps {
  total: WalletsTotal | null;
  base: CurrencyCode;
}

/**
 * Приход или расход месяца: значок, подпись и сумма. Сумма стоит в своём элементе с data-testid, без подписи:
 * так её читают и сценарии, и «Классика (прежняя)», где подпись спрятана и плитка выглядит прежней капсулой.
 */
function Stat({ testId, icon, label, index, children }: { testId: string; icon: 'income' | 'expense'; label: string; index: number; children: React.ReactNode }) {
  return (
    <span
      style={{ '--i': index } as React.CSSProperties}
      className="hero-stat pop-spring inline-flex min-w-0 flex-1 basis-[8.5rem] items-center gap-2.5 rounded-2xl bg-white/[0.13] py-2 pl-2 pr-3 backdrop-blur"
    >
      <span className="hero-stat-ico flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0 leading-tight">
        <span aria-hidden="true" className="hero-stat-label block text-[11px] font-medium opacity-75">
          {label}
        </span>
        <span data-testid={testId} className="block text-[15px] font-bold">
          {children}
        </span>
      </span>
    </span>
  );
}

/**
 * Пояснения к итогу: всё, что раньше стояло строками под суммой. Показываются по нажатию на ⓘ или на жёлтую строку.
 * Когда суммы скрыты глазом, вместо остатков называем только валюты.
 */
function TotalNotes({ total, hidden }: { total: WalletsTotal; hidden: boolean }) {
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
      className="skin-hero relative overflow-hidden rounded-3xl bg-gradient-to-br from-hero-from to-hero p-5 text-white shadow-[0_24px_50px_-22px_rgb(var(--brand)/0.9)] md:p-7"
    >
      {/* Декор (не мешает тексту и касаниям). Два круга — у «Классики (прежней)»; тонкие кольца из угла — у новой базы; что видно, решает look.css. */}
      <span aria-hidden="true" className="hero-orb fx-loop pointer-events-none absolute -right-16 -top-28 h-64 w-64 animate-[backdrop-drift_9s_ease-in-out_infinite_alternate] rounded-full bg-white/15" />
      <span aria-hidden="true" className="hero-orb fx-loop pointer-events-none absolute -bottom-28 right-24 h-44 w-44 animate-[backdrop-drift_12s_ease-in-out_infinite_alternate-reverse] rounded-full bg-white/10" />
      <span aria-hidden="true" className="hero-lines pointer-events-none absolute inset-0" />
      {/* График остатка за две недели — мягкой подложкой внизу карточки. */}
      {flow?.series && !hidden && (
        <div aria-hidden="true" className="hero-spark pointer-events-none absolute inset-x-3 bottom-1 text-white/60">
          <Sparkline points={flow.series} fit />
        </div>
      )}

      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="hero-label text-sm font-semibold opacity-90">Всего</p>
            <button
              type="button"
              onClick={toggle}
              aria-pressed={hidden}
              aria-label={hidden ? 'Показать суммы' : 'Скрыть суммы'}
              className="press tap-44 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
            >
              <Icon name={hidden ? 'eye-off' : 'eye'} size={17} />
            </button>
            {hasNotes && (
              <button
                type="button"
                onClick={() => setNotesOpen(true)}
                aria-label="Как посчитан итог"
                className="press tap-44 relative flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
              >
                <Icon name="info" size={17} />
                {stale && <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-amber-300 ring-2 ring-hero" />}
              </button>
            )}
          </div>
          {net !== null && (
            <div data-testid="home-flow-net" className="hero-net min-w-0 rounded-2xl bg-white/[0.13] px-3 py-1.5 text-right leading-tight backdrop-blur">
              <p className="text-[11px] font-medium opacity-75">За месяц</p>
              <HomeMoney minor={net} currency={base} tone="none" sign="always" animated className="block truncate text-sm font-bold" />
            </div>
          )}
        </div>

        {total ? (
          <>
            {/* Размер цифр плавно уменьшается на узком экране: длинная сумма не должна уходить за край (и обрезаться). */}
            <p className="hero-amount num-xl mt-2 text-[clamp(2rem,10.5vw,3.25rem)] font-extrabold">
              {total.approximate && <span title="Приблизительно: часть денег пересчитана по курсу">≈ </span>}
              <HomeMoney minor={total.totalMinor} currency={base} tone="none" animated />
            </p>
            {flow && (
              <div className="hero-stats mt-4 flex flex-wrap gap-2">
                <Stat testId="home-flow-income" icon="income" label="Доходы" index={0}>
                  <HomeMoney minor={flow.incomeMinor} currency={base} tone="none" sign="always" animated />
                </Stat>
                <Stat testId="home-flow-expense" icon="expense" label="Расходы" index={1}>
                  <HomeMoney minor={-flow.expenseMinor} currency={base} tone="none" sign="auto" animated />
                </Stat>
              </div>
            )}
            {total.missing.length > 0 && (
              <button
                type="button"
                onClick={() => setNotesOpen(true)}
                className="press relative mt-3 flex min-h-[44px] w-full items-center gap-2 rounded-xl bg-surface px-3 py-1.5 text-left text-sm font-medium text-warning"
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
        {flow?.series && !hidden && <div aria-hidden="true" className="hero-spark-gap h-[4.25rem]" />}
      </div>

      {total && (
        <Sheet open={notesOpen} onClose={() => setNotesOpen(false)} title="Как посчитан итог">
          <TotalNotes total={total} hidden={hidden} />
        </Sheet>
      )}
    </section>
  );
}
