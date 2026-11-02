import { Link } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import { addMinor } from '@/domain/money';
import { useActiveTrip } from '@/features/trips/activeTrip';
import { tidyTripWallets } from '@/features/trips/endTrip';
import { useTripPlan } from '@/features/trips/tripPlan';
import { dailyAllowance, daysLeft } from '@/features/trips/tripRates';
import { hasTag, tagKey, tagLabel } from '@/features/trips/trips';
import { useTripMoney } from '@/features/trips/useTripMoney';
import { useTrips } from '@/features/trips/useTrips';
import { isSpend } from '@/features/analytics/anomalies';
import { useToday } from '@/recurring/useToday';

/** Деньги поездки на «Главной»: остаток каждой валюты в сомони по вашему курсу и «сколько ещё можно сегодня». */
function TripWallets({ tag }: { tag: string }) {
  const store = useStore();
  const today = useToday();
  const money = useTripMoney(tag);
  const { plan } = useTripPlan(store.userId, tag);
  const wallets = money ? money.wallets.filter((w) => !w.archived && w.balanceMinor > 0) : [];
  if (!money || wallets.length === 0) return null;
  const left = plan === null ? null : daysLeft(plan, today);
  return (
    <ul className="mt-2 flex flex-col gap-1 text-sm" data-testid="trip-card-wallets">
      {wallets.map((w) => {
        const allowance = left === null ? null : dailyAllowance(w.balanceMinor, w.spentTodayMinor, left);
        return (
          <li key={w.walletId} data-testid="trip-card-wallet">
            <span className="text-muted">Осталось </span>
            <MoneyText minor={w.balanceMinor} currency={w.currency} tone="none" className="font-semibold" />
            {w.valueMinor !== null && (
              <span className="text-muted">
                {' '}
                ≈ <MoneyText minor={w.valueMinor} currency={money.base} tone="none" className="font-semibold text-text" />
              </span>
            )}
            {allowance && (
              <span className="text-muted">
                {' '}
                · сегодня {allowance.leftTodayMinor >= 0 ? 'ещё можно' : 'сверх нормы'}{' '}
                <MoneyText minor={Math.abs(allowance.leftTodayMinor)} currency={w.currency} tone={allowance.leftTodayMinor >= 0 ? 'none' : 'expense'} className="font-semibold" />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ActiveTripCard({ tag, onEnd }: { tag: string; onEnd: () => void }) {
  const data = useTrips();
  const today = useToday();
  const spent = data ? (data.trips.find((t) => t.key === tagKey(tag))?.expenseMinor ?? 0) : null;
  // сколько потрачено сегодня (по снимкам в основной валюте)
  const spentToday = data
    ? data.txs.filter((t) => isSpend(t, data.base) && t.occurredOn === today && hasTag(t.note, tag)).reduce((sum, t) => addMinor(sum, t.baseAmountMinor), 0)
    : null;
  return (
    <section aria-labelledby="home-trip" data-testid="trip-card" className="slide-down">
      <Card padding="none" className="p-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
            <Icon name="plane" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="home-trip" className="truncate text-base font-semibold">
              Идёт поездка: {tagLabel(tag)}
            </h2>
            <p className="text-sm text-muted">
              {data && spent !== null ? (
                <>
                  Потрачено <MoneyText minor={spent} currency={data.base} tone="none" className="font-semibold text-text" />
                  {spentToday !== null && spentToday > 0 && (
                    <>
                      , сегодня <MoneyText minor={spentToday} currency={data.base} tone="none" className="font-semibold text-text" />
                    </>
                  )}
                  . Новые операции получают метку #{tag}.
                </>
              ) : (
                <>Новые операции получают метку #{tag}.</>
              )}
            </p>
          </div>
        </div>
        <TripWallets tag={tag} />
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Link to="/trips" className={`${buttonClasses('primary', 'md')} min-w-[9rem] flex-1`}>
            Открыть поездки
          </Link>
          <Button variant="ghost" aria-label={`Завершить поездку: ${tagLabel(tag)}`} className="min-w-[9rem] flex-1" onClick={onEnd}>
            Завершить
          </Button>
        </div>
      </Card>
    </section>
  );
}

/** «Идёт поездка» на «Главной», пока на этом устройстве включён режим поездки (activeTrip.ts); иначе карточки нет. */
export default function TripCard() {
  const store = useStore();
  const toast = useToast();
  const today = useToday();
  const active = useActiveTrip(store.userId);
  if (active.tag === null) return null;
  const tag = active.tag;
  return (
    <ActiveTripCard
      tag={tag}
      onEnd={() => {
        active.end();
        toast.show('Поездка завершена: новые операции без метки');
        void tidyTripWallets(store, toast, tag, today);
      }}
    />
  );
}
