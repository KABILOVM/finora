import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAddLink } from '@/layout/nav';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Notice } from '@/components/Notice';
import { SectionHeader } from '@/components/SectionHeader';
import { formatMinor } from '@/domain/money';
import type { ImportReport } from '@/import/runImport';
import type { UndoResult } from '@/import/undoImport';
import { opsWord, rowsWord } from './importText';

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
  /** «Отменить импорт»: убрать то, что записал этот запуск. Нет — кнопки нет (например, ничего не записано). */
  onUndo?: () => Promise<UndoResult>;
}

/** Шаг 4. Итог: что добавлено и что нет, ошибки записи, остатки по файлу для сверки с банком. */
export function DoneStep({ report, onAgain, onUndo }: DoneStepProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undone, setUndone] = useState<UndoResult | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const journal = report.journal;
  const canUndo = Boolean(onUndo && journal && journal.txIds.length > 0 && !undone);
  const undo = async () => {
    if (!onUndo || busy) return;
    setConfirming(false);
    setBusy(true);
    setUndoError(null);
    try {
      setUndone(await onUndo());
    } catch (e) {
      console.error('Отмена импорта не удалась', e);
      setUndoError('Не удалось отменить импорт. Уже убранное осталось убранным: попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };
  const shown = report.failed.slice(0, FAILED_SHOWN);
  const moreFailed = report.failedCount - shown.length;
  const addLink = useAddLink('expense');
  // «Что дальше» — когда история перенесена целиком: перенесённое надо продолжить, иначе учёт останавливается в день импорта
  const showNext = !report.fatal && !report.stopped && report.added > 0 && !undone;
  const title = report.fatal ? 'Импорт прерван' : report.stopped ? 'Импорт остановлен' : 'Импорт завершён';
  const notAdded = report.review + report.waitRate + report.blocked;
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3" role="region" aria-label="Итог импорта">
        <h2 className="text-lg font-bold">{title}</h2>
        {report.fatal && <Notice tone="danger">{report.fatal}</Notice>}
        {report.stopped && !report.fatal && (
          <Notice tone="warning" role="note">
            Добавлено {report.added} из {report.total}. Загрузите файл ещё раз — импорт продолжится с того же места, повторов не будет.
          </Notice>
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
          <SectionHeader id="failed-h" className="mb-0">
            Не импортировано: {report.failedCount}
          </SectionHeader>
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
          <SectionHeader id="reconcile-h" className="mb-0">
            Сверьте остатки
          </SectionHeader>
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

      {undone && (
        <Notice tone="success" role="status">
          Импорт отменён: убрано {undone.removedTxs} {opsWord(undone.removedTxs)}
          {undone.archivedWallets + undone.archivedCategories > 0 ? `, в архив ушло кошельков: ${undone.archivedWallets}, категорий: ${undone.archivedCategories}` : ''}.
          {undone.keptInUse > 0 ? ` Остались ${undone.keptInUse}: в них уже есть ваши операции.` : ''}
          {undone.failed > 0 ? ` Не удалось убрать: ${undone.failed}.` : ''} Тот же файл эти строки не вернёт — как и удалённые вручную.
        </Notice>
      )}
      {undoError && <Notice tone="danger">{undoError}</Notice>}

      {showNext && (
        <Card className="flex flex-col gap-3" role="region" aria-label="Что дальше" data-testid="import-next">
          <h2 className="text-lg font-bold">Что дальше</h2>
          <p className="text-sm text-muted">История перенесена. Чтобы учёт не остановился в день переноса, продолжайте с сегодняшнего дня.</p>
          <div className="flex flex-col gap-1">
            <p className="font-semibold">Новая трата — одной строкой</p>
            <p className="text-sm text-muted">Напишите, например, «такси 20»: форма откроется заполненной, останется нажать «Сохранить».</p>
            <Link {...addLink} className={`${buttonClasses('secondary', 'md')} mt-1 self-start`}>
              Записать трату
            </Link>
          </div>
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <p className="font-semibold">Чтобы не пропускать дни</p>
            <p className="text-sm text-muted">
              Включите вечернее напоминание: если за день ничего не внесено, мы напомним. Напоминания приходят с сервера, поэтому нужен вход в аккаунт.
            </p>
            <Link to="/settings?section=security" className={`${buttonClasses('secondary', 'md')} mt-1 self-start`}>
              Включить напоминание
            </Link>
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <Link to="/transactions" className={buttonClasses('primary', 'lg', true)}>
          К операциям
        </Link>
        <Button variant="secondary" onClick={onAgain}>
          Загрузить ещё файл
        </Button>
        {canUndo && (
          <Button variant="ghost" loading={busy} onClick={() => setConfirming(true)}>
            Отменить импорт
          </Button>
        )}
      </Card>

      <ConfirmDialog
        open={confirming}
        title="Отменить импорт?"
        message={
          <div className="flex flex-col gap-2">
            <p>
              Будет убрано операций: {journal?.txIds.length ?? 0}. Созданные импортом кошельки ({journal?.walletIds.length ?? 0}) и категории (
              {journal?.categoryIds.length ?? 0}) уйдут в архив, если в них нет ваших операций.
            </p>
            <p>Операции, которые вы после импорта изменили, тоже уберутся. Тот же файл эти строки не вернёт — как и удалённые вручную.</p>
          </div>
        }
        confirmLabel="Отменить импорт"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void undo()}
      />
    </div>
  );
}
