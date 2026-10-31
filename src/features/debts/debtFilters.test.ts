import { describe, expect, it } from 'vitest';
import { emptyFilters } from '@/components/filters/filterState';
import { NO_DEBT_CATEGORY } from '@/domain/debtCategory';
import { computeDebtState } from '@/domain/debts';
import type { Debt, LocalRow } from '@/domain/types';
import {
  applyDebtFilters,
  debtCategoriesOf,
  debtFilterFields,
  debtMatches,
  DUE_SOON_DAYS,
  FILTER_CATEGORY,
  FILTER_CURRENCY,
  FILTER_DUE,
  FILTER_INTEREST,
  FILTER_PERSON,
} from './debtFilters';
import { foldGroups, groupDebts, remainingByCurrency, type DebtItem } from './debtSummary';

const TODAY = '2026-10-15';
let n = 0;
const wallets = new Map([
  ['w', { currency: 'TJS' }],
  ['wu', { currency: 'USD' }],
]);

/** Долг для проверок; платежи — суммы возврата. */
function item(over: Partial<Debt> = {}, payments: number[] = []): DebtItem {
  const id = over.id ?? `debt-${++n}`;
  const debt = {
    id,
    direction: 'lent',
    counterparty: 'Али',
    principalMinor: 50_000,
    interestMinor: null,
    interestRateBp: null,
    termMonths: null,
    mergedIntoId: null,
    category: '',
    currency: 'TJS',
    openedOn: '2026-10-01',
    dueOn: null,
    note: '',
    closedAt: null,
    archivedAt: null,
    deletedAt: null,
    ...over,
  } as LocalRow<Debt>;
  const txs = payments.map((amountMinor, i) => ({
    id: `${id}-p${i}`,
    kind: 'income' as const,
    walletId: over.currency === 'USD' ? 'wu' : 'w',
    amountMinor,
    occurredOn: '2026-10-05',
    createdAt: `2026-10-05T10:00:00.${String(i).padStart(3, '0')}Z`,
    deletedAt: null,
    debtId: id,
  }));
  return { debt, state: computeDebtState(debt, txs, wallets) };
}

const values = (over: Record<string, string>) => ({ ...over });
const ids = (r: { items: DebtItem[] }) => r.items.map((it) => it.debt.id);

describe('debtMatches: категория', () => {
  it('«любая» пропускает всё; название сравнивается без регистра; «Без категории» — только пустые', () => {
    const friends = item({ category: 'Друзья' });
    const none = item({ category: '' });
    expect(debtMatches(friends, values({ [FILTER_CATEGORY]: '' }), TODAY)).toBe(true);
    expect(debtMatches(friends, values({ [FILTER_CATEGORY]: 'друзья' }), TODAY)).toBe(true);
    expect(debtMatches(friends, values({ [FILTER_CATEGORY]: 'Семья' }), TODAY)).toBe(false);
    expect(debtMatches(none, values({ [FILTER_CATEGORY]: NO_DEBT_CATEGORY }), TODAY)).toBe(true);
    expect(debtMatches(friends, values({ [FILTER_CATEGORY]: NO_DEBT_CATEGORY }), TODAY)).toBe(false);
  });
  it('долг из старых данных без поля category — «без категории», а не ошибка', () => {
    const old = item();
    delete (old.debt as { category?: string }).category;
    expect(debtMatches(old, values({ [FILTER_CATEGORY]: NO_DEBT_CATEGORY }), TODAY)).toBe(true);
    expect(debtMatches(old, values({ [FILTER_CATEGORY]: 'Друзья' }), TODAY)).toBe(false);
  });
});

describe('debtMatches: человек, валюта, проценты', () => {
  it('человек: ключ без регистра, пробелов и «ё»', () => {
    const a = item({ counterparty: ' Алёша  ' });
    expect(debtMatches(a, values({ [FILTER_PERSON]: 'алеша' }), TODAY)).toBe(true);
    expect(debtMatches(a, values({ [FILTER_PERSON]: 'борис' }), TODAY)).toBe(false);
  });
  it('валюта', () => {
    expect(debtMatches(item({ currency: 'USD' }), values({ [FILTER_CURRENCY]: 'USD' }), TODAY)).toBe(true);
    expect(debtMatches(item({ currency: 'TJS' }), values({ [FILTER_CURRENCY]: 'USD' }), TODAY)).toBe(false);
  });
  it('проценты: «с» — сумма процентов больше нуля, «без» — всё остальное', () => {
    const credit = item({ interestMinor: 5_000, interestRateBp: 2400, termMonths: 12 });
    const plain = item();
    expect(debtMatches(credit, values({ [FILTER_INTEREST]: 'with' }), TODAY)).toBe(true);
    expect(debtMatches(plain, values({ [FILTER_INTEREST]: 'with' }), TODAY)).toBe(false);
    expect(debtMatches(plain, values({ [FILTER_INTEREST]: 'without' }), TODAY)).toBe(true);
    expect(debtMatches(credit, values({ [FILTER_INTEREST]: 'without' }), TODAY)).toBe(false);
  });
});

