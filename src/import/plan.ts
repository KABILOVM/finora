import type { TransactionInput } from '@/db';
import { BASE_AMOUNT_MAX } from '@/db/validate';
import { addMinor, fxSnapshot } from '@/domain/money';
import type { CurrencyCode, Minor } from '@/domain/types';
import { MAX_PER_UNIT, MIN_PER_UNIT } from '@/rates/parseUtil';
import { buildContentIndex, contentKey, isDeletedEntry, placementOf, type ContentIndex, type ExistingMap } from './existing';
import { collectAccounts, categoryKey, type PlanIds } from './ids';
import { categoryIdOf, resolveCategories } from './planCategories';
import { resolveWallet, targetWalletId, walletHistory } from './planWallets';
import { quoted } from './messages';
import { pluralRu } from '@/lib/plural';
import type {
  CategoryLite,
  ImportPlan,
  IssueCode,
  ParsedFile,
  PlanCategory,
  PlanCounts,
  PlanOp,
  PlanWallet,
  RateNeed,
  RowIssue,
  WalletChoice,
  WalletLite,
  ZenRow,
} from './types';
import { NOTE_MAX } from './parse';

export interface PlanInput {
  parsed: ParsedFile;
  ids: PlanIds;
  baseCurrency: CurrencyCode;
  /** ВСЕ кошельки базы, в том числе архивные и удалённые (чтобы заметить конфликт с id прошлого импорта). */
  wallets: readonly WalletLite[];
  categories: readonly CategoryLite[];
  /**
   * Все операции базы, включая удалённые: повторный импорт их не воскрешает. id → удалена ли (boolean) либо полные данные
   * операции (ExistingTx, см. existing.ts). Только с полными данными работают проверка «по содержимому» (после переноса данных
   * в аккаунт id перекодируются), выбор кошелька, где счёт уже лежит, и честный «остаток по файлу».
   */
  existing: ExistingMap;
  walletChoices?: Readonly<Record<string, WalletChoice>>;
  /** Курс «единиц базовой валюты за 1 единицу этой валюты», введённый человеком. */
  rates?: Readonly<Record<CurrencyCode, number | null | undefined>>;
  /**
   * id операций файла, найденных «по содержимому» (возможный дубль), которые человек всё равно решил добавить. На проверку «по номеру»
   * это не влияет: операция с таким же id уже в базе не добавится никогда.
   */
  forceAdd?: ReadonlySet<string>;
}

/** Курс годится: конечное число в тех же пределах, что в курсовом сервисе. */
export function isUsableRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= MIN_PER_UNIT && rate <= MAX_PER_UNIT;
}

/** Курс «1 единица from = rate единиц to» в операции записывается как есть, с источником 'manual'. */
const FX_SOURCE = 'manual';

function fxProblem(amount: Minor, from: CurrencyCode, base: CurrencyCode, rate: number): boolean {
  try {
    return fxSnapshot(amount, from, base, rate).baseAmountMinor > BASE_AMOUNT_MAX;
  } catch {
    return true;
  }
}

function periodOf(ops: readonly PlanOp[]): ImportPlan['period'] {
  let from: string | null = null;
  let to: string | null = null;
  for (const op of ops) {
    if (op.status !== 'add') continue;
    if (from === null || op.row.date < from) from = op.row.date;
    if (to === null || op.row.date > to) to = op.row.date;
  }
  return from !== null && to !== null ? { from, to } : null;
}

/**
 * ПЛАН импорта без записи в базу (чистая функция): сопоставление счетов и категорий, список операций со статусами,
 * счётчики «будет добавлено / уже есть / нужно проверить / пропущено», нужные курсы. id берутся из заранее посчитанной
 * таблицы (ids.ts), поэтому план строится синхронно и быстро — его можно пересчитывать при каждом выборе человека.
 * Статус 'exists' проверяется по id первым: уже имеющаяся операция (в том числе удалённая) не меняется никогда.
 */
