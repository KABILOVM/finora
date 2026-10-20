import { ValidationError, type Store } from '@/db';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, Minor } from '@/domain/types';
import { categoryKey } from './ids';
import type { ImportPlan, PlanCategory, PlanOp, PlanWallet } from './types';
import type { ImportJournal } from './undoImport';

/**
 * Запись плана в базу — только через репозитории (store.wallets / categories / transactions): все их проверки работают.
 *  - порядок: кошельки → категории (родители раньше детей) → операции порциями;
 *  - порция пишется в ОДНОЙ транзакции базы (репозитории присоединяются к ней): в 20–50 раз быстрее, чем по одной,
 *    и экраны не перерисовываются на каждую операцию. Если порция не прошла — её строки пишутся по одной,
 *    чтобы плохая строка не тянула остальные: ошибки собираются в отчёт;
 *  - идемпотентно: id детерминированы, repo.create с тем же id ничего не затирает, поэтому повторный запуск
 *    (двойной тап, закрытый экран, повторный файл) не создаёт дублей;
 *  - остановка (signal) — между порциями; всё уже записанное остаётся целым.
 */

export interface ImportProgress {
  phase: 'wallets' | 'categories' | 'transactions';
  done: number;
  total: number;
}

export interface FailedOp {
  line: number;
  /** «2024-02-29 · 150 с.» */
  label: string;
  reason: string;
}

export interface ReconcileLine {
  id: string;
  name: string;
  currency: CurrencyCode;
  /** Остаток кошелька по файлу = сумма записанных из файла движений. null — не помещается в число. */
  fileBalanceMinor: Minor | null;
  /** Кошелёк создан в этот раз (а не найден от прошлого импорта). */
  created: boolean;
}

export interface ImportReport {
  stopped: boolean;
  /** Остановились из-за ошибки, после которой продолжать нельзя (например, нет места на устройстве). */
  fatal: string | null;
  total: number;
  added: number;
  failedCount: number;
  /** Первые ошибки (не больше MAX_FAILED_KEPT). */
  failed: FailedOp[];
  alreadyThere: number;
  review: number;
  skipped: number;
  waitRate: number;
  blocked: number;
  createdWallets: number;
  createdCategories: number;
  reconcile: ReconcileLine[];
  elapsedMs: number;
  /** Что записал этот запуск — для «Отменить импорт». Нет, если ничего не создано. */
  journal?: ImportJournal;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (p: ImportProgress) => void;
  /** Сколько операций в одной транзакции (по умолчанию 250). */
  chunkSize?: number;
  /** Без быстрого пути «порция одной транзакцией»: только по одной (для замера и проверки). */
  oneByOne?: boolean;
}

export const MAX_FAILED_KEPT = 200;
const DEFAULT_CHUNK = 250;
const WALLET_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#ea580c', '#db2777', '#ca8a04', '#475569', '#16a34a'];
const CATEGORY_COLOR = '#64748b';
const CATEGORY_ICON = '🏷️';

/** Текст ошибки для человека. Своих ошибок проверки — как есть; чужие — коротко, подробности в консоль. */
function humanize(e: unknown): string {
  if (e instanceof ValidationError) return e.message;
  console.error('Импорт: неожиданная ошибка записи', e);
  return 'Не удалось сохранить операцию (внутренняя ошибка)';
}

const isQuota = (e: unknown): boolean => /quota/i.test(`${(e as { name?: string })?.name ?? ''} ${(e as { message?: string })?.message ?? ''}`);

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Порядок записи: старые даты раньше; внутри дня — как в файле (так день в списке выглядит как в Дзен-мани). */
export function writeOrder(ops: readonly PlanOp[]): PlanOp[] {
  return ops.filter((o) => o.status === 'add').sort((a, b) => (a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : a.row.line - b.row.line));
}

async function writeChunk(store: Store, chunk: readonly PlanOp[], oneByOne: boolean): Promise<Map<PlanOp, string>> {
  if (!oneByOne) {
    try {
      await store.db.transaction('rw', store.db.tables, async () => {
        for (const op of chunk) await store.transactions.create(op.input!, { id: op.id });
      });
      return new Map();
    } catch (e) {
      if (isQuota(e)) throw e;
      // порция откатилась целиком: пробуем по одной, чтобы найти плохую строку
    }
  }
  const failed = new Map<PlanOp, string>();
  for (const op of chunk) {
    try {
      await store.transactions.create(op.input!, { id: op.id });
    } catch (e) {
      if (isQuota(e)) throw e;
      failed.set(op, humanize(e));
    }
  }
  return failed;
}

