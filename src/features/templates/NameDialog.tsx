import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { TextInput } from '@/components/Field';
import { cleanName, NAME_MAX } from './templates';

export interface NameDialogProps {
  open: boolean;
  title: string;
  /** Что подставить в поле при открытии. */
  initial: string;
  confirmLabel: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

/** «Как назвать шаблон?»: поле названия в окне подтверждения. Enter подтверждает; пустое название подтвердить нельзя. */
export function NameDialog({ open, title, initial, confirmLabel, onConfirm, onCancel }: NameDialogProps) {
  const [name, setName] = useState(initial);
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);
  const clean = cleanName(name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (clean !== null) onConfirm(clean);
  };
  return (
    <ConfirmDialog
      open={open}
      title={title}
      confirmLabel={confirmLabel}
      confirmDisabled={clean === null}
      onConfirm={() => clean !== null && onConfirm(clean)}
      onCancel={onCancel}
      message={
        <form onSubmit={submit} noValidate>
          <TextInput label="Название" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} autoComplete="off" data-autofocus />
        </form>
      }
    />
  );
}
