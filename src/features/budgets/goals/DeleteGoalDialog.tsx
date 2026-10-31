import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { ValidationError, useStore } from '@/db';
import type { LocalRow, SavingsGoal } from '@/domain/types';
import { UNDO_MS } from '@/features/transactions/txActions';

export interface DeleteGoalDialogProps {
  goal: LocalRow<SavingsGoal>;
  /** Закрыть окно подтверждения (отмена или после удаления). */
  onClose: () => void;
  /** Цель удалена: вызывающий закрывает и своё окно, если оно было открыто поверх списка. */
  onDeleted?: () => void;
}

/**
 * Подтверждение удаления цели накопления. Удаление мягкое (запись скрывается, чтобы синхронизация узнала о нём), поэтому в уведомлении
 * есть «Вернуть». Деньги на привязанном кошельке не меняются: удаляется только цель.
 */
export function DeleteGoalDialog({ goal, onClose, onDeleted }: DeleteGoalDialogProps) {
  const store = useStore();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const confirm = async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      await store.savingsGoals.remove(goal.id);
      toast.success(`Цель «${goal.name}» удалена`, {
        durationMs: UNDO_MS,
        action: {
          label: 'Вернуть',
          onClick: () => {
            store.savingsGoals.restore(goal.id).catch((e: unknown) => {
              console.error('Не удалось вернуть цель:', e);
              toast.error(e instanceof ValidationError ? e.message : 'Не удалось вернуть цель. Данные не изменены.');
            });
          },
        },
      });
      onClose();
      onDeleted?.();
    } catch (e) {
      console.error('Не удалось удалить цель:', e);
      toast.error(e instanceof ValidationError ? e.message : 'Не удалось удалить цель. Данные не изменены, попробуйте ещё раз.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  return (
    <ConfirmDialog
      open
      danger
      title={`Удалить цель «${goal.name}»?`}
      message="Цель пропадёт из списка и из плана трат. Деньги на кошельке не изменятся. Сразу после удаления её можно вернуть."
      confirmLabel="Удалить"
      loading={loading}
      onConfirm={() => void confirm()}
      onCancel={onClose}
    />
  );
}
