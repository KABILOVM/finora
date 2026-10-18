import { DebtPlanStoppedError, FxRequiredError, stoppedDebtPlans, uuidV5, ValidationError, type Store } from '@/db';
import { paymentKind } from '@/domain/debts';
import type { CurrencyCode, IsoDate, LocalRow, RecurringRule } from '@/domain/types';
import type { RateLookup } from '@/rates/types';
import type { AutoPostFailure } from './autoPostState';
import { needsFx, pairText, pickAutoRate } from './fx';
import { AUTO_POST_MAX_PER_PASS, collectCandidates, debtPlanFloor, isAutoPostRule, type LocalDateOf } from './plan';

/**
 * Один проход автопроведения: находит платежи «Проводить само», которым пора, и записывает их через createFromRule.
 * Не знает про React: хранилище, сегодняшняя дата и курсы приходят параметрами (так его проверяют тестами).
 *
 * Гарантии:
 *  - идемпотентно: id операции = v5(правило, дата); есть живая или «пропущенная» — не трогаем; две вкладки не задвоят;
 *  - ошибка одного правила (кошелёк в архиве, категория удалена, долг удалён…) не останавливает остальные и данные правила
 *    не меняет: причина попадает в failures;
 *  - небазовая валюта: только свежий курс или «Свой курс» (см. pickAutoRate); нет курса — платёж не проводится и остаётся
 *    в «Просроченных»/«Сегодня», пара валют попадает в missingRates;
 *  - план по долгу, который погашен, закрыт, в архиве или удалён, стоит (debtPlanStop) и в проход не попадает; даты, прошедшие,
 *    пока он стоял, само не проводится (debtPlanFloor); последний платёж записывается не больше остатка долга (fitToDebt);
 *  - перед КАЖДОЙ записью проверяется isCurrent(): вышел из аккаунта / сменился — не пишем ничего;
 *  - не больше `limit` записей за проход (остальное — на следующем проходе, capped: true).
 */

export interface RunAutoPostOptions {
  store: Store;
  /** Сегодняшняя дата по местным часам устройства. */
  today: IsoDate;
  /** Курс валюты кошелька к базовой (useRates().getRate). */
  getRate: (from: CurrencyCode, to: CurrencyCode) => RateLookup | null;
  /** false — работа отменена (хранилище закрыто, другой аккаунт): ничего больше не пишем. */
  isCurrent?: () => boolean;
  limit?: number;
  /** Подмена перевода метки создания в местную дату (для тестов). */
  toLocal?: LocalDateOf;
}

export interface MissingRate {
  from: CurrencyCode;
  to: CurrencyCode;
  reason: 'missing' | 'stale';
}

export interface AutoPostResult {
  /** Сколько новых операций записано этим проходом. */
  posted: number;
  /** id правила → почему оно не провелось само. */
  failures: Map<string, AutoPostFailure>;
  /** Правила, которые участвуют в автопроведении. */
  eligible: Set<string>;
  /** Из них разобранные до конца (при обрыве по лимиту или отмене часть правил ждёт следующего прохода). */
  examined: Set<string>;
  /** Пары валют, для которых курса нет или он устарел (одна запись на пару). */
  missingRates: MissingRate[];
  /** Дошли до лимита записей: остались непроведённые даты. */
  capped: boolean;
  /** Остановились, потому что хранилище перестало быть текущим. */
  aborted: boolean;
}

function emptyResult(): AutoPostResult {
  return {
    posted: 0,
    failures: new Map(),
    eligible: new Set(),
    examined: new Set(),
    missingRates: [],
    capped: false,
    aborted: false,
  };
}

const GENERIC_FAILURE = 'ошибка записи, данные не изменены';

