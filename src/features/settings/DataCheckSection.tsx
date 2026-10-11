import { useState } from 'react';
import { Button } from '@/components/Button';
import { useStore } from '@/db';
import { findBalanceIssues, type BalanceIssue } from '@/domain/balances';
import { formatDayLabel } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { SettingsSection } from './SettingsSection';

interface Report {
  checked: number;
  issues: { message: string; where: string }[];
}

const SHOW_LIMIT = 30;

/** Проверка данных: операции с битой суммой или без кошелька, которые не попадают в остатки. */
export function DataCheckSection() {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = store;
      const [wallets, txs] = await db.transaction('r', [db.wallets, db.transactions], () =>
        Promise.all([db.wallets.toArray(), db.transactions.toArray()]),
      );
      const live = txs.filter((t) => t.deletedAt === null);
      const byId = new Map(live.map((t) => [t.id, t]));
      const issues = findBalanceIssues(
        wallets.filter((w) => w.deletedAt === null),
        live,
      ).map((i: BalanceIssue) => {
        const t = i.txId ? byId.get(i.txId) : undefined;
        return { message: i.message, where: t ? `Операция от ${formatDayLabel(t.occurredOn)}` : 'Запись' };
      });
      setReport({ checked: live.length, issues });
    } catch (e) {
      console.error('Проверка данных не удалась:', e);
      setError('Не удалось выполнить проверку. Данные не изменены.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Проверка данных">
      <p className="text-muted">Ищет операции, которые не попадают в остатки: с неверной суммой или без кошелька. Ничего не меняет.</p>
      <Button variant="secondary" loading={busy} onClick={() => void run()}>
        Проверить данные
      </Button>
      {error && (
        <p role="alert" className="font-medium text-danger">
          {error}
        </p>
      )}
      {report && report.issues.length === 0 && (
        <p role="status" className="rounded-xl bg-income/10 p-3 font-medium text-income">
          Проблем не найдено. Проверено {report.checked} {pluralRu(report.checked, 'операция', 'операции', 'операций')}.
        </p>
      )}
      {report && report.issues.length > 0 && (
        <div role="alert" className="rounded-xl bg-danger/5 p-3">
          <p className="font-semibold text-danger">
            Найдено проблем: {report.issues.length} (проверено {report.checked})
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {report.issues.slice(0, SHOW_LIMIT).map((i, n) => (
              <li key={n}>
                {i.where}: {i.message}
              </li>
            ))}
          </ul>
          {report.issues.length > SHOW_LIMIT && <p className="mt-1 text-sm text-muted">…и ещё {report.issues.length - SHOW_LIMIT}.</p>}
          <p className="mt-2 text-sm text-muted">Такие операции в остатки не входят. Исправьте или удалите их в списке операций.</p>
        </div>
      )}
    </SettingsSection>
  );
}
