import { useEffect, useRef, useState } from 'react';
import { useAppEnv } from '@/app/env';
import { useAuth } from '@/auth/AuthProvider';
import { readCloudConfig } from '@/auth/config';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import { cn } from '@/lib/cn';
import { STATUS_MARK, formatReport, overallStatus, runCloudCheck, type CheckStatus, type CheckStep } from '@/sync/diagnostics';
import { useSyncStatus } from '@/sync/syncContext';
import { copyText } from './copyText';
import { SettingsSection } from './SettingsSection';

/** Инструкция по подключению облака (раздел README в репозитории проекта). */
export const README_URL = 'https://github.com/KABILOVM/finora#подключение-облака';

const MARK_CLASS: Record<CheckStatus, string> = { ok: 'text-income', warn: 'text-warning', fail: 'text-danger', skip: 'text-muted' };
const STATUS_WORD: Record<CheckStatus, string> = { ok: 'порядок', warn: 'внимание', fail: 'ошибка', skip: 'пропущено' };
const HEADLINE = {
  ok: { text: 'Все проверки пройдены', cls: 'text-income' },
  warn: { text: 'Есть замечания: прочитайте ниже', cls: 'text-warning' },
  fail: { text: 'Есть ошибки: исправляйте сверху вниз', cls: 'text-danger' },
} as const;

/** Настройки облака из сборки: адрес нужен для имени сервера в отчёте, ключ — чтобы заметить секретный (он в отчёт не попадает). */
const envConfig = () => readCloudConfig(import.meta.env as Record<string, unknown>);

/**
 * «Проверка облака»: связь, вход, таблицы, права. Для владельца без технических знаний: каждый шаг говорит, что сделать.
 * В локальном режиме проверять нечего — объясняем и показываем, где инструкция.
 */
export function CloudCheckSection({ url }: { url?: string } = {}) {
  const { client } = useAppEnv();
  const auth = useAuth();
  const store = useStore();
  const toast = useToast();
  const status = useSyncStatus();
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<CheckStep[]>([]);
  const [manualReport, setManualReport] = useState<string | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const runNo = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (!client || !auth.cloud) {
    return (
      <SettingsSection title="Проверка облака">
        <p>Облако пока не подключено, поэтому проверять нечего: данные хранятся только на этом устройстве.</p>
        <p className="text-muted">
          Как подключить облако, написано в инструкции:{' '}
          <a className="font-semibold text-brand underline" href={README_URL} target="_blank" rel="noopener noreferrer">
            см. README
          </a>
          , раздел «Подключение облака».
        </p>
      </SettingsSection>
    );
  }

  const user = auth.user;
  const host = (() => {
    try {
      return new URL(url ?? envConfig()?.url ?? '').host;
    } catch {
      return '';
    }
  })();

  const run = async () => {
    if (busy.current || !user) return;
    busy.current = true;
    const mine = ++runNo.current;
    const current = () => alive.current && runNo.current === mine;
    setRunning(true);
    setSteps([]);
    setManualReport(null);
    try {
      // Считаем прямо в базе, а не по статусу: статус может отставать.
      let counts = { pending: status.pending, quarantined: status.quarantined };
      try {
        const c = await store.sync.counts();
        counts = { pending: c.pending, quarantined: c.quarantined };
      } catch (e) {
        console.error('Не удалось посчитать неотправленные записи:', e);
      }
      const result = await runCloudCheck(
        client,
        {
          userId: user.id,
          url: url ?? envConfig()?.url ?? '',
          apiKey: envConfig()?.anonKey,
          hasSession: auth.state.status === 'signed-in',
          ...counts,
          everSynced: status.lastSyncedAt !== null,
          online: typeof navigator === 'undefined' ? undefined : navigator.onLine,
        },
        { onStep: (s) => current() && setSteps((cur) => [...cur, s]) },
      );
      if (current()) setSteps(result);
    } catch (e) {
      console.error('Проверка облака не удалась:', e);
      if (current()) toast.error('Не удалось выполнить проверку. Попробуйте ещё раз.');
    } finally {
      busy.current = false;
      if (alive.current) setRunning(false);
    }
  };

  const copy = async () => {
    const report = formatReport(steps, { host });
    if (await copyText(report)) {
      setManualReport(null);
      toast.success('Отчёт скопирован');
    } else {
      setManualReport(report);
      toast.error('Не удалось скопировать. Выделите текст ниже и скопируйте вручную.');
    }
  };

  const finished = !running && steps.length > 0;
  const headline = HEADLINE[overallStatus(steps)];

  return (
    <SettingsSection title="Проверка облака">
      <p className="text-muted">
        Проверяет связь с сервером, вход, таблицы, права и ключ. Ничего не меняет в ваших данных: для проверки записи в таблицы
        отправляются заведомо неверные строки, и сервер их отклоняет.
      </p>
      {!user && <p className="text-warning">Сначала войдите в аккаунт.</p>}
      <Button variant="secondary" icon="cloud-check" loading={running} disabled={!user} onClick={() => void run()}>
        Проверить
      </Button>

      <div role="status" aria-live="polite">
        {running && <p className="font-semibold text-muted">Идёт проверка…</p>}
        {finished && <p className={cn('text-lg font-semibold', headline.cls)}>{headline.text}</p>}
      </div>

      {steps.length > 0 && (
        <ol className="flex flex-col gap-2">
          {steps.map((s) => (
            <li key={s.id} className="flex gap-3 rounded-xl bg-surface-2 p-3">
              <span aria-hidden="true" className={cn('w-6 shrink-0 text-center text-lg font-bold', MARK_CLASS[s.status])}>
                {STATUS_MARK[s.status]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {s.title}
                  <span className="sr-only">: {STATUS_WORD[s.status]}</span>
                </div>
                <div className="break-words text-sm text-muted">{s.message}</div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {finished && (
        <Button variant="ghost" onClick={() => void copy()}>
          Скопировать отчёт
        </Button>
      )}
      {manualReport !== null && (
        <textarea
          readOnly
          rows={8}
          value={manualReport}
          aria-label="Отчёт для копирования"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-xl border border-border bg-surface-2 p-3 font-mono text-sm"
        />
      )}
    </SettingsSection>
  );
}
