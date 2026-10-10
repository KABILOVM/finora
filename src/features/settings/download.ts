/** Отдаёт текст человеку как файл (скачивание через временную ссылку). Работает и на iPhone в Safari. */
export function downloadTextFile(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // ссылку освобождаем не сразу: Safari начинает скачивание асинхронно
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Резервная копия — максимум столько байт (защита от случайно выбранного огромного файла). */
export const MAX_BACKUP_FILE_BYTES = 25 * 1024 * 1024;

/** Читает выбранный файл как текст. Blob.text() есть не во всех браузерах — запасной путь через FileReader. */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });
}