async function ensureWallets(store: Store, plan: ImportPlan): Promise<{ failed: Map<string, string>; created: Set<string> }> {
  const failed = new Map<string, string>();
  const created = new Set<string>();
  let i = 0;
  for (const w of plan.wallets) {
    if (w.target.kind !== 'create' || w.addCount === 0) continue;
    const { id, name } = w.target;
    try {
      const existing = await store.db.wallets.get(id);
      if (existing) {
        if (existing.deletedAt !== null || existing.archivedAt !== null) {
          throw new ValidationError(`Кошелёк «${existing.name}», созданный прошлым импортом, удалён или в архиве`);
        }
        continue; // уже создан (прошлый, прерванный запуск): пользуемся им
      }
      await store.wallets.create(
        { name, currency: w.currency, kind: 'other', openingBalanceMinor: 0, color: WALLET_COLORS[i % WALLET_COLORS.length]!, icon: '💰' },
        { id },
      );
      created.add(id);
      i++;
    } catch (e) {
      failed.set(w.key, e instanceof ValidationError ? e.message : `Не удалось создать кошелёк «${name}»`);
      if (!(e instanceof ValidationError)) console.error('Импорт: не создан кошелёк', e);
    }
  }
  return { failed, created };
}

async function ensureCategories(store: Store, plan: ImportPlan): Promise<{ failed: Map<string, string>; created: number; createdIds: string[] }> {
  const failed = new Map<string, string>();
  const byKey = new Map<string, PlanCategory>(plan.categories.map((c) => [c.key, c]));
  let created = 0;
  const createdIds: string[] = [];
  for (const c of plan.categories) {
    if (c.target.kind !== 'create' || !c.needed) continue;
    const parent = c.parentKey ? byKey.get(c.parentKey) : undefined;
    if (c.parentKey && failed.has(c.parentKey)) {
      failed.set(c.key, failed.get(c.parentKey)!);
      continue;
    }
    const parentId = parent && parent.target.kind !== 'missing' ? parent.target.id : null;
    try {
      const existing = await store.db.categories.get(c.target.id);
      if (existing) {
        if (existing.deletedAt !== null) throw new ValidationError(`Категория «${existing.name}», созданная прошлым импортом, удалена`);
        continue;
      }
      await store.categories.create({ name: c.name, kind: c.catKind, color: CATEGORY_COLOR, icon: CATEGORY_ICON, parentId }, { id: c.target.id });
      created++;
      createdIds.push(c.target.id);
    } catch (e) {
      failed.set(c.key, e instanceof ValidationError ? e.message : `Не удалось создать категорию «${c.name}»`);
      if (!(e instanceof ValidationError)) console.error('Импорт: не создана категория', e);
    }
  }
  return { failed, created, createdIds };
}

function label(op: PlanOp): string {
  const side = op.row.outcome ?? op.row.income;
  const amount = side ? formatMinor(side.amountMinor, side.account.currency) : '';
  return `${op.row.date} · ${amount}`.trim();
}

