import { useEffect } from 'react';
import { useAppEnv } from '@/app/env';
import { runKeeperCheck, type KeeperDeps, type KeeperOutcome } from './keeper';
import { MSG_NAVIGATE, MSG_SUBSCRIPTION_CHANGED, isSafeAppPath } from './navigate';
import { PUSH_LOCK_NAME } from './util';

/** Не чаще одной сверки за столько мс (возврат на вкладку, фокус, сеть могут сыпаться пачкой). */
export const KEEPER_MIN_INTERVAL_MS = 5 * 60_000;
/** Пауза после запуска приложения: сверка не должна мешать первой загрузке и синхронизации. */
export const KEEPER_START_DELAY_MS = 1500;

export interface PushKeeperProps {
  /** Только для тестов. */
  deps?: Partial<KeeperDeps>;
  minIntervalMs?: number;
  startDelayMs?: number;
  /** Только для тестов: узнать результат сверки. */
  onResult?: (outcome: KeeperOutcome) => void;
}

/**
 * Невидимый «сторож» подписки на push. При открытии приложения и при возвращении на вкладку сверяет подписку браузера с
 * сохранённой на сервере (см. runKeeperCheck). Ничего не рисует, ничего не показывает человеку и ничего не бросает;
 * не требует ни входа, ни хранилища, ни роутера: без облака просто молчит.
 */
export default function PushKeeper({ deps, minIntervalMs = KEEPER_MIN_INTERVAL_MS, startDelayMs = KEEPER_START_DELAY_MS, onResult }: PushKeeperProps = {}) {
  const { client } = useAppEnv();

  useEffect(() => {
    if (!client) return undefined;
    let alive = true;
    let running = false;
    let lastAt = 0;

    const run = async (force: boolean) => {
      const now = Date.now();
      if (!alive || running || (!force && now - lastAt < minIntervalMs)) return;
      running = true;
      lastAt = now;
      try {
        // Две вкладки (и кнопки раздела «Напоминания») не должны менять подписку одновременно: занято — пропускаем, сверим в следующий раз.
        const locks = (typeof navigator !== 'undefined' ? navigator.locks : undefined) as LockManager | undefined;
        const outcome = locks
          ? await locks.request(PUSH_LOCK_NAME, { ifAvailable: true }, (lock) => (lock ? runKeeperCheck(client, deps) : Promise.resolve<KeeperOutcome>('skipped-busy')))
          : await runKeeperCheck(client, deps);
        if (alive) {
          if (outcome === 'updated' || outcome === 'failed') console.debug('[push] сверка подписки:', outcome); // только слово-результат, без личных данных
          onResult?.(outcome);
        }
      } catch {
        /* сторож молчит */
      } finally {
        running = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void run(false);
    };
    const onOnline = () => void run(false);
    const onWorkerMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null) return;
      const { type, path } = data as { type?: unknown; path?: unknown };
      if (type === MSG_SUBSCRIPTION_CHANGED) void run(true);
      // Запасной путь перехода по уведомлению, если service worker не смог открыть адрес сам. Путь проверяется ещё раз.
      else if (type === MSG_NAVIGATE && isSafeAppPath(path)) window.location.hash = path;
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onVisible);
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    sw?.addEventListener?.('message', onWorkerMessage);
    const timer = setTimeout(() => void run(true), startDelayMs);

    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onVisible);
      sw?.removeEventListener?.('message', onWorkerMessage);
    };
    // deps/onResult задаются тестом один раз; перезапускать сторожа из-за них не нужно
  }, [client, minIntervalMs, startDelayMs]);

  return null;
}
