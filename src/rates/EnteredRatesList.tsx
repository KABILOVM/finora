import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { currencyInfo } from '@/domain/currency';
import { formatRate } from '@/features/settings/rateInput';
import { enteredLabel } from './enteredText';
import { useEnteredRates, useRateService, useRates } from './hooks';

/**
 * Курсы, которые человек сам ввёл в операциях (Настройки → Курсы валют). У каждого — день ввода и кнопка «Сбросить».
 * Эти курсы работают, только если нет свежего курса из сети и «Своего курса»; поэтому для каждого сказано, действует ли он сейчас.
 * Пока ни одного нет, блока на экране нет.
 */
export function EnteredRatesList() {
  const entered = useEnteredRates();
  const service = useRateService();
  const { getRate } = useRates();
  const toast = useToast();

  if (entered.length === 0) return null;

  const reset = (from: string, to: string): void => {
    try {
      service.forgetEnteredRate(from, to);
      toast.success(`Введённый курс ${from} → ${to} сброшен`);
    } catch (e) {
      console.error('Не удалось сбросить введённый курс:', e);
      toast.error('Не удалось сбросить курс. Попробуйте ещё раз.');
    }
  };

  return (
    <div className="flex flex-col gap-1" data-testid="entered-rates">
      <h3 className="text-base font-semibold">Курсы, введённые в операциях</h3>
      <p className="text-sm text-muted">
        Работают, пока нет свежего курса из сети (не старше 3 суток) и «Своего курса». Свежий курс Нацбанка их всегда перекрывает.
      </p>
      <ul className="divide-y divide-border">
        {entered.map((e) => {
          const inUse = getRate(e.from, e.to)?.entered === true;
          return (
            <li key={`${e.from}>${e.to}`} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="font-semibold">{`1 ${e.from} = ${formatRate(e.rate)} ${currencyInfo(e.to).symbol}`}</div>
                <div className="text-sm text-muted">
                  {enteredLabel(e.enteredOn)}
                  {inUse ? '' : ' · сейчас не используется: есть другой курс'}
                </div>
              </div>
              <Button variant="secondary" aria-label={`Сбросить введённый курс ${e.from}`} onClick={() => reset(e.from, e.to)}>
                Сбросить
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
