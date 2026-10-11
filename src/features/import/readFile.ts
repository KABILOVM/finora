import type { Store } from '@/db';
import { decodeBytes } from '@/import/decode';
import { loadExisting } from '@/import/existing';
import { computeIds, type PlanIds } from '@/import/ids';
import { parseZenmoney } from '@/import/parse';
import { ImportFileError, MAX_FILE_BYTES, type ExistingTx, type ParsedFile } from '@/import/types';

/** Читает выбранный файл как байты. Blob.arrayBuffer() есть не везде — запасной путь через FileReader. */
function readBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
}

const paint = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Всё, что нужно для предпросмотра: разобранный файл, id и какие операции уже есть в базе. */
export interface ImportSession {
  fileName: string;
  parsed: ParsedFile;
  ids: PlanIds;
  /** Все операции базы, включая удалённые: id → данные операции (удалена ли, где лежит, что в ней). */
  existing: Map<string, ExistingTx>;
}

/**
 * Файл → сессия импорта. Бросает ImportFileError с готовым человеческим текстом.
 * Файл читается на устройстве и никуда не отправляется.
 */
export async function loadImportFile(store: Store, file: File): Promise<ImportSession> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportFileError('Файл больше 10 МБ. Выгрузите операции частями (например, по годам) и загрузите по очереди.');
  }
  const { text, encoding } = decodeBytes(await readBytes(file));
  await paint(); // дать экрану показать «Читаем файл…» до тяжёлого разбора
  const parsed = parseZenmoney(text, encoding);
  const ids = await computeIds(store.userId, parsed);
  const existing = await loadExisting(store);
  return { fileName: file.name, parsed, ids, existing };
}