describe('debtMatches: срок', () => {
  const due = (dueOn: string | null, over: Partial<Debt> = {}) => item({ dueOn, ...over });
  it('просроченные: срок раньше сегодняшнего и остаток ещё есть; сегодня — не просрочен', () => {
    expect(debtMatches(due('2026-10-14'), values({ [FILTER_DUE]: 'overdue' }), TODAY)).toBe(true);
    expect(debtMatches(due('2026-10-15'), values({ [FILTER_DUE]: 'overdue' }), TODAY)).toBe(false);
    expect(debtMatches(due('2026-10-20'), values({ [FILTER_DUE]: 'overdue' }), TODAY)).toBe(false);
  });
  it('просрочка бывает только у того, по чему ещё что-то осталось: закрытый и погашенный не просрочены', () => {
    expect(debtMatches(due('2026-10-01', { closedAt: '2026-10-10T00:00:00.000Z' }), values({ [FILTER_DUE]: 'overdue' }), TODAY)).toBe(false);
    const paid = item({ dueOn: '2026-10-01' }, [50_000]);
    expect(debtMatches(paid, values({ [FILTER_DUE]: 'overdue' }), TODAY)).toBe(false);
  });
  it(`скоро: сегодня и ближайшие ${DUE_SOON_DAYS} дней; позже и раньше — нет`, () => {
    const soon = values({ [FILTER_DUE]: 'soon' });
    expect(debtMatches(due('2026-10-15'), soon, TODAY)).toBe(true);
    expect(debtMatches(due('2026-10-22'), soon, TODAY)).toBe(true);
    expect(debtMatches(due('2026-10-23'), soon, TODAY)).toBe(false);
    expect(debtMatches(due('2026-10-14'), soon, TODAY)).toBe(false);
  });
  it('без срока', () => {
    expect(debtMatches(due(null), values({ [FILTER_DUE]: 'none' }), TODAY)).toBe(true);
    expect(debtMatches(due('2026-10-20'), values({ [FILTER_DUE]: 'none' }), TODAY)).toBe(false);
  });
  it('несколько фильтров сразу — совпасть должны все', () => {
    const d = due('2026-10-14', { category: 'Кредит', counterparty: 'Банк' });
    expect(debtMatches(d, values({ [FILTER_DUE]: 'overdue', [FILTER_CATEGORY]: 'Кредит' }), TODAY)).toBe(true);
    expect(debtMatches(d, values({ [FILTER_DUE]: 'overdue', [FILTER_CATEGORY]: 'Друзья' }), TODAY)).toBe(false);
  });
});

describe('applyDebtFilters', () => {
  const a = item({ id: 'a', category: 'Друзья', counterparty: 'Али' });
  const b = item({ id: 'b', category: 'Кредит', counterparty: 'Банк', interestMinor: 5_000 });
  const c = item({ id: 'c', category: '', counterparty: 'Вали' });

  it('пустые значения: ничего не отсеивается, порядок прежний', () => {
    const r = applyDebtFilters([a, b, c], emptyFilters(debtFilterFields([a, b, c])), TODAY);
    expect(ids(r)).toEqual(['a', 'b', 'c']);
    expect(r.partialGroups).toBe(0);
  });
  it('фильтр по категории и «Без категории»', () => {
    expect(ids(applyDebtFilters([a, b, c], { [FILTER_CATEGORY]: 'Кредит' }, TODAY))).toEqual(['b']);
    expect(ids(applyDebtFilters([a, b, c], { [FILTER_CATEGORY]: NO_DEBT_CATEGORY }, TODAY))).toEqual(['c']);
  });
  it('итог «Вам должны всего» по отфильтрованному набору, а не по всем', () => {
    const r = applyDebtFilters([a, b, c], { [FILTER_CATEGORY]: 'Друзья' }, TODAY);
    const totals = remainingByCurrency(groupDebts(r.items, 'lent').active, 'TJS');
    expect(totals).toEqual({ ok: true, totals: [{ currency: 'TJS', minor: 50_000 }] });
    const all = remainingByCurrency(groupDebts([a, b, c], 'lent').active, 'TJS');
    expect(all).toEqual({ ok: true, totals: [{ currency: 'TJS', minor: 155_000 }] });
  });
  it('ничего не подошло — пусто', () => {
    expect(applyDebtFilters([a, b, c], { [FILTER_CATEGORY]: 'Семья' }, TODAY).items).toEqual([]);
  });
});

