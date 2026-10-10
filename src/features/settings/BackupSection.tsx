import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { exportBackup, exportTransactionsCsv, importBackup, useStore, ValidationError, type ImportResult } from '@/db';
import { todayLocal } from '@/lib/dates';
import { MAX_BACKUP_FILE_BYTES, downloadTextFile } from './download';
import { SettingsSection } from './SettingsSection';

interface PendingImport {
  fileName: string;
  data: unknown;
}

/** Понятный человеку текст ошибки. Технические подробности остаются в консоли. */
export function backupErrorText(e: unknown, action: 'export' | 'import'): string {
  if (e instanceof ValidationError) return e.message;
  console.error(action === 'import' ? 'Ошибка загрузки копии:' : 'Ошибка выгрузки:', e);
  return action === 'import'
    ? 'Не удалось загрузить копию. Данные на устройстве не изменены.'
    : 'Не удалось подготовить файл. Попробуйте ещё раз.';
}

/** Резервная копия: скачать JSON (полная) и CSV (для таблиц), загрузить JSON обратно. */
export function BackupSection() {
  const store = useStore();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'json' | 'csv' | 'import' | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const exportJson = async () => {
    if (busy) return;
    setBusy('json');
    setError(null);
    try {
      const file = await exportBackup(store);
      downloadTextFile(`finora-backup-${todayLocal()}.json`, 'application/json', JSON.stringify(file, null, 2));
      toast.success('Файл с копией готов — проверьте загрузки на устройстве');
    } catch (e) {
      setError(backupErrorText(e, 'export'));
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    if (busy) return;
    setBusy('csv');
    setError(null);
    try {
      downloadTextFile(`finora-transactions-${todayLocal()}.csv`, 'text/csv', await exportTransactionsCsv(store));
      toast.success('Файл с операциями готов — проверьте загрузки на устройстве');
    } catch (e) {
      setError(backupErrorText(e, 'export'));
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = ''; // чтобы можно было выбрать тот же файл ещё раз
    if (!file) return;
    setError(null);
    setResult(null);
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setError('Файл слишком большой для копии Finora. Выберите файл, скачанный из этого приложения.');
      return;
    }
    try {
      const text = await file.text();
      setPending({ fileName: file.name, data: JSON.parse(text) as unknown });
    } catch {
      setError('Не удалось прочитать файл: это не копия Finora (нужен файл .json, скачанный из приложения).');
    }
  };

  const runImport = async () => {
    if (!pending || busy) return;
    setBusy('import');
    try {
      const r = await importBackup(store, pending.data);
      setResult(r);
      setPending(null);
    } catch (e) {
      setPending(null);
      setError(backupErrorText(e, 'import'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsSection title="Резервная копия">
      <p className="text-muted">
        Копия — это файл со всеми кошельками, категориями и операциями. Сохраняйте его в надёжное место (облако, почта, компьютер).
      </p>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" icon="download" loading={busy === 'json'} onClick={() => void exportJson()}>
          Скачать копию (JSON)
        </Button>
        <Button variant="secondary" icon="download" loading={busy === 'csv'} onClick={() => void exportCsv()}>
          Скачать операции (CSV)
        </Button>
        <Button variant="secondary" icon="upload" loading={busy === 'import'} onClick={() => fileInput.current?.click()}>
          Загрузить копию (JSON)
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Файл копии"
          onChange={(e) => void onFile(e)}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 p-3 font-medium text-danger">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="rounded-xl bg-income/10 p-3">
          <p className="font-semibold text-income">Копия загружена</p>
          <ul className="mt-1 list-disc pl-5">
            <li>Добавлено записей: {result.added}</li>
            <li>Заменено более новыми из файла: {result.replaced}</li>
            <li>Оставлено текущих (они новее или такие же): {result.keptLocal}</li>
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        loading={busy === 'import'}
        title="Загрузить копию?"
        confirmLabel="Загрузить"
        message={
          pending
            ? `Файл «${pending.fileName}» будет объединён с вашими данными: у каждой записи побеждает более новая версия, ничего не удаляется. Копия чужого аккаунта не загрузится.`
            : undefined
        }
        onConfirm={() => void runImport()}
        onCancel={() => busy !== 'import' && setPending(null)}
      />
    </SettingsSection>
  );
}
