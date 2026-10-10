import { useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { MIN_PASSWORD_LENGTH } from '@/auth/passwordRules';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';

/** Смена пароля: новый пароль дважды. Проверка длины и совпадения — до отправки на сервер. */
export function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await auth.changePassword(password, repeat);
    setSaving(false);
    if (result.ok) {
      toast.success('Пароль изменён');
      onClose();
    } else {
      setError(result.message);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title="Смена пароля"
      footer={
        <Button type="submit" form="change-password-form" size="lg" fullWidth loading={saving}>
          Сменить пароль
        </Button>
      }
    >
      <form id="change-password-form" onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
        <TextInput
          label="Новый пароль"
          type="password"
          autoComplete="new-password"
          hint={`Не короче ${MIN_PASSWORD_LENGTH} символов`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-autofocus
        />
        <TextInput
          label="Повторите пароль"
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
        {error && (
          <p role="alert" className="rounded-xl bg-danger/10 p-3 font-medium text-danger">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
