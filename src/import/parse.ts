import { amountToMinor, parseZenCurrency, scanAmount, type AmountBadCode, type AmountScan } from './amount';
import { mapColumns, type ColumnIndex, type SideColumns } from './columns';
import { parseCsv, type CsvRecord } from './csv';
import { amountMessage, dateMessage, quoted } from './messages';
import { nameKey, sanitizeText, truncateText } from './text';
import {
  ImportFileError,
  MAX_FILE_BYTES,
  type AccountRef,
  type IssueCode,
  type ParsedFile,
  type RowIssue,
  type Side,
  type SkippedRow,
  type ZenRow,
} from './types';
import { parseZenDate } from './zenDate';

/** Лимиты репозитория (db/validate.ts LIMITS): название — 60, заметка — 500 знаков. */
export const NAME_MAX = 60;
export const NOTE_MAX = 500;

const SEP = '\u001f';
const CATEGORY_SPLIT = /\s\/\s/;

/** «Родитель / Ребёнок» → ['Родитель', 'Ребёнок']; без разделителя — одна часть; пусто — []. Глубже двух уровней — всё в «ребёнка». */
export function splitCategory(raw: string): string[] {
  const s = sanitizeText(raw);
  if (s === '') return [];
  // пробелы по краям нужны, чтобы «Еда /» и «/ Еда» (пустой родитель или ребёнок) разбирались так же, как «Еда / Кафе»
  const parts = ` ${s} `.split(CATEGORY_SPLIT).map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length <= 2) return parts;
  return [parts[0]!, parts.slice(1).join(' / ')];
}

interface SideRaw {
  cols: SideColumns | undefined;
  amount: string;
  account: string;
  currency: string;
  scan: AmountScan;
}

type Outcome =
  | { type: 'blank' }
  | { type: 'row'; row: Omit<ZenRow, 'index' | 'idKey'>; norm: string }
  | { type: 'review'; issue: RowIssue }
  | { type: 'skip'; skip: SkippedRow };

class Reader {
  namesTruncated = 0;
  notesTruncated = 0;

  constructor(
    private readonly idx: ColumnIndex,
    private readonly width: number,
  ) {}

  private account(raw: string, currency: string): AccountRef | null {
    const clean = truncateText(sanitizeText(raw), NAME_MAX, false);
    if (clean.text === '') return null;
    if (clean.cut) this.namesTruncated++;
    return { key: `${nameKey(clean.text)}|${currency}`, name: clean.text, currency };
  }

