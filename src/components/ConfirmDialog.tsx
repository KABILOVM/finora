import type { ReactNode } from 'react';
import { Button } from './Button';
import { Sheet } from './Sheet';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Пояснение: что именно произойдёт. */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Опасное действие (удаление): красная кнопка. */
  danger?: boolean;
  /** Идёт выполнение: кнопки заблокированы, закрыть нельзя. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Подтверждение действия. Фокус по умолчанию — на «Отмена», чтобы случайный Enter не удалил данные. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      placement="center"
      role="alertdialog"
      dismissible={!loading}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={loading} data-autofocus>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {message && <div className="text-muted">{message}</div>}
    </Sheet>
  );
}
