import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAppEnv } from '@/app/env';
import { useAuth } from '@/auth/AuthProvider';
import { deleteAccountOnServer, DeleteAccountError } from '@/auth/deleteAccount';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';

/**
 * Удаление аккаунта: безвозвратно стирает аккаунт и все данные в облаке, затем данные этого устройства. Чтобы нельзя было нажать
 * случайно, нужно набрать свою почту. Если сервер не смог удалить, на устройстве тоже ничего не стирается.
 */
export function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const { deps } = useAppEnv();
  const store = useStore();
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const email = (auth.user?.email ?? '').trim();
  const matches = email !== '' && typed.trim().toLowerCase() === email.toLowerCase();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !matches) return;
    const userId = store.userId;
    setBusy(true);
    setError(null);
    try {
      await deleteAccountOnServer(email);
    } catch (err) {
      setBusy(false);
      setError(err instanceof DeleteAccountError ? err.message : 'Не получилось удалить аккаунт. Ничего не удалено, попробуйте ещё раз.');
      if (!(err instanceof DeleteAccountError)) console.error('Удаление аккаунта:', err);
      return;
    }
    // аккаунт на сервере уже удалён: выходим и стираем данные устройства (сбой здесь не отменяет удаления)
    await auth.signOut();
    try {
      await deps.deleteLocalData(userId);
      toast.success('Аккаунт и данные удалены.');
    } catch (err) {
      console.error('Не удалось удалить локальные данные:', err);
      toast.error('Аккаунт удалён, но данные на этом устройстве остались. Закройте другие вкладки Sumoima и очистите данные сайта.');
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!busy}
      title="Удалить аккаунт"
      footer={
        <Button type="submit" form="delete-account-form" variant="danger" size="lg" fullWidth loading={busy} disabled={!matches}>
          Удалить аккаунт навсегда
        </Button>
      }
    >
      <form id="delete-account-form" onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
        <Notice tone="danger" role="note">
          <p>
            Аккаунт <b className="break-all">{email}</b> и все его данные в облаке — кошельки, операции, категории, бюджеты, долги, платежи —
            будут удалены <b>безвозвратно</b>. Потом сотрутся и данные на этом устройстве. Восстановить их будет нельзя, в том числе на других
            устройствах.
          </p>
        </Notice>
        <p className="text-sm text-muted">
          Если данные ещё пригодятся, сначала сохраните копию:{' '}
          <Link to="/settings?section=data" onClick={onClose} className="font-semibold text-brand underline">
            Настройки → Резервная копия
          </Link>
          . Её можно будет загрузить в новый аккаунт.
        </p>
        <TextInput
          label="Чтобы подтвердить, введите свою почту"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={busy}
          data-autofocus
        />
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Sheet>
  );
}
