import { ImportFileError, MAX_DATA_ROWS } from './types';

/**
 * Свой разбор CSV (без новых зависимостей): кавычки, "" внутри кавычек, переводы строк внутри кавычек,
 * разделитель определяется по строке заголовков (запятая, точка с запятой или табуляция), BOM в начале убирается.
 * Номера строк — физические строки файла (заголовок — 1), поэтому человек находит нужную строку в своём файле.
 */

export interface CsvRecord {
  /** Номер строки файла, с которой начинается запись. */
  line: number;
  cells: string[];
}

export interface CsvResult {
  delimiter: string;
  /** Первая запись — заголовок. Полностью пустые строки не попадают. */
  records: CsvRecord[];
}

const CANDIDATES = [';', ',', '\t'] as const;

/** Разделитель по первой строке: тот, которого больше вне кавычек. Нет ни одного — запятая (одна колонка). */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (c === '\n' || c === '\r')) break;
    else if (!inQuotes && c in counts) counts[c] = (counts[c] ?? 0) + 1;
  }
  let best = ',';
  let bestCount = 0;
  for (const d of CANDIDATES) {
    const n = counts[d] ?? 0;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

export interface CsvOptions {
  /** Сколько строк с данными (без заголовка) допустимо. */
  maxDataRows?: number;
}

export function parseCsv(input: string, opts: CsvOptions = {}): CsvResult {
  const maxData = opts.maxDataRows ?? MAX_DATA_ROWS;
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  let line = 1;

  // Строка «sep=;» (её пишет Excel) задаёт разделитель и в данные не входит
  let delimiter: string | null = null;
  const sep = /^sep=(.)\r?\n/i.exec(text);
  if (sep) {
    delimiter = sep[1]!;
    text = text.slice(sep[0].length);
    line++;
  }
  if (delimiter === null) delimiter = detectDelimiter(text);

  const records: CsvRecord[] = [];
  const n = text.length;
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let atStart = true; // мы в начале поля (пробелы перед кавычкой допустимы)
  let recordLine = line;

  const endRecord = () => {
    cells.push(field);
    const blank = cells.length === 1 && cells[0]!.trim() === '';
    if (!blank) {
      records.push({ line: recordLine, cells });
      if (records.length > maxData + 1) {
        throw new ImportFileError(
          `В файле больше ${String(maxData).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} строк с операциями. Выгрузите их частями (например, по годам) и загрузите по очереди.`,
        );
      }
    }
    cells = [];
    field = '';
    atStart = true;
  };

  for (let i = 0; i < n; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
        if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
      }
      continue;
    }
    if (c === '"' && (atStart || field.trim() === '')) {
      field = '';
      inQuotes = true;
      atStart = false;
    } else if (c === delimiter) {
      cells.push(field);
      field = '';
      atStart = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += c;
      atStart = false;
    }
  }
  if (inQuotes) {
    throw new ImportFileError(
      `Файл повреждён: в строке ${recordLine} открыта кавычка, а закрывающей нет. Откройте файл в текстовом редакторе и проверьте эту строку.`,
    );
  }
  if (field !== '' || cells.length > 0) endRecord();

  return { delimiter, records };
}