describe('объединённые долги под фильтром', () => {
  // главный — «Друзья», часть — «Кредит» с процентами; в списке они один элемент с итогом по обоим
  const main = () => item({ id: 'main', category: 'Друзья', principalMinor: 40_000, dueOn: '2026-11-20' }, [10_000]);
  const part = () => item({ id: 'part', mergedIntoId: 'main', category: 'Кредит', principalMinor: 30_000, interestMinor: 3_000, dueOn: '2026-10-10' });
  const folded = () => foldGroups([main(), part()]);

  it('сам элемент — один, а категории показываются по частям без повторов', () => {
    const [g] = folded();
    expect(folded()).toHaveLength(1);
    expect(debtCategoriesOf(g!)).toEqual(['Друзья', 'Кредит']);
  });
  it('подходит, если подошла хотя бы одна часть; показывается целиком, итог — по всем частям', () => {
    const r = applyDebtFilters(folded(), { [FILTER_CATEGORY]: 'Кредит' }, TODAY);
    expect(ids(r)).toEqual(['main']);
    expect(r.partialGroups).toBe(1);
    // итог объединения не урезан до одной части: 40 000 − 10 000 + 30 000 + 3 000 = 63 000
    expect(r.items[0]!.state!.remainingMinor).toBe(63_000);
  });
  it('все части подошли — «частично» не считается', () => {
    const r = applyDebtFilters(folded(), { [FILTER_CURRENCY]: 'TJS' }, TODAY);
    expect(ids(r)).toEqual(['main']);
    expect(r.partialGroups).toBe(0);
  });
  it('условия одной части не склеиваются из разных: «Друзья» + «просроченные» — такой части нет (у «Друзей» срок впереди)', () => {
    const r = applyDebtFilters(folded(), { [FILTER_CATEGORY]: 'Друзья', [FILTER_DUE]: 'overdue' }, TODAY);
    expect(r.items).toEqual([]);
    // а «Кредит» + «просроченные» — часть есть (срок 10.10 прошёл)
    expect(ids(applyDebtFilters(folded(), { [FILTER_CATEGORY]: 'Кредит', [FILTER_DUE]: 'overdue' }, TODAY))).toEqual(['main']);
  });
  it('проценты: у группы они есть, если есть у части', () => {
    expect(ids(applyDebtFilters(folded(), { [FILTER_INTEREST]: 'with' }, TODAY))).toEqual(['main']);
  });
});

describe('debtFilterFields: поле есть, только если есть из чего выбирать', () => {
  const keys = (items: DebtItem[], base?: string) => debtFilterFields(items, base).map((f) => f.key);

  it('без категорий, с одним человеком и одной валютой — только «Срок возврата»', () => {
    expect(keys([item(), item()])).toEqual([FILTER_DUE]);
  });
  it('все поля, когда есть из чего выбирать, в порядке: категория, человек, срок, проценты, валюта', () => {
    const items = [item({ category: 'Друзья', counterparty: 'Али' }), item({ counterparty: 'Бобо', interestMinor: 1_000, currency: 'USD' })];
    expect(keys(items)).toEqual([FILTER_CATEGORY, FILTER_PERSON, FILTER_DUE, FILTER_INTEREST, FILTER_CURRENCY]);
  });
  it('категории: «Без категории» только если такие долги есть; использованные — по частоте', () => {
    const allTagged = debtFilterFields([item({ category: 'Друзья' }), item({ category: 'Семья' }), item({ category: 'семья' })]).find((f) => f.key === FILTER_CATEGORY)!;
    expect(allTagged.options.map((o) => o.label)).toEqual(['Семья', 'Друзья']);
    const mixed = debtFilterFields([item({ category: 'Друзья' }), item({ category: '' })]).find((f) => f.key === FILTER_CATEGORY)!;
    expect(mixed.options.map((o) => o.label)).toEqual(['Без категории', 'Друзья']);
  });
  it('категории частей объединения тоже попадают в список', () => {
    const g = foldGroups([item({ id: 'm', category: 'Друзья' }), item({ id: 'p', mergedIntoId: 'm', category: 'Кредит' })]);
    const f = debtFilterFields(g).find((x) => x.key === FILTER_CATEGORY)!;
    expect(f.options.map((o) => o.label).sort()).toEqual(['Друзья', 'Кредит']);
  });
  it('люди: одно имя в разном написании — один человек; список по алфавиту', () => {
    const f = debtFilterFields([item({ counterparty: 'Бобо' }), item({ counterparty: 'алёша' }), item({ counterparty: 'Алеша' })]).find((x) => x.key === FILTER_PERSON)!;
    expect(f.options.map((o) => o.label)).toEqual(['алёша', 'Бобо']);
  });
  it('валюты: основная первой', () => {
    const f = debtFilterFields([item({ currency: 'TJS' }), item({ currency: 'USD' })], 'USD').find((x) => x.key === FILTER_CURRENCY)!;
    expect(f.options.map((o) => o.value)).toEqual(['USD', 'TJS']);
  });
});
