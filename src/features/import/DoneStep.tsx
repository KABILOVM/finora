import { Link } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { formatMinor } from '@/domain/money';
import type { ImportReport } from '@/import/runImport';
import { rowsWord } from './importText';

const FAILED_SHOWN = 20;

function Row({ label, value, id, tone }: { label: string; value: number; id: string; tone?: 'danger' | 'warning' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt>{label}</dt>
      <dd data-testid={`report-${id}`} className={`font-semibold tabular-nums ${tone === 'danger' && value > 0 ? 'text-danger' : tone === 'warning' && value > 0 ? 'text-warning' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

export interface DoneStepProps {
  report: ImportReport;
  onAgain: () => void;
}

/** Шаг 4. Итог: что добавлено и что нет, ошибки записи, остатки по файлу для сверки с банком. */
export function DoneStep({ report, onAgain }: DoneStepProps) {
  const shown = report.failed.slice(0, FAILED_SHOWN);
  const moreFailed = report.failedCount - shown.length;
  const title = report.fatal ? 'Импорт прерван' : report.stopped ? 'Импорт остановлен' : 'Импорт завершён';
  const notAdded = report.review + report.waitRate + report.blocked;
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3" role="region" aria-label="Итог импорта">
        <h2 className="text-lg font-bold">{title}</h2>
        {report.fatal && <p role="alert" className="font-medium text-danger">{report.fatal}</p>}
        {report.stopped && !report.fatal && (
          <p className="text-muted">Добавлено {report.added} из {report.total}. Загрузите файл ещё раз — импорт продолжится с того же места, повторов не будет.</p>
        )}
        <dl className="divide-y divide-border">
          <Row id="added" label="Добавлено" value={report.added} />
          <Row id="exists" label="Уже было" value={report.alreadyThere} />
          <Row id="review" label="Нужно проверить (не добавлено)" value={report.review} tone="warning" />
          <Row id="skipped" label="Пропущено" value={report.skipped} />
          {(report.waitRate > 0 || report.blocked > 0) && (
            <Row id="blocked" label="Ждали курса или кошелька (не добавлено)" value={report.waitRate + report.blocked} tone="warning" />
          )}
          <Row id="failed" label="Не импортировано (ошибка записи)" value={report.failedCount} tone="danger" />
        </dl>
        {(report.createdWallets > 0 || report.createdCategories > 0) && (
          <p className="text-sm text-muted">
            Создано кошельков: {report.createdWallets}, категорий: {report.createdCategories}.
          </p>
        )}
        {notAdded > 0 && (
          <p className="text-sm text-muted">
            Исправьте спорные строки в файле и загрузите его ещё раз: то, что уже добавлено, не повторится.
          </p>
        )}
      </Card>

      {report.failedCount > 0 && (
        <section aria-labelledby="failed-h" className="flex flex-col gap-2">
          <h2 id="failed-h" className="px-1 text-sm font-bold uppercase tracking-wide text-muted">
            Не импортировано: {report.failedCount}
          </h2>
          <Card className="flex flex-col gap-2">
            <ul className="divide-y divide-border" aria-label="Строки, которые не удалось записать">
              {shown.map((f) => (
                <li key={`${f.line}-${f.reason}`} className="py-2">
                  <span className="font-medium">Строка {f.line}</span>
                  <span className="text-sm text-muted"> · {f.label}</span>
                  <span className="block text-sm">{f.reason}</span>
                </li>
              ))}
            </ul>
            {moreFailed > 0 && (
              <p className="text-sm text-muted">
                и ещё {moreFailed} {rowsWord(moreFailed)}
              </p>
            )}
          </Card>
        </section>
      )}

      {report.reconcile.length > 0 && (
        <section aria-labelledby="reconcile-h" className="flex flex-col gap-2">
          <h2 id="reconcile-h" className="px-1 text-sm font-bold uppercase tracking-wide text-muted">
            Сверьте остатки
          </h2>
          <Card padding="none">
            <p className="px-4 pt-3 text-sm text-muted">
              Остатки считаются из операций, начальный остаток новых кошельков — 0. Сверьте цифры с банком; при расхождении поправьте начальный
              остаток кошелька (Кошельки → кошелёк → Изменить).
            </p>
            <ul className="divide-y divide-border" aria-label="Остатки по файлу">
              {report.reconcile.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 break-words font-medium">{r.name}</span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block text-sm text-muted">Остаток по файлу</span>
                    <span className="font-semibold">
                      {r.fileBalanceMinor === null ? 'не удалось посчитать' : formatMinor(r.fileBalanceMinor, r.currency)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <Card className="flex flex-col gap-3">
        <Link to="/transactions" className={buttonClasses('primary', 'lg', true)}>
          К операциям
        </Link>
        <Button variant="secondary" onClick={onAgain}>
          Загрузить ещё файл
        </Button>
      </Card>
    </div>
  );
}
