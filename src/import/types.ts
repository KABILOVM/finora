import type { TransactionInput } from '@/db';
import type { CategoryKind, CurrencyCode, IsoDate, Minor, TxKind, UUID } from '@/domain/types';

/**
 * Типы импорта из Zenmoney (CSV). Формат файла пока НЕ проверен на настоящей выгрузке, поэтому разбор написан
 * «с запасом» и честно отказывается, если что-то непонятно (см. parse.ts).
 */

/** Не больше стольких байт в файле. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Не больше стольких строк с операциями (без заголовка). */
export const MAX_DATA_ROWS = 50_000;

/** Ошибка, текст которой можно показать человеку как есть (по-русски, простыми словами). */
export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFileError';
  }
}

/** Счёт Zenmoney. key = «название в нижнем регистре|ВАЛЮТА» — по нему счёт узнаётся при повторном импорте. */
export interface AccountRef {
  key: string;
  name: string;
  currency: CurrencyCode;
}

/** Одна сторона строки: с какого счёта списано или на какой зачислено. */
export interface Side {
  account: AccountRef;
  amountMinor: Minor;
}

export type IssueCode =
  | 'columns'
  | 'date'
  | 'date-range'
  | 'amount-unreadable'
  | 'amount-ambiguous'
  | 'amount-precision'
  | 'amount-negative'
  | 'amount-big'
  | 'currency'
  | 'account'
  | 'same-account'
  | 'creates-money'
  | 'same-wallet'
  | 'fx-overflow';

/** Строка, которую нельзя ни добавить, ни пропустить молча: человеку нужно посмотреть самому. */
export interface RowIssue {
  line: number;
  code: IssueCode;
  /** Причина простыми словами. */
  message: string;
  /** Что было в строке (дата и суммы как в файле), коротко. */
  summary: string;
}

export type SkipCode = 'no-date' | 'zero';

/** Строка, в которой нечего импортировать. */
export interface SkippedRow {
  line: number;
  code: SkipCode;
  message: string;
}

/** Разобранная строка файла, которую можно добавить (до сопоставления с кошельками). */
export interface ZenRow {
  /** Порядковый номер среди пригодных строк (стабильный для одного файла). */
  index: number;
  /** Номер строки в файле (с 1, заголовок — 1). */
  line: number;
  date: IsoDate;
  kind: TxKind;
  /** Списание (расход или первая половина перевода). */
  outcome: Side | null;
  /** Зачисление (доход или вторая половина перевода). */
  income: Side | null;
  /** [] — без категории; ['Еда'] или ['Еда', 'Кафе'] (родитель, ребёнок). Только для расхода и дохода. */
  categoryPath: string[];
  note: string;
  /** Нормализованные поля строки + порядковый номер среди одинаковых: от них считается id операции. */
  idKey: string;
}

export interface ParsedFile {
  delimiter: string;
  encoding: string;
  /** Названия столбцов, как в файле. */
  columns: string[];
  /** Сколько строк с данными было в файле (без заголовка и пустых). */
  totalRecords: number;
  rows: ZenRow[];
  review: RowIssue[];
  skipped: SkippedRow[];
  /** Сколько заметок обрезано до лимита и сколько названий кошельков/категорий. */
  notesTruncated: number;
  namesTruncated: number;
}

// ───────────────────────── план ─────────────────────────

export interface WalletLite {
  id: UUID;
  name: string;
  currency: CurrencyCode;
  archivedAt: string | null;
  deletedAt: string | null;
}

export interface CategoryLite {
  id: UUID;
  name: string;
  kind: CategoryKind;
  parentId: UUID | null;
  archivedAt: string | null;
  deletedAt: string | null;
}

/** 'new' — создать новый кошелёк; иначе id существующего. */
export type WalletChoice = 'new' | UUID;

export type WalletTarget =
  /** how: saved — кошелёк, созданный прошлым импортом; name — совпал по названию и валюте; chosen — выбран вручную */
  | { kind: 'existing'; id: UUID; name: string; how: 'saved' | 'name' | 'chosen' }
  | { kind: 'create'; id: UUID; name: string }
  | { kind: 'blocked'; reason: string };

export interface PlanWallet {
  key: string;
  /** Название счёта в файле. */
  name: string;
  currency: CurrencyCode;
  /** Сколько строк файла относится к этому счёту (всех пригодных). */
  rowCount: number;
  target: WalletTarget;
  /** Кошельки, которые можно выбрать вручную (живые, не в архиве, та же валюта). */
  candidates: { id: UUID; name: string }[];
  /** Действует ли выбор человека (а не автоподбор). */
  chosen: boolean;
  /** Сколько операций этого счёта будет добавлено (кошелёк создаётся, только если их больше нуля). */
  addCount: number;
  /** Сумма движений по файлу (добавленные + уже имевшиеся). null — не помещается в число. */
  movementMinor: Minor | null;
}

export type CategoryTarget =
  | { kind: 'existing'; id: UUID; how: 'saved' | 'name' }
  | { kind: 'create'; id: UUID }
  /** Раньше созданная импортом категория удалена: операции придут без категории. */
  | { kind: 'missing'; reason: string };

export interface PlanCategory {
  key: string;
  catKind: CategoryKind;
  name: string;
  /** Полный путь для показа: «Еда / Кафе». */
  path: string[];
  parentKey: string | null;
  usedBy: number;
  /** Нужна ли для добавляемых операций (сама или как родитель): создаётся только нужная. */
  needed: boolean;
  target: CategoryTarget;
}

export type OpStatus = 'add' | 'exists' | 'review' | 'wait-rate' | 'blocked';

export interface PlanOp {
  row: ZenRow;
  id: UUID;
  status: OpStatus;
  reason?: string;
  /** Готовые данные для store.transactions.create (только у status === 'add'). */
  input?: TransactionInput;
  /** Операция уже есть, но была удалена: повторный импорт её не воскрешает. */
  existsDeleted?: boolean;
}

export interface RateNeed {
  currency: CurrencyCode;
  /** Сколько операций ждёт этого курса (или уже использует его). */
  rows: number;
  /** Курс, как его будут применять; null — не задан. */
  rate: number | null;
}

export interface PlanCounts {
  add: number;
  exists: number;
  existsDeleted: number;
  review: number;
  skipped: number;
  waitRate: number;
  blocked: number;
}

export interface ImportPlan {
  baseCurrency: CurrencyCode;
  wallets: PlanWallet[];
  categories: PlanCategory[];
  ops: PlanOp[];
  counts: PlanCounts;
  rates: RateNeed[];
  /** Строки, которые не прошли разбор + строки, не прошедшие проверку при планировании. */
  review: RowIssue[];
  skipped: SkippedRow[];
  /** Самая ранняя и самая поздняя дата среди добавляемых операций. */
  period: { from: IsoDate; to: IsoDate } | null;
  /** Предупреждения для показа (обрезанные заметки, категории, которые придут «без категории»…). */
  notes: string[];
}