export function buildPlan(input: PlanInput): ImportPlan {
  const { parsed, ids, baseCurrency, wallets, categories, existing } = input;
  const rows = parsed.rows;

  // ── счета и кошельки
  const accounts = collectAccounts(rows);
  const planWallets: PlanWallet[] = [];
  const walletByKey = new Map<string, PlanWallet>();
  const history = walletHistory(rows, ids.tx, existing);
  for (const acc of accounts.values()) {
    const w: PlanWallet = {
      ...resolveWallet(acc, wallets, ids.wallets.get(acc.key) ?? '', input.walletChoices?.[acc.key], history.get(acc.key)),
      addCount: 0,
      movementMinor: 0,
    };
    planWallets.push(w);
    walletByKey.set(acc.key, w);
  }

  // ── категории
  const catMap = resolveCategories(rows, categories, ids.categories);

  // ── операции
  const ops: PlanOp[] = [];
  const review: RowIssue[] = [...parsed.review];
  const needs = new Map<CurrencyCode, RateNeed>();
  const counts: PlanCounts = { add: 0, exists: 0, existsDeleted: 0, review: parsed.review.length, skipped: parsed.skipped.length, waitRate: 0, blocked: 0 };
  const rateOf = (cur: CurrencyCode): number | null => {
    const r = input.rates?.[cur];
    return isUsableRate(r) ? r : null;
  };
  const need = (cur: CurrencyCode): RateNeed => {
    let n = needs.get(cur);
    if (!n) {
      n = { currency: cur, rows: 0, rate: rateOf(cur) };
      needs.set(cur, n);
    }
    n.rows++;
    return n;
  };
  const toReview = (row: ZenRow, code: IssueCode, message: string): PlanOp => {
    review.push({ line: row.line, code, message, summary: `${row.date}` });
    counts.review++;
    return { row, id: ids.tx[row.index] ?? '', status: 'review', reason: message };
  };

  // Индекс «по содержимому» строится лениво: когда все строки найдены по номеру, он не нужен вовсе
  let byContent: ContentIndex | null = null;
  let contentHits = 0;
  const missingUse = new Map<string, number>();
  for (const row of rows) {
    const id = ids.tx[row.index] ?? '';
    const found = existing.get(id);
    if (found !== undefined) {
      const isDeleted = isDeletedEntry(found);
      counts.exists++;
      if (isDeleted) counts.existsDeleted++;
      ops.push({ row, id, status: 'exists', existsDeleted: isDeleted, ...(typeof found === 'boolean' ? {} : { placed: placementOf(row.kind, found) }) });
      continue;
    }
    ops.push(planOne(row, id));
  }

  function planOne(row: ZenRow, id: string): PlanOp {
    const out = row.outcome ? walletByKey.get(row.outcome.account.key) : undefined;
    const inc = row.income ? walletByKey.get(row.income.account.key) : undefined;
    for (const w of [out, inc]) {
      if (w && w.target.kind === 'blocked') {
        counts.blocked++;
        return { row, id, status: 'blocked', reason: w.target.reason };
      }
    }
    const outId = out ? targetWalletId(out.target) : null;
    const incId = inc ? targetWalletId(inc.target) : null;

    const cat = row.categoryPath.length > 0 && row.kind !== 'transfer' ? catMap.get(categoryKey(row.kind, row.categoryPath)) : undefined;
    const base: TransactionInput = {
      kind: row.kind,
      walletId: '',
      toWalletId: null,
      amountMinor: 0,
      toAmountMinor: null,
      categoryId: categoryIdOf(cat?.target),
      occurredOn: row.date,
      note: row.note,
    };

    let rateCurrency: CurrencyCode | null = null;
    let rateAmount = 0;
    let txInput: TransactionInput;
    if (row.kind === 'transfer') {
      const o = row.outcome!;
      const i = row.income!;
      if (outId === null || incId === null) return toReview(row, 'same-wallet', 'Кошелёк счёта не определён');
      if (outId === incId) {
        return toReview(row, 'same-wallet', `Счета «${o.account.name}» и «${i.account.name}» сопоставлены с одним кошельком, а перевод между ними невозможен`);
      }
      const sameCur = o.account.currency === i.account.currency;
      if (sameCur && i.amountMinor > o.amountMinor) {
        return toReview(row, 'creates-money', 'Перевод в одной валюте: зачислено больше, чем списано. Так деньги появились бы из воздуха');
      }
      const fee = sameCur ? o.amountMinor - i.amountMinor : 0;
      if (fee > 0 && o.account.currency !== baseCurrency) {
        rateCurrency = o.account.currency;
        rateAmount = fee;
      }
      txInput = { ...base, walletId: outId, toWalletId: incId, amountMinor: o.amountMinor, toAmountMinor: i.amountMinor, categoryId: null };
    } else {
      const side = row.kind === 'expense' ? row.outcome! : row.income!;
      const wid = row.kind === 'expense' ? outId : incId;
      if (wid === null) return toReview(row, 'same-wallet', 'Кошелёк счёта не определён');
      if (side.account.currency !== baseCurrency) {
        rateCurrency = side.account.currency;
        rateAmount = side.amountMinor;
      }
      txInput = { ...base, walletId: wid, amountMinor: side.amountMinor };
    }

    // Не нашлась по номеру — ищем такую же операцию по содержимому (после переноса данных в аккаунт номера другие, а история та же)
    byContent ??= buildContentIndex(existing, new Set(ids.tx));
    const hit = byContent.take(
      contentKey({
        kind: txInput.kind,
        occurredOn: txInput.occurredOn,
        walletId: txInput.walletId,
        toWalletId: txInput.toWalletId ?? null,
        amountMinor: txInput.amountMinor,
        toAmountMinor: txInput.toAmountMinor ?? null,
        note: txInput.note ?? '',
      }),
    );
    if (hit !== null && !input.forceAdd?.has(id)) {
      counts.exists++;
      contentHits++;
      if (hit === 'deleted') counts.existsDeleted++;
      return { row, id, status: 'exists', existsDeleted: hit === 'deleted', byContent: true, placed: { out: row.outcome ? outId : null, in: row.income ? incId : null } };
    }

    if (rateCurrency !== null) {
      const n = need(rateCurrency);
      const rate = rateOf(rateCurrency);
      if (rate === null) {
        counts.waitRate++;
        return { row, id, status: 'wait-rate', reason: `Нет курса ${rateCurrency} → ${baseCurrency}` };
      }
      if (fxProblem(rateAmount, rateCurrency, baseCurrency, rate)) {
        n.rows--;
        return toReview(row, 'fx-overflow', 'Сумма слишком велика для пересчёта в основную валюту по этому курсу');
      }
      txInput = { ...txInput, fx: { rate, source: FX_SOURCE } };
    }
    counts.add++;
    if (cat?.target.kind === 'missing') missingUse.set(cat.key, (missingUse.get(cat.key) ?? 0) + 1);
    return { row, id, status: 'add', input: txInput };
  }

  // ── кошельки: сколько операций добавится и сумма движений по файлу
  const overflow = new Set<string>();
  const move = (key: string, delta: Minor) => {
    const w = walletByKey.get(key);
    if (!w || w.movementMinor === null) return;
    try {
      w.movementMinor = addMinor(w.movementMinor, delta);
    } catch {
      w.movementMinor = null;
      overflow.add(key);
    }
  };
  const neededCats = new Set<string>();
  for (const op of ops) {
    if (op.status !== 'add' && op.status !== 'exists') continue;
    const r = op.row;
    if (op.status === 'add') {
      for (const side of [r.outcome, r.income]) if (side) walletByKey.get(side.account.key)!.addCount++;
      if (r.kind !== 'transfer' && r.categoryPath.length > 0) {
        for (let d = 1; d <= r.categoryPath.length; d++) neededCats.add(categoryKey(r.kind, r.categoryPath.slice(0, d)));
      }
    }
    if (r.outcome) move(r.outcome.account.key, -r.outcome.amountMinor);
    if (r.income) move(r.income.account.key, r.income.amountMinor);
  }

  const categoriesList: PlanCategory[] = [...catMap.values()];
  const notes: string[] = [];
  for (const c of categoriesList) {
    c.needed = neededCats.has(c.key);
    const n = missingUse.get(c.key) ?? 0;
    if (c.target.kind === 'missing' && n > 0) {
      notes.push(`${c.target.reason}: ${n} ${pluralRu(n, 'операция придёт', 'операции придут', 'операций придут')} без категории (${quoted(c.path.join(' / '), 40)}).`);
    }
  }
  if (parsed.notesTruncated > 0) {
    const n = parsed.notesTruncated;
    notes.push(`У ${n} ${pluralRu(n, 'операции', 'операций', 'операций')} заметка длиннее ${NOTE_MAX} знаков: она обрезана, в конце стоит «…».`);
  }
  if (parsed.namesTruncated > 0) {
    notes.push(`Названия длиннее 60 знаков (счета или категории) обрезаны: ${parsed.namesTruncated}.`);
  }
  if (contentHits > 0) {
    notes.push(
      `У ${contentHits} ${pluralRu(contentHits, 'операции', 'операций', 'операций')} совпали дата, сумма, кошелёк и заметка с теми, что уже есть у вас: они считаются загруженными раньше и повторно не добавятся (так бывает после переноса данных в аккаунт). Если это разные операции, в списке «Уже есть» нажмите «Добавить всё равно».`,
    );
  }
  if (overflow.size > 0) notes.push('По некоторым кошелькам сумма операций слишком велика, остаток по файлу посчитать нельзя.');

  review.sort((a, b) => a.line - b.line);
  return {
    baseCurrency,
    wallets: planWallets,
    categories: categoriesList,
    ops,
    counts,
    rates: [...needs.values()].filter((n) => n.rows > 0),
    review,
    skipped: parsed.skipped,
    period: periodOf(ops),
    notes,
  };
}
