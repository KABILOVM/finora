import { Component, useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/Toast';
import { useOptionalStore, type Store } from '@/db';
import { todayLocal } from '@/lib/dates';
import { useRates } from '@/rates/hooks';
import { runAutoPost, type AutoPostResult } from '@/recurring/autoPost';
import { onAutoPostRequest, publishFailures, takeNewMissingRates } from '@/recurring/autoPostState';
import { pairText } from '@/recurring/fx';

/** Как часто проверять, что наступил новый день (мс). */
const DAY_CHECK_MS = 60_000;
/** Сколько проходов подряд делаем, если за один не уместились все платежи (лимит записей за проход). */
const MAX_PASSES = 5;

/** Текст тоста «нет курса»: одно уведомление на все пары валют. */
export function missingRatesMessage(result: Pick<AutoPostResult, 'missingRates'>, fresh: readonly string[]): string {
  const pairs = result.missingRates.filter((m) => fresh.includes(pairText(m.from, m.to)));
  const stale = pairs.length > 0 && pairs.every((m) => m.reason === 'stale');
  const text = pairs.map((m) => pairText(m.from, m.to)).join(', ');
  return stale
    ? `Не удалось провести автоплатёж: нет свежего курса ${text} (последний устарел). Проведите платёж вручную в «Регулярных платежах».`
    : `Не удалось провести автоплатёж: нет курса ${text}. Проведите платёж вручную в «Регулярных платежах».`;
}

/** Если фоновый компонент вдруг упал, приложение не должно падать вместе с ним: автопроведение просто молчит. */
class Silent extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error): void {
    console.error('Автопроведение остановлено из-за ошибки:', error);
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function Engine({ store }: { store: Store }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { getRate, refreshing } = useRates();

  // Всегда свежие значения для проходов, которые идут дольше одного кадра.
  const getRateRef = useRef(getRate);
  getRateRef.current = getRate;
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const requestRef = useRef<(() => void) | null>(null);
  const mountedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    let again = false;
    let lastDay = todayLocal();
    const isCurrent = () => !cancelled;

    /** Один проход: провести, обновить пометки у правил, сказать о курсах. Возвращает, сколько записано и остались ли даты (лимит). */
    const pass = async (): Promise<{ posted: number; capped: boolean }> => {
      const today = todayLocal();
      lastDay = today;
      const result = await runAutoPost({ store, today, getRate: (a, b) => getRateRef.current(a, b), isCurrent });
      if (cancelled || result.aborted) return { posted: result.posted, capped: false };
      publishFailures(store.userId, result.failures, result.eligible, result.examined);
      // Курсы обновляются сразу после открытия приложения: пока идёт обновление, «нет курса» не объявляем — после него будет новый проход.
      if (!refreshingRef.current) {
        const fresh = takeNewMissingRates(
          store.userId,
          result.missingRates.map((m) => pairText(m.from, m.to)),
        );
        if (fresh.length > 0) {
          toastRef.current.error(missingRatesMessage(result, fresh), {
            durationMs: 10_000,
            action: { label: 'Открыть', onClick: () => navigateRef.current('/recurring') },
          });
        }
      }
      return { posted: result.posted, capped: result.capped };
    };

    const request = () => {
      if (cancelled) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      void (async () => {
        try {
          let posted = 0;
          for (let n = 0; n < MAX_PASSES; n++) {
            again = false;
            const r = await pass();
            posted += r.posted;
            if (cancelled) return;
            if (!r.capped && !again) break;
          }
          // Одно уведомление на весь заход, даже если записей было больше лимита одного прохода.
          if (posted > 0) toastRef.current.success(`Проведено автоплатежей: ${posted}`);
        } catch (e) {
          if (!cancelled) console.error('Автопроведение: проход не удался:', e);
        } finally {
          running = false;
        }
      })();
    };
    requestRef.current = request;

    request(); // приложение открыто
    const onVisible = () => {
      if (document.visibilityState === 'visible') request();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', request);
    const dayTimer = setInterval(() => {
      if (todayLocal() !== lastDay) request(); // наступил новый день
    }, DAY_CHECK_MS);
    const off = onAutoPostRequest(request);

    return () => {
      cancelled = true;
      requestRef.current = null;
      clearInterval(dayTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', request);
      off();
    };
  }, [store]);

  // Курсы изменились или закончилось их обновление: возможно, теперь есть курс для платежа, который ждал.
  useEffect(() => {
    if (!mountedOnce.current) {
      mountedOnce.current = true;
      return;
    }
    requestRef.current?.();
  }, [getRate, refreshing]);

  return null;
}

/**
 * Невидимый компонент: проводит платежи «Проводить само», когда приложение открыли, вернулись на вкладку или наступил новый день.
 * Без хранилища (экран входа) не делает ничего. Правила проведения — в src/recurring/autoPost.ts и plan.ts.
 */
export default function AutoPostRunner() {
  const store = useOptionalStore();
  if (!store) return null;
  return (
    <Silent key={store.userId}>
      <Engine store={store} />
    </Silent>
  );
}
