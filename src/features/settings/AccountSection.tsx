import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useAppEnv } from '@/app/env';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import { pluralRu } from '@/lib/plural';
import { useSyncStatus } from '@/sync/syncContext';
import { ChangePasswordSheet } from './ChangePasswordSheet';
import { SettingsSection } from './SettingsSection';

type Pending = { kind: 'sign-out' | 'wipe'; pending: number; quarantined: number } | null;

const records = (n: number) => `${n} ${pluralRu(n, 'запись', 'записи', 'записей')}`;

/** Аккаунт: почта, смена пароля, выход (с честным предупреждением) и выход с удалением данных этого устройства. */
export function AccountSection() {
  const auth = useAuth();
  const { deps } = useAppEnv();
  const store = useStore();
  const toast = useToast();
  const status = useSyncStatus();
  const [confirm, setConfirm] = useState<Pending>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!auth.cloud) {
    return (
      <SettingsSection title="Аккаунт">
        <p>Входа нет: облако не подключено, это приложение работает только на этом устройстве.</p>
      </SettingsSection>
    );
  }

  const email = auth.user?.email || 'почта не указана';
  const offlineKnown = auth.state.status === 'offline-known';
  const hasUnsent = status.pending > 0 || status.quarantined > 0;

  /** Считаем прямо в базе, а не по статусу: статус может отставать. */
  const countUnsent = async () => {
    const c = await store.sync.counts();
    return { pending: c.pending, quarantined: c.quarantined };
  };

  const startSignOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const c = await countUnsent();
      if (c.pending > 0 || c.quarantined > 0) setConfirm({ kind: 'sign-out', ...c });
      else await auth.signOut();
    } catch (e) {
      console.error('Не удалось проверить неотправленные записи:', e);
      // не можем проверить — не выходим молча
      toast.error('Не удалось проверить, всё ли отправлено. Выход отменён, попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  const startWipe = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const c = await countUnsent();
      if (c.pending > 0 || c.quarantined > 0) {
        toast.error('Есть неотправленные записи: удалять данные с устройства нельзя, они пропадут.');
        return;
      }
      setConfirm({ kind: 'wipe', ...c });
    } catch (e) {
      console.error('Не удалось проверить неотправленные записи:', e);
      toast.error('Не удалось проверить, всё ли отправлено. Данные не удалены.');
    } finally {
      setBusy(false);
    }
  };

  const confirmed = async () => {
    if (!confirm || busy) return;
    const kind = confirm.kind;
    const userId = store.userId;
    setBusy(true);
    try {
      if (kind === 'wipe') {
        // ещё раз, прямо перед удалением: за время диалога могла появиться новая запись
        const c = await countUnsent();
        if (c.pending > 0 || c.quarantined > 0) {
          setConfirm(null);
          toast.error('Появились неотправленные записи: данные не удалены.');
          return;
        }
      }
      setConfirm(null);
      await auth.signOut();
      if (kind === 'wipe') {
        try {
          await deps.deleteLocalData(userId);
          toast.success('Данные удалены с этого устройства. В облаке они сохранены.');
        } catch (e) {
          console.error('Не удалось удалить локальные данные:', e);
          toast.error('Вы вышли, но данные с устройства удалить не удалось. Закройте другие вкладки Finora и повторите.');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Аккаунт">
      <div>
        <div className="text-sm text-muted">Почта</div>
        <div className="break-all text-lg font-semibold">{email}</div>
      </div>
      {offlineKnown && (
        <p role="status" className="rounded-xl bg-warning/10 p-3 text-warning">
          Нет связи с аккаунтом. Вы работаете с данными, сохранёнными на этом устройстве; при появлении сети вход подтвердится.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button variant="secondary" onClick={() => setPasswordOpen(true)}>
          Сменить пароль
        </Button>
        <Button variant="secondary" loading={busy && confirm === null} onClick={() => void startSignOut()}>
          Выйти
        </Button>
      </div>

      <div className="border-t border-border pt-3">
        <Button variant="danger" disabled={busy || hasUnsent} onClick={() => void startWipe()}>
          Выйти и удалить данные с этого устройства
        </Button>
        <p className="mt-2 text-sm text-muted">
          {hasUnsent
            ? 'Недоступно, пока не всё отправлено в облако: эти записи пропали бы насовсем.'
            : 'Доступно, когда всё отправлено в облако. Нужно, например, если устройство отдаёте другому человеку.'}
        </p>
      </div>

      {passwordOpen && <ChangePasswordSheet onClose={() => setPasswordOpen(false)} />}

      <ConfirmDialog
        open={confirm?.kind === 'sign-out'}
        danger
        loading={busy}
        title="Не всё отправлено в облако"
        confirmLabel="Всё равно выйти"
        message={
          confirm ? (
            <>
              <p>
                Не отправлено: {records(confirm.pending)}
                {confirm.quarantined > 0 && `; сервер не принял ещё ${records(confirm.quarantined)}`}.
              </p>
              <p className="mt-2">
                Если выйти сейчас, они останутся на этом устройстве, но в облако не попадут, пока вы снова не войдёте под этой же почтой.
                Не удаляйте данные сайта и не входите под другой почтой, пока они не отправятся.
              </p>
            </>
          ) : undefined
        }
        onConfirm={() => void confirmed()}
        onCancel={() => !busy && setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'wipe'}
        danger
        loading={busy}
        title="Удалить данные с этого устройства?"
        confirmLabel="Выйти и удалить"
        message="Вы выйдете из аккаунта, а все записи на этом устройстве будут удалены. В облаке они сохранятся: после следующего входа загрузятся снова (нужен интернет)."
        onConfirm={() => void confirmed()}
        onCancel={() => !busy && setConfirm(null)}
      />
    </SettingsSection>
  );
}
