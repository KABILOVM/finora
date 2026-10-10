import type { ToastApi } from '@/components/Toast';
import { ValidationError } from '@/db';

/** Сколько секунд в тосте живёт кнопка «Отменить». */
export const UNDO_MS = 6000;

/** Текст ошибки для человека: ValidationError — как есть (он уже по-русски), остальное — общая фраза. */
export function humanError(e: unknown, fallback: string): string {
  return e instanceof ValidationError ? e.message : fallback;
}

/**
 * Тост с кнопкой «Отменить». Сама отмена выполняется функцией undo; удалось — короткое подтверждение,
 * не удалось — понятная ошибка (и ничего не теряется: операция остаётся как была).
 */
export function toastWithUndo(toast: ToastApi, message: string, undo: () => Promise<unknown>, undoneText: string): void {
  toast.success(message, {
    durationMs: UNDO_MS,
    action: {
      label: 'Отменить',
      onClick: () => {
        undo().then(
          () => toast.show(undoneText),
          (e: unknown) => {
            console.error('Не удалось отменить:', e);
            toast.error(humanError(e, 'Не удалось отменить. Попробуйте ещё раз.'));
          },
        );
      },
    },
  });
}
