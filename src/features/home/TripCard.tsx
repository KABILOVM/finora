import { Link } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import { useActiveTrip } from '@/features/trips/activeTrip';
import { tagKey, tagLabel } from '@/features/trips/trips';
import { useTrips } from '@/features/trips/useTrips';

function ActiveTripCard({ tag, onEnd }: { tag: string; onEnd: () => void }) {
  const data = useTrips();
  const spent = data ? (data.trips.find((t) => t.key === tagKey(tag))?.expenseMinor ?? 0) : null;
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
                  Потрачено <MoneyText minor={spent} currency={data.base} tone="none" className="font-semibold text-text" />. Новые операции получают метку #{tag}.
                </>
              ) : (
                <>Новые операции получают метку #{tag}.</>
              )}
            </p>
          </div>
        </div>
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
  const active = useActiveTrip(store.userId);
  if (active.tag === null) return null;
  return (
    <ActiveTripCard
      tag={active.tag}
      onEnd={() => {
        active.end();
        toast.show('Поездка завершена: новые операции без метки');
      }}
    />
  );
}
