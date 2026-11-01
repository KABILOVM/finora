import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { ValidationError, useStore } from '@/db';
import type { IsoDate, LocalRow, SavingsGoal } from '@/domain/types';
import { UNDO_MS } from '@/features/transactions/txActions';
import { shiftDueLabel } from './goalsText';

export interface ShiftDueButtonProps {
  goal: LocalRow<SavingsGoal>;
  /** Новый срок: самая ранняя реалистичная дата из плана. */
  date: IsoDate;
  today: IsoDate;
}

/** «Сдвинуть срок на …» для единственной цели: меняет только срок, прежний можно вернуть из уведомления. */
export function ShiftDueButton({ goal, date, today }: ShiftDueButtonProps) {
  const store = useStore();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  if (date <= goal.dueOn) return null; // уже и так не раньше: сдвигать нечего

  const shift = async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    const before = goal.dueOn;
    try {
      await store.savingsGoals.update(goal.id, { dueOn: date });
      toast.success(`Срок цели «${goal.name}» сдвинут`, {
        durationMs: UNDO_MS,
        action: {
          label: 'Вернуть',
          onClick: () => {
            store.savingsGoals.update(goal.id, { dueOn: before }).catch((e: unknown) => {
              console.error('Не удалось вернуть срок цели:', e);
              toast.error('Не удалось вернуть прежний срок. Его можно изменить в самой цели.');
            });
          },
        },
      });
    } catch (e) {
      console.error('Не удалось сдвинуть срок цели:', e);
      toast.error(e instanceof ValidationError ? e.message : 'Не удалось сдвинуть срок. Данные не изменены, попробуйте ещё раз.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  return (
    <Button variant="secondary" icon="calendar" loading={loading} onClick={() => void shift()} className="self-start">
      {shiftDueLabel(date, today)}
    </Button>
  );
}
