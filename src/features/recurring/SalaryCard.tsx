import { useCallback, useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useStore } from '@/db';

const storageKey = (userId: string): string => `finora:dismissed-salary-card:${userId}`;

function readDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(userId)) === '1';
  } catch {
    return false;
  }
}

/** «Не нужно» хранится на этом устройстве (localStorage); если хранилище недоступно, отказ живёт до перезагрузки страницы. */
export function useSalaryCardDismissed(): [boolean, () => void] {
  const { userId } = useStore();
  const [dismissed, setDismissed] = useState(() => readDismissed(userId));
  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(storageKey(userId), '1');
    } catch {
      // хранилище недоступно (приватный режим, переполнено): отказ действует, пока страница открыта
    }
  }, [userId]);
  return [dismissed, dismiss];
}

export interface SalaryCardProps {
  onCreate: () => void;
  onDismiss: () => void;
}

/**
 * «Завести «ЗП»»: пока нет регулярного дохода-зарплаты, предлагает завести его в два шага — сумма и день месяца. Открывает обычное окно
 * «Новый регулярный платёж» с заполненными полями (доход, раз в месяц, «Зарплата»). «Не нужно» убирает карточку на этом устройстве.
 */
export function SalaryCard({ onCreate, onDismiss }: SalaryCardProps) {
  return (
    <Card className="mb-6" data-testid="salary-card" role="group" aria-label="Зарплата">
      <p className="font-semibold">Зарплата раз в месяц</p>
      <p className="mt-1 text-sm text-muted">
        Укажите сумму и день — приложение напомнит о приходе и учтёт его в «Осталось на день». Если сумма изменится, при проведении спросит причину.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="min-w-[10rem] flex-1" onClick={onCreate}>
          Завести «ЗП»
        </Button>
        <Button variant="ghost" onClick={onDismiss}>
          Не нужно
        </Button>
      </div>
    </Card>
  );
}
