import { Link } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import { toastWithUndo } from '@/features/transactions/txActions';
import { useAddLink } from '@/layout/nav';
import { useToday } from '@/recurring/useToday';
import { missedText, useMissedDays, useQuietThrough, writeQuietThrough } from './missedDays';

/**
 * Плашка «3 дня без записей — всё в порядке?» на «Главной»: спокойная (не тревога), с двумя кнопками. «Внести траты» открывает форму сразу
 * на вчерашнем дне; «Ничего не тратил(а)» помечает дни до вчера как прошедшие без трат (на этом устройстве), с «Отменить».
 * Появляется, только когда без записей два дня подряд и больше (до вчера включительно); как только внесли операцию, исчезает.
 */
export default function MissedDaysCard() {
  const store = useStore();
  const toast = useToast();
  const today = useToday();
  const missed = useMissedDays(today);
  const quiet = useQuietThrough(store.userId);
  const addLink = useAddLink('expense', undefined, missed?.yesterday);
  if (!missed) return null;

  const nothingSpent = () => {
    const previous = quiet;
    writeQuietThrough(store.userId, missed.yesterday);
    toastWithUndo(toast, 'Хорошо: эти дни отмечены как без трат', async () => writeQuietThrough(store.userId, previous), 'Отметка снята');
  };

  return (
    <section aria-label="Пропущенные дни" data-testid="missed-days" className="slide-down">
      <Card padding="none" className="p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Icon name="calendar" size={20} />
          </span>
          <p className="min-w-0 flex-1 text-base font-semibold text-text">{missedText(missed.days)}</p>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Link {...addLink} className={`${buttonClasses('primary', 'md')} min-w-[9rem] flex-1`}>
            Внести траты
          </Link>
          <Button variant="secondary" className="min-w-[9rem] flex-1" onClick={nothingSpent}>
            Ничего не тратил(а)
          </Button>
        </div>
      </Card>
    </section>
  );
}