export async function runAutoPost(opts: RunAutoPostOptions): Promise<AutoPostResult> {
  const { store, today, getRate } = opts;
  const limit = opts.limit ?? AUTO_POST_MAX_PER_PASS;
  const isCurrent = opts.isCurrent ?? (() => true);
  const result = emptyResult();
  if (!isCurrent()) {
    result.aborted = true;
    return result;
  }

  const settings = await store.settings.get();
  if (!settings) return result; // до первой загрузки базовой валюты нет — проводить нечего
  const base = settings.baseCurrency;

  const live = (await store.db.recurring_rules.toArray()).filter(isAutoPostRule);
  const planStopped = await stoppedDebtPlans(store.db, live);
  const rules = live.filter((r) => !planStopped.has(r.id));
  for (const r of rules) result.eligible.add(r.id);
  const floor = new Map<string, IsoDate>(); // платёж по долгу: не раньше последней правки долга
  for (const r of rules) {
    if (r.debtId === null) continue;
    const debt = await store.db.debts.get(r.debtId);
    if (debt && r.kind === paymentKind(debt.direction)) floor.set(r.id, debtPlanFloor(debt, today, opts.toLocal));
  }
  const candidates = collectCandidates(rules, today, opts.toLocal).filter((c) => {
    const from = floor.get(c.rule.id);
    return from === undefined || c.date >= from;
  });

  // Что из этого уже есть в базе (проведено или пропущено): определяем по детерминированному id.
  const have = new Set<string>();
  for (const id of new Set(candidates.map((c) => c.rule.id))) {
    for (const key of await store.db.transactions.where('recurringRuleId').equals(id).primaryKeys()) have.add(key);
  }
  interface Todo {
    rule: LocalRow<RecurringRule>;
    date: IsoDate;
    id: string;
  }
  const todo: Todo[] = [];
  const left = new Map<string, number>();
  for (const c of candidates) {
    const id = await uuidV5(c.rule.id.toLowerCase(), c.date);
    if (have.has(id)) continue;
    todo.push({ rule: c.rule, date: c.date, id });
    left.set(c.rule.id, (left.get(c.rule.id) ?? 0) + 1);
  }

  const wallets = new Map((await store.db.wallets.toArray()).map((w) => [w.id, w]));
  const stopped = new Set<string>(); // правила, у которых остальные даты пропускаем: ошибка или нет курса
  const missing = new Map<string, MissingRate>();
  const done = (ruleId: string) => left.set(ruleId, (left.get(ruleId) ?? 1) - 1);

  const noRate = (ruleId: string, from: CurrencyCode, to: CurrencyCode, reason: 'missing' | 'stale') => {
    const key = pairText(from, to);
    const prev = missing.get(key);
    if (!prev || (prev.reason === 'stale' && reason === 'missing')) missing.set(key, { from, to, reason });
    result.failures.set(ruleId, {
      kind: 'no-rate',
      message: reason === 'stale' ? `курс ${key} устарел` : `нет курса ${key}`,
    });
    stopped.add(ruleId);
  };

  let attempts = 0;
  for (const item of todo) {
    const { rule } = item;
    if (stopped.has(rule.id)) {
      done(rule.id);
      continue;
    }
    if (!isCurrent()) {
      result.aborted = true;
      break;
    }
    if (attempts >= limit) {
      result.capped = true;
      break;
    }

    const wallet = wallets.get(rule.walletId);
    const toWallet = rule.toWalletId === null ? null : (wallets.get(rule.toWalletId) ?? null);
    let fx: { rate: number; source: string } | undefined;
    if (wallet && needsFx(rule, wallet, toWallet, base)) {
      const pick = pickAutoRate(getRate(wallet.currency, base));
      if (!pick.ok) {
        noRate(rule.id, wallet.currency, base, pick.reason);
        done(rule.id);
        continue;
      }
      fx = pick.fx;
    }

    try {
      // Другая вкладка или устройство могло провести эту дату, пока шёл проход: не считаем чужую работу своей.
      if (await store.db.transactions.get(item.id)) {
        done(rule.id);
        continue;
      }
      attempts++;
      const row = await store.transactions.createFromRule(rule.id, item.date, { fitToDebt: true, ...(fx ? { fx } : {}) });
      if (row.deletedAt === null) result.posted++; // удалённая = пропущена на другом устройстве; не считаем проведённой
    } catch (e) {
      if (!isCurrent()) {
        result.aborted = true;
        break;
      }
      if (e instanceof FxRequiredError) {
        noRate(rule.id, e.walletCurrency, e.baseCurrency, 'missing');
      } else if (e instanceof DebtPlanStoppedError) {
        // долг погасили (или закрыли) по ходу прохода — например, предыдущей датой этого же плана: план стоит, это не ошибка
        stopped.add(rule.id);
      } else if (e instanceof ValidationError) {
        result.failures.set(rule.id, { kind: 'error', message: e.message });
        stopped.add(rule.id);
      } else {
        console.error('Автопроведение: не удалось записать платёж:', e);
        result.failures.set(rule.id, { kind: 'error', message: GENERIC_FAILURE });
        stopped.add(rule.id);
      }
    }
    done(rule.id);
  }

  for (const id of result.eligible) if ((left.get(id) ?? 0) <= 0) result.examined.add(id);
  result.missingRates = [...missing.values()];
  return result;
}