  read(rec: CsvRecord): Outcome {
    const { cells, line } = rec;
    const idx = this.idx;
    if (cells.every((c) => c.trim() === '')) return { type: 'blank' };
    const get = (i: number | undefined): string => (i === undefined ? '' : (cells[i] ?? ''));

    const sideRaw = (cols: SideColumns | undefined): SideRaw => {
      const amount = get(cols?.amount);
      return { cols, amount, account: get(cols?.account), currency: get(cols?.currency), scan: cols ? scanAmount(amount) : { kind: 'zero' } };
    };
    const out = sideRaw(idx.outcome);
    const inc = sideRaw(idx.income);
    const dateRaw = get(idx.date);

    const summary = (): string => {
      const parts = [dateRaw.trim()];
      // нулевую сторону («0» или пусто) в описании не показываем: она только шумит
      if (out.scan.kind !== 'zero') parts.push(`−${out.amount.trim()} ${out.currency.trim()}`.trim());
      if (inc.scan.kind !== 'zero') parts.push(`+${inc.amount.trim()} ${inc.currency.trim()}`.trim());
      return sanitizeText(parts.filter((p) => p !== '').join(' · ')).slice(0, 80);
    };
    const review = (code: IssueCode, message: string): Outcome => ({ type: 'review', issue: { line, code, message, summary: summary() } });

    if (cells.length !== this.width) {
      return review(
        'columns',
        `В строке ${cells.length} столбцов, а в заголовке ${this.width}: возможно, в тексте есть лишний разделитель, не взятый в кавычки`,
      );
    }

    const date = parseZenDate(dateRaw);
    if (!date.ok) {
      if (date.reason === 'empty') return { type: 'skip', skip: { line, code: 'no-date', message: 'нет даты' } };
      return review(date.reason === 'range' ? 'date-range' : 'date', dateMessage(date.reason, dateRaw));
    }

    for (const [side, label] of [
      [out, 'списания'],
      [inc, 'зачисления'],
    ] as const) {
      if (side.scan.kind === 'bad') return review(amountCode(side.scan.code), amountMessage(side.scan.code, side.amount, label));
    }
    const outNum = out.scan.kind === 'number' ? out.scan : null;
    const incNum = inc.scan.kind === 'number' ? inc.scan : null;
    if (!outNum && !incNum) return { type: 'skip', skip: { line, code: 'zero', message: 'нулевая сумма' } };

    const sides: { out: Side | null; inc: Side | null } = { out: null, inc: null };
    for (const [slot, raw, num, label] of [
      ['out', out, outNum, 'списания'],
      ['inc', inc, incNum, 'зачисления'],
    ] as const) {
      if (!num) continue;
      const currency = parseZenCurrency(raw.currency);
      if (currency === null) {
        return review('currency', raw.currency.trim() === '' ? `Не указана валюта ${label}` : `Непонятная валюта ${label}: ${quoted(raw.currency, 12)}`);
      }
      const account = this.account(raw.account, currency);
      if (!account) return review('account', `Не указан счёт ${label}`);
      const minor = amountToMinor(num, currency);
      if (!minor.ok) return review(amountCode(minor.code), amountMessage(minor.code, raw.amount, label, currency));
      sides[slot] = { account, amountMinor: minor.minor };
    }

    const kind = sides.out && sides.inc ? 'transfer' : sides.out ? 'expense' : 'income';
    if (sides.out && sides.inc && sides.out.account.key === sides.inc.account.key) {
      return review('same-account', `Перевод со счёта «${sides.out.account.name}» на него же`);
    }

    const categoryPath = kind === 'transfer' ? [] : splitCategory(get(idx.category)).map((p) => this.cutName(p));
    const payee = sanitizeText(get(idx.payee));
    const comment = sanitizeText(get(idx.comment));
    const joined = [payee, comment].filter((p) => p !== '').join(' — ');
    const note = truncateText(joined, NOTE_MAX, true);
    if (note.cut) this.notesTruncated++;

    const norm = [
      date.date,
      categoryPath.join(' / '),
      payee,
      comment,
      sides.out?.account.key ?? '',
      sides.out?.amountMinor ?? '',
      sides.inc?.account.key ?? '',
      sides.inc?.amountMinor ?? '',
    ].join(SEP);
    return { type: 'row', norm, row: { line, date: date.date, kind, outcome: sides.out, income: sides.inc, categoryPath, note: note.text } };
  }

  private cutName(name: string): string {
    const t = truncateText(name, NAME_MAX, false);
    if (t.cut) this.namesTruncated++;
    return t.text;
  }
}

function amountCode(code: AmountBadCode): IssueCode {
  switch (code) {
    case 'unreadable':
      return 'amount-unreadable';
    case 'negative':
      return 'amount-negative';
    case 'ambiguous':
      return 'amount-ambiguous';
    case 'precision':
      return 'amount-precision';
    case 'big':
      return 'amount-big';
  }
}

/**
 * Файл Zenmoney (текст CSV) → пригодные строки, строки «нужно проверить» и «пропущено».
 * Бросает ImportFileError с готовым человеческим текстом, если файл не похож на выгрузку Zenmoney или слишком велик.
 */
export function parseZenmoney(text: string, encoding = 'utf-8'): ParsedFile {
  if (text.length > MAX_FILE_BYTES) {
    throw new ImportFileError('Файл больше 10 МБ. Выгрузите операции частями (например, по годам) и загрузите по очереди.');
  }
  const csv = parseCsv(text);
  const head = csv.records[0];
  if (!head) throw new ImportFileError('Файл пустой: в нём нет ни одной строки.');
  const cols = mapColumns(head.cells);
  if (!cols.ok) throw new ImportFileError(cols.message);

  const reader = new Reader(cols.index, head.cells.length);
  const rows: ZenRow[] = [];
  const review: RowIssue[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Map<string, number>();
  let totalRecords = 0;

  for (let i = 1; i < csv.records.length; i++) {
    const o = reader.read(csv.records[i]!);
    if (o.type === 'blank') continue;
    totalRecords++;
    if (o.type === 'review') review.push(o.issue);
    else if (o.type === 'skip') skipped.push(o.skip);
    else {
      // Одинаковые строки различаются порядковым номером: так две одинаковые чашки кофе за день остаются двумя операциями
      const ordinal = seen.get(o.norm) ?? 0;
      seen.set(o.norm, ordinal + 1);
      rows.push({ ...o.row, index: rows.length, idKey: `zen:${o.norm}${SEP}#${ordinal}` });
    }
  }

  return {
    delimiter: csv.delimiter,
    encoding,
    columns: head.cells.map((c) => sanitizeText(c)),
    totalRecords,
    rows,
    review,
    skipped,
    notesTruncated: reader.notesTruncated,
    namesTruncated: reader.namesTruncated,
  };
}
