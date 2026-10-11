import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';

export interface StoreErrorScreenProps {
  error: unknown;
  onRetry: () => void;
  /** Есть вход в аккаунт — можно выйти (например, чтобы зайти под другой почтой). */
  onSignOut?: () => void;
}

/** Один экран на все ошибки открытия локальной базы. Главная причина на iPhone — приватная вкладка Safari. */
export function StoreErrorScreen({ error, onRetry, onSignOut }: StoreErrorScreenProps) {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    <main role="alert" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 pb-8">
      <EmptyState
        icon="alert"
        title="Не удалось открыть хранилище данных"
        text="Finora хранит записи в памяти браузера на этом устройстве, а сейчас она недоступна. Чаще всего так бывает в приватной вкладке Safari или когда в настройках запрещено хранение данных сайтов."
        action={
          <div className="flex flex-col gap-2">
            <Button onClick={onRetry}>Повторить</Button>
            {onSignOut && (
              <Button variant="ghost" onClick={onSignOut}>
                Выйти из аккаунта
              </Button>
            )}
          </div>
        }
      />
      <ul className="w-full max-w-sm list-disc space-y-1 pl-6 text-muted">
        <li>Откройте Finora в обычной вкладке, не в приватной.</li>
        <li>На iPhone: Настройки → Safari → не включайте «Блокировать все cookie».</li>
        <li>Проверьте, что на устройстве есть свободное место.</li>
        <li>Лучше всего поставить Finora на экран «Домой».</li>
      </ul>
      <details className="mt-4 w-full max-w-sm text-sm text-muted">
        <summary className="min-h-[44px] cursor-pointer py-2">Подробности</summary>
        <pre className="whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-3">{detail}</pre>
      </details>
    </main>
  );
}
