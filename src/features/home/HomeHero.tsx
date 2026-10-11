import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { useCountUp } from '@/components/useCountUp';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, TxKind } from '@/domain/types';
import { endSentence } from '@/features/transactions/txDisplay';
import { ruDate } from '@/features/transactions/txForm';
import { useAddLink } from '@/layout/nav';
import { enteredNote } from '@/rates/enteredText';
import type { HomeTotal } from './homeData';
import { Sparkline } from './Sparkline';
import { useHomeFlow } from './useHomeFlow';

const HIDE_KEY = 'finora-hide-balance';

/** «Скрыть суммы» — выбор хранится на устройстве: удобно открывать приложение при посторонних. */
function useHideAmounts(): [boolean, () => void] {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(HIDE_KEY, hidden ? '1' : '0');
    } catch {
      /* не сохранилось — работает до перезагрузки */
    }
  }, [hidden]);
  return [hidden, () => setHidden((v) => !v)];
}

function QuickAction({ kind, label, icon, tone }: { kind: TxKind; label: string; icon: 'expense' | 'income' | 'transfer'; tone: string }) {
  const link = useAddLink(kind);
  return (
    <Link
      {...link}
      className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full bg-white/20 py-1.5 pl-1.5 pr-4 text-sm font-semibold backdrop-blur transition duration-200 ease-spring hover:bg-white/30 active:scale-95"
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-full bg-white ${tone}`}>
        <Icon name={icon} size={20} />
      </span>
      {label}
    </Link>
  );
}

export interface HomeHeroProps {
  total: HomeTotal | null;
  base: CurrencyCode;
}

/** Верхняя карточка главной: «Всего», итоги месяца, график остатка, быстрые кнопки «Расход / Доход / Перевод». */
export function HomeHero({ total, base }: HomeHeroProps) {
  const flow = useHomeFlow(total ? total.totalMinor : null, base);
  const [hidden, toggleHidden] = useHideAmounts();
  const animated = useCountUp(total ? total.totalMinor : 0);

  return (
    <section
      aria-label="Всего денег"
      data-testid="home-total"
      className="relative animate-rise overflow-hidden rounded-3xl bg-gradient-to-br from-hero-from to-hero p-4 text-white shadow-[0_24px_50px_-22px_rgb(var(--brand)/0.9)] md:p-6"
    >
      {/* Декор: два больших полупрозрачных круга (не мешают тексту и касаниям). */}
      <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 h-64 w-64 animate-[backdrop-drift_9s_ease-in-out_infinite_alternate] rounded-full bg-white/15" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-24 h-44 w-44 animate-[backdrop-drift_12s_ease-in-out_infinite_alternate-reverse] rounded-full bg-white/10" />

      <div className="relative grid gap-3 md:grid-cols-[1.1fr_0.9fr] md:items-center md:gap-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium opacity-90">Всего</p>
            <button
              type="button"
              onClick={toggleHidden}
              aria-pressed={hidden}
              aria-label={hidden ? 'Показать суммы' : 'Скрыть суммы'}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 transition duration-200 ease-spring hover:bg-white/25 active:scale-90"
            >
              <Icon name={hidden ? 'eye-off' : 'eye'} size={17} />
            </button>
          </div>
          {total ? (
            <>
              {/* Размер цифр плавно уменьшается на узком экране: длинная сумма не должна уходить за край (и обрезаться). */}
              <p className="mt-0.5 text-[clamp(1.75rem,9vw,2.75rem)] font-extrabold leading-tight tracking-tight">
                {total.approximate && <span title="Приблизительно: часть денег пересчитана по курсу">≈ </span>}
                {hidden ? (
                  <span aria-label="Сумма скрыта">••••••</span>
                ) : (
                  <MoneyText minor={animated} currency={base} tone="none" />
                )}
              </p>
              {total.approximate && total.missing.length === 0 && total.viaOtherRates && (
                <p className="mt-0.5 text-[13px] opacity-90">Остатки в других валютах пересчитаны по курсу.</p>
              )}
              {total.entered.length > 0 && (
                <p className="mt-0.5 text-[13px] opacity-90" data-testid="home-total-entered">
                  {enteredNote(total.entered)}
                </p>
              )}
              {flow && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/15 py-1 pl-1 pr-3 text-sm font-semibold backdrop-blur">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/25">
                      <Icon name="income" size={15} />
                    </span>
                    {hidden ? '••••' : <MoneyText minor={flow.incomeMinor} currency={base} tone="none" sign="always" />}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/15 py-1 pl-1 pr-3 text-sm font-semibold backdrop-blur">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/25">
                      <Icon name="expense" size={15} />
                    </span>
                    {hidden ? '••••' : <MoneyText minor={-flow.expenseMinor} currency={base} tone="none" sign="auto" />}
                  </span>
                </div>
              )}
            </>
          ) : (
            <p className="mt-1 text-4xl font-bold">—</p>
          )}
        </div>
        {flow?.series && !hidden && (
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold opacity-80">14 дней</p>
            <Sparkline points={flow.series} className="text-white" />
          </div>
        )}
      </div>

      <div className="relative mt-4 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        <QuickAction kind="expense" label="Расход" icon="expense" tone="text-rose-600" />
        <QuickAction kind="income" label="Доход" icon="income" tone="text-emerald-600" />
        <QuickAction kind="transfer" label="Перевод" icon="transfer" tone="text-indigo-600" />
      </div>

      {total && (total.missing.length > 0 || total.stale.length > 0) && (
        <div className="relative mt-3 flex flex-col gap-1.5">
          {total.missing.length > 0 && (
            <p className="rounded-xl bg-surface p-2.5 text-sm font-medium text-warning">
              Не вошло в итог — нет курса:{' '}
              {endSentence(total.missing.map((m) => formatMinor(m.balanceMinor, m.currency)).join(', '))}
            </p>
          )}
          {total.stale.length > 0 && (
            <p className="rounded-xl bg-surface p-2.5 text-sm font-medium text-warning">
              Курс устарел ({total.stale.map((s) => `${s.currency} на ${ruDate(s.asOf)}`).join(', ')}) — итог может быть неточным.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