export async function runImport(store: Store, plan: ImportPlan, opts: RunOptions = {}): Promise<ImportReport> {
  const started = Date.now();
  const { signal, onProgress } = opts;
  const chunkSize = Math.max(1, opts.chunkSize ?? DEFAULT_CHUNK);
  const adds = writeOrder(plan.ops);
  const total = adds.length;

  const failedAll: FailedOp[] = [];
  let failedCount = 0;
  const failedIds = new Set<string>();
  const fail = (op: PlanOp, reason: string) => {
    failedCount++;
    failedIds.add(op.id);
    if (failedAll.length < MAX_FAILED_KEPT) failedAll.push({ line: op.row.line, label: label(op), reason });
  };

  onProgress?.({ phase: 'wallets', done: 0, total });
  const wallets = await ensureWallets(store, plan);
  onProgress?.({ phase: 'categories', done: 0, total });
  const cats = await ensureCategories(store, plan);

  // Операции, которым не хватает кошелька или категории, не пишем — честно отчитываемся
  const ready: PlanOp[] = [];
  for (const op of adds) {
    const keys = [op.row.outcome?.account.key, op.row.income?.account.key].filter((k): k is string => k !== undefined);
    const walletProblem = keys.map((k) => wallets.failed.get(k)).find((m) => m !== undefined);
    let catProblem: string | undefined;
    if (op.row.kind !== 'transfer') {
      for (let d = 1; d <= op.row.categoryPath.length && !catProblem; d++) {
        catProblem = cats.failed.get(categoryKey(op.row.kind, op.row.categoryPath.slice(0, d)));
      }
    }
    if (walletProblem) fail(op, walletProblem);
    else if (catProblem) fail(op, catProblem);
    else ready.push(op);
  }

  let added = 0;
  let processed = total - ready.length;
  let stopped = false;
  let fatal: string | null = null;
  const done = new Set<string>();
  onProgress?.({ phase: 'transactions', done: processed, total });

  for (let i = 0; i < ready.length; i += chunkSize) {
    if (signal?.aborted) {
      stopped = true;
      break;
    }
    const chunk = ready.slice(i, i + chunkSize);
    let failed: Map<PlanOp, string>;
    try {
      failed = await writeChunk(store, chunk, opts.oneByOne === true);
    } catch (e) {
      stopped = true;
      fatal = 'На устройстве не хватает места. Освободите память и загрузите файл ещё раз: уже добавленное повторно не добавится.';
      console.warn('Импорт остановлен: нет места', e);
      break;
    }
    for (const op of chunk) {
      const reason = failed.get(op);
      if (reason !== undefined) fail(op, reason);
      else {
        added++;
        done.add(op.id);
      }
    }
    processed += chunk.length;
    onProgress?.({ phase: 'transactions', done: processed, total });
    await tick();
  }

  return {
    stopped,
    fatal,
    total,
    added,
    failedCount,
    failed: failedAll,
    alreadyThere: plan.counts.exists,
    review: plan.counts.review,
    skipped: plan.counts.skipped,
    waitRate: plan.counts.waitRate,
    blocked: plan.counts.blocked,
    createdWallets: wallets.created.size,
    createdCategories: cats.created,
    reconcile: reconcileLines(plan, done, wallets.created),
    elapsedMs: Date.now() - started,
    ...(done.size > 0 || wallets.created.size > 0 || cats.createdIds.length > 0
      ? { journal: { txIds: [...done], walletIds: [...wallets.created], categoryIds: cats.createdIds } }
      : {}),
  };
}

/** Остаток по файлу для кошельков, которые создал импорт (в этот или в прошлый раз): сумма движений записанных строк. */
function reconcileLines(plan: ImportPlan, done: ReadonlySet<string>, createdNow: ReadonlySet<string>): ReconcileLine[] {
  const wanted = new Map<string, PlanWallet>();
  for (const w of plan.wallets) {
    const t = w.target;
    if ((t.kind === 'create' && w.addCount > 0) || (t.kind === 'existing' && t.how === 'saved')) wanted.set(w.key, w);
  }
  if (wanted.size === 0) return [];
  const sums = new Map<string, Minor | null>([...wanted.keys()].map((k) => [k, 0]));
  const move = (key: string, delta: Minor) => {
    const cur = sums.get(key);
    if (cur === undefined || cur === null) return;
    const next = cur + delta;
    sums.set(key, Number.isSafeInteger(next) ? next : null);
  };
  // Уже имеющаяся операция может лежать в другом кошельке (счёт направляли в другой или операцию перенесли): её деньги не часть
  // остатка этого кошелька, и подсказка «поправьте начальный остаток» посчитала бы их второй раз.
  const targetId = (key: string): string | null => {
    const t = wanted.get(key)?.target;
    return t && t.kind !== 'blocked' ? t.id : null;
  };
  for (const op of plan.ops) {
    if (op.status !== 'exists' && !(op.status === 'add' && done.has(op.id))) continue;
    const { outcome, income } = op.row;
    if (outcome && (op.placed === undefined || op.placed.out === targetId(outcome.account.key))) move(outcome.account.key, -outcome.amountMinor);
    if (income && (op.placed === undefined || op.placed.in === targetId(income.account.key))) move(income.account.key, income.amountMinor);
  }
  return [...wanted.values()].map((w) => {
    const sum = sums.get(w.key);
    return {
      id: w.target.kind === 'blocked' ? '' : w.target.id,
      name: w.target.kind === 'create' || w.target.kind === 'existing' ? w.target.name : w.name,
      currency: w.currency,
      fileBalanceMinor: sum === undefined ? 0 : sum,
      created: w.target.kind === 'create' && createdNow.has(w.target.id),
    };
  });
}
