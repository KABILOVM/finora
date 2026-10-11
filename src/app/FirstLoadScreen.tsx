import { useAuth } from '@/auth/AuthProvider';
import { Button, Spinner } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { useOnline } from '@/components/OnlineBadge';
import { useSyncNow, useSyncStatus } from '@/sync/syncContext';

/**
 * Пока облако не отдало данные в первый раз, приложение закрыто этим экраном: иначе человек начал бы вносить
 * записи «с чистого листа», а потом они смешались бы с уже существующими (дубли, путаница).
 */
export function FirstLoadScreen() {
  const status = useSyncStatus();
  const syncNow = useSyncNow();
  const online = useOnline();
  const auth = useAuth();

  const authRequired = status.phase === 'auth-required';
  const offline = !authRequired && (status.phase === 'offline' || !online);
  const failed = !authRequired && !offline && status.phase === 'error';
  const busy = !authRequired && !offline && !failed;

  let title = 'Первая загрузка данных…';
  let text = 'Загружаем ваши кошельки и операции из облака. Это нужно один раз, дальше приложение работает и без сети.';
  if (authRequired) {
    title = 'Нужно войти заново';
    text = 'Сессия закончилась. Войдите снова — загрузка продолжится.';
  } else if (offline) {
    title = 'Нужен интернет для первой загрузки';
    text = 'Подключитесь к сети — загрузка начнётся сама. Пока данные не загружены, приложение закрыто, чтобы не создать дубли.';
  } else if (failed) {
    title = 'Не удалось загрузить данные';
    text = status.lastError ? `Причина: ${status.lastError}` : 'Попробуйте ещё раз через минуту.';
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-4">
      <div role="status" aria-live="polite" className="w-full">
        <EmptyState
          icon={offline ? 'cloud-off' : authRequired ? 'lock' : failed ? 'alert' : undefined}
          title={title}
          text={text}
          action={
            <div className="flex flex-col items-center gap-2">
              {busy && <Spinner size={28} />}
              {authRequired ? (
                <Button onClick={() => void auth.signOut()}>Войти заново</Button>
              ) : (
                !busy && <Button onClick={() => void syncNow()}>Повторить</Button>
              )}
              {!authRequired && (
                <Button variant="ghost" onClick={() => void auth.signOut()}>
                  Выйти из аккаунта
                </Button>
              )}
            </div>
          }
        />
      </div>
    </main>
  );
}
