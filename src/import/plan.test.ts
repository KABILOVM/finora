import { describe, expect, it } from 'vitest';
import { fixtureText } from './__fixtures__/load';
import { computeIds, categoryKey, type PlanIds } from './ids';
import { parseZenmoney } from './parse';
import { buildPlan, isUsableRate, type PlanInput } from './plan';
import type { CategoryLite, ParsedFile, WalletLite } from './types';

const USER = 'user-1';
const HEAD =
  'date,categoryName,payee,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle';

const wallet = (over: Partial<WalletLite> & { id: string; name: string }): WalletLite => ({
  currency: 'TJS',
  archivedAt: null,
  deletedAt: null,
  ...over,
});
const category = (over: Partial<CategoryLite> & { id: string; name: string }): CategoryLite => ({
  kind: 'expense',
  parentId: null,
  archivedAt: null,
  deletedAt: null,
  ...over,
});

async function setup(text: string, over: Partial<Omit<PlanInput, 'parsed' | 'ids'>> = {}) {
  const parsed = parseZenmoney(text);
  const ids = await computeIds(USER, parsed);
  const input: PlanInput = { parsed, ids, baseCurrency: 'TJS', wallets: [], categories: [], existing: new Map(), ...over };
  return { parsed, ids, input, plan: buildPlan(input) };
}
const csv = (...rows: string[]) => [HEAD, ...rows].join('\n') + '\n';

describe('идентификаторы', () => {
  it('одинаковый файл и пользователь — одинаковые id; другой пользователь — другие', async () => {
    const text = fixtureText('basic.csv');
    const a = await computeIds(USER, parseZenmoney(text));
    const b = await computeIds(USER, parseZenmoney(text));
    const c = await computeIds('user-2', parseZenmoney(text));
    expect(b.tx).toEqual(a.tx);
    expect([...b.wallets]).toEqual([...a.wallets]);
    expect(c.tx[0]).not.toBe(a.tx[0]);
    expect(new Set(a.tx).size).toBe(a.tx.length);
    for (const id of a.tx) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('id не зависят от формата записи суммы и даты и от порядка столбцов-«мусора» (createdDate и т. п.)', async () => {
    const a = await computeIds(USER, parseZenmoney(csv('2025-01-10,Еда,,,Карта,1234.50,TJS,,0,')));
    const b = await computeIds(USER, parseZenmoney(csv('10.01.2025 23:59,Еда,,,Карта,"1 234,5",TJS,,0,')));
    expect(a.tx).toEqual(b.tx);
  });

  it('две одинаковые строки получают разные id, но стабильно', async () => {
    const text = csv('2025-01-10,Еда,,кофе,Карта,5,TJS,,0,', '2025-01-10,Еда,,кофе,Карта,5,TJS,,0,', '2025-01-10,Еда,,кофе,Карта,5,TJS,,0,');
    const a = await computeIds(USER, parseZenmoney(text));
    const b = await computeIds(USER, parseZenmoney(text));
    expect(new Set(a.tx).size).toBe(3);
    expect(b.tx).toEqual(a.tx);
  });

  it('id кошелька и категории зависят от названия и валюты/вида', async () => {
    const a = await computeIds(USER, parseZenmoney(csv('2025-01-10,Еда,,,Карта,5,TJS,,0,', '2025-01-10,Еда,,,Карта,5,USD,,0,')));
    expect(a.wallets.size).toBe(2);
    expect(new Set(a.wallets.values()).size).toBe(2);
    const b = await computeIds(USER, parseZenmoney(csv('2025-01-10,Зарплата,,,,0,,Карта,5,TJS', '2025-01-10,Зарплата,,,Карта,5,TJS,,0,')));
    expect(b.categories.size).toBe(2); // «Зарплата» как доход и как расход — разные категории
  });
});

describe('buildPlan: счёта → кошельки', () => {
  const text = fixtureText('basic.csv');

  it('нет кошельков: каждый счёт — «создать», начальный остаток 0, id детерминирован', async () => {
    const { plan, ids } = await setup(text);
    expect(plan.wallets.map((w) => [w.name, w.currency, w.target.kind])).toEqual([
      ['Карта Алиф', 'TJS', 'create'],
      ['Наличные', 'TJS', 'create'],
      ['Доллары', 'USD', 'create'],
    ]);
    const t = plan.wallets[0]!.target;
    expect(t.kind === 'create' && t.id).toBe(ids.wallets.get(plan.wallets[0]!.key));
  });

  it('совпадение по названию И валюте: «Наличные» (TJS) находится, регистр и пробелы не важны', async () => {
    const { plan } = await setup(text, { wallets: [wallet({ id: 'w-cash', name: ' наличные ' })] });
    const cash = plan.wallets.find((w) => w.name === 'Наличные')!;
    expect(cash.target).toEqual({ kind: 'existing', id: 'w-cash', name: ' наличные ', how: 'name' });
  });

  it('то же название, но другая валюта — не совпадение', async () => {
    const { plan } = await setup(text, { wallets: [wallet({ id: 'w-usd', name: 'Наличные', currency: 'USD' })] });
    expect(plan.wallets.find((w) => w.name === 'Наличные')!.target.kind).toBe('create');
    expect(plan.wallets.find((w) => w.name === 'Наличные')!.candidates).toEqual([]);
  });

  it('удалённые и архивные кошельки для совпадения не берутся', async () => {
    const { plan } = await setup(text, {
      wallets: [wallet({ id: 'a', name: 'Наличные', deletedAt: '2025-01-01T00:00:00.000Z' }), wallet({ id: 'b', name: 'Наличные', archivedAt: '2025-01-01T00:00:00.000Z' })],
    });
    expect(plan.wallets.find((w) => w.name === 'Наличные')!.target.kind).toBe('create');
  });

  it('ручной выбор существующего кошелька той же валюты', async () => {
    const wallets = [wallet({ id: 'w1', name: 'Моя карта' }), wallet({ id: 'w2', name: 'Доллары', currency: 'USD' })];
    const { input, plan } = await setup(text, { wallets });
    const key = plan.wallets[0]!.key;
    const chosen = buildPlan({ ...input, walletChoices: { [key]: 'w1' } });
    expect(chosen.wallets[0]!.target).toEqual({ kind: 'existing', id: 'w1', name: 'Моя карта', how: 'chosen' });
    expect(chosen.wallets[0]!.chosen).toBe(true);
    // кошелёк другой валюты выбрать нельзя: выбор игнорируется
    const wrong = buildPlan({ ...input, walletChoices: { [key]: 'w2' } });
    expect(wrong.wallets[0]!.target.kind).toBe('create');
    expect(wrong.wallets[0]!.candidates.map((c) => c.id)).toEqual(['w1']);
  });

  it('«создать новый» поверх автоподбора', async () => {
    const wallets = [wallet({ id: 'w-cash', name: 'Наличные' })];
    const { input } = await setup(text, { wallets });
    const key = buildPlan(input).wallets.find((w) => w.name === 'Наличные')!.key;
    const plan = buildPlan({ ...input, walletChoices: { [key]: 'new' } });
    expect(plan.wallets.find((w) => w.name === 'Наличные')!.target.kind).toBe('create');
  });

  it('кошелёк прошлого импорта находится по id, даже если его переименовали', async () => {
    const { input, ids } = await setup(text);
    const key = [...ids.wallets.keys()][0]!;
    const plan = buildPlan({ ...input, wallets: [wallet({ id: ids.wallets.get(key)!, name: 'Совсем другое имя' })] });
    expect(plan.wallets[0]!.target).toMatchObject({ kind: 'existing', id: ids.wallets.get(key), how: 'saved' });
  });

  it('кошелёк прошлого импорта удалён или в архиве — счёт блокируется, операции не пишутся молча в другое место', async () => {
    const { input, ids } = await setup(text);
    const key = [...ids.wallets.keys()][0]!;
    const id = ids.wallets.get(key)!;
    for (const state of [{ deletedAt: '2025-01-01T00:00:00.000Z' }, { archivedAt: '2025-01-01T00:00:00.000Z' }]) {
      const plan = buildPlan({ ...input, wallets: [wallet({ id, name: 'Карта Алиф', ...state })] });
      expect(plan.wallets[0]!.target.kind).toBe('blocked');
      expect(plan.counts.blocked).toBeGreaterThan(0);
      expect(plan.ops.filter((o) => o.status === 'blocked').length).toBe(plan.counts.blocked);
      // человек выбирает другой кошелёк — блокировка снимается
      const fixed = buildPlan({
        ...input,
        wallets: [wallet({ id, name: 'Карта Алиф', ...state }), wallet({ id: 'other', name: 'Другой' })],
        walletChoices: { [key]: 'other' },
      });
      expect(fixed.wallets[0]!.target).toMatchObject({ kind: 'existing', id: 'other' });
      expect(fixed.counts.blocked).toBe(0);
    }
  });
});

describe('buildPlan: счётчики и статусы (basic.csv)', () => {
  const text = fixtureText('basic.csv');

  it('без курса доллара: операции в USD ждут курса, обмен валют и всё в сомони — к добавлению', async () => {
    const { plan } = await setup(text);
    expect(plan.counts).toMatchObject({ add: 8, exists: 0, review: 4, skipped: 2, waitRate: 2, blocked: 0 });
    expect(plan.rates).toEqual([{ currency: 'USD', rows: 2, rate: null }]);
    expect(plan.ops.filter((o) => o.status === 'wait-rate').map((o) => o.row.line)).toEqual([9, 10]);
  });

  it('с курсом: всё добавляется, курс идёт в снимок как manual', async () => {
    const { plan } = await setup(text, { rates: { USD: 10.9 } });
    expect(plan.counts).toMatchObject({ add: 10, waitRate: 0 });
    expect(plan.rates).toEqual([{ currency: 'USD', rows: 2, rate: 10.9 }]);
    const usd = plan.ops.find((o) => o.row.line === 9)!;
    expect(usd.input).toMatchObject({ kind: 'expense', amountMinor: 4000, fx: { rate: 10.9, source: 'manual' } });
    const tjs = plan.ops.find((o) => o.row.line === 3)!;
    expect(tjs.input!.fx).toBeUndefined(); // в базовой валюте курс не нужен
  });

  it('обмен валют и перевод без комиссии курса не требуют', async () => {
    const { plan } = await setup(text);
    const exchange = plan.ops.find((o) => o.row.line === 8)!;
    expect(exchange.status).toBe('add');
    expect(exchange.input).toMatchObject({ kind: 'transfer', amountMinor: 109000, toAmountMinor: 10000 });
    expect(exchange.input!.fx).toBeUndefined();
  });

  it('перевод с комиссией: toAmount меньше суммы списания (разницу репозиторий запишет как комиссию)', async () => {
    const { plan } = await setup(text);
    const fee = plan.ops.find((o) => o.row.line === 7)!;
    expect(fee.input).toMatchObject({ kind: 'transfer', amountMinor: 50000, toAmountMinor: 49500, categoryId: null });
  });

  it('иерархия: «Еда» найдена среди своих (если есть), «Кафе» создаётся внутри неё', async () => {
    const categories = [category({ id: 'c-food', name: 'Еда' }), category({ id: 'c-sal', name: 'Зарплата', kind: 'income' })];
    const { plan, ids } = await setup(text, { categories });
    const cafe = plan.categories.find((c) => c.name === 'Кафе')!;
    expect(cafe).toMatchObject({ path: ['Еда', 'Кафе'], catKind: 'expense', usedBy: 2, needed: true });
    expect(cafe.target).toEqual({ kind: 'create', id: ids.categories.get(cafe.key) });
    const food = plan.categories.find((c) => c.name === 'Еда')!;
    expect(food.target).toEqual({ kind: 'existing', id: 'c-food', how: 'name' });
    expect(plan.categories.find((c) => c.name === 'Зарплата')!.target).toEqual({ kind: 'existing', id: 'c-sal', how: 'name' });
    // родитель идёт раньше ребёнка
    expect(plan.categories.findIndex((c) => c.name === 'Еда')).toBeLessThan(plan.categories.findIndex((c) => c.name === 'Кафе'));
  });

  it('категория совпадает по названию И виду: расходная «Зарплата» доход не подхватывает', async () => {
    const { plan } = await setup(text, { categories: [category({ id: 'c', name: 'Зарплата', kind: 'expense' })] });
    expect(plan.categories.find((c) => c.name === 'Зарплата')!.target.kind).toBe('create');
  });

  it('удалённые и архивные категории не берутся; подкатегория ищется только внутри своего родителя', async () => {
    const categories = [
      category({ id: 'c-food', name: 'Еда' }),
      category({ id: 'c-cafe-old', name: 'Кафе', archivedAt: '2025-01-01T00:00:00.000Z', parentId: 'c-food' }),
      category({ id: 'c-cafe-top', name: 'Кафе' }),
    ];
    const { plan } = await setup(text, { categories });
    expect(plan.categories.find((c) => c.name === 'Кафе')!.target.kind).toBe('create');
  });

  it('если родитель создаётся, ребёнок тоже создаётся (не ищется среди чужих)', async () => {
    const { plan } = await setup(text, { categories: [category({ id: 'c-cafe', name: 'Кафе' })] });
    expect(plan.categories.find((c) => c.name === 'Еда')!.target.kind).toBe('create');
    expect(plan.categories.find((c) => c.name === 'Кафе')!.target.kind).toBe('create');
  });

  it('удалённая категория прошлого импорта: операции придут без категории и об этом сказано', async () => {
    const { input, ids } = await setup(text);
    const key = categoryKey('expense', ['Покупки']);
    const plan = buildPlan({ ...input, rates: { USD: 10.9 }, categories: [category({ id: ids.categories.get(key)!, name: 'Покупки', deletedAt: '2025-01-01T00:00:00.000Z' })] });
    const op = plan.ops.find((o) => o.row.line === 9)!;
    expect(op.status).toBe('add');
    expect(op.input!.categoryId).toBeNull();
    expect(plan.notes.join('\n')).toMatch(/Покупки.*удалена.*1 операция придёт без категории/);
  });

  it('категория есть только у строк, которые уже импортированы: создавать её не нужно', async () => {
    const { input, ids } = await setup(text);
    const existing = new Map(ids.tx.map((id) => [id, false] as const));
    const plan = buildPlan({ ...input, existing });
    expect(plan.counts).toMatchObject({ add: 0, exists: 10, waitRate: 0 });
    expect(plan.categories.every((c) => !c.needed)).toBe(true);
    expect(plan.wallets.every((w) => w.addCount === 0)).toBe(true);
    expect(plan.rates).toEqual([]);
  });

  it('период и пометки', async () => {
    const { plan } = await setup(text, { rates: { USD: 10.9 } });
    expect(plan.period).toEqual({ from: '2024-02-29', to: '2026-09-09' });
    expect(plan.review.map((r) => r.line)).toEqual([14, 15, 16, 17]);
    expect(plan.skipped.map((s) => s.line)).toEqual([12, 13]);
  });
});

describe('buildPlan: «уже есть» (идемпотентность)', () => {
  const text = fixtureText('basic.csv');

  it('операции с существующими id не добавляются — в том числе удалённые, которые не воскрешаются', async () => {
    const { input, ids } = await setup(text);
    const existing = new Map<string, boolean>([
      [ids.tx[0]!, false],
      [ids.tx[1]!, true],
    ]);
    const plan = buildPlan({ ...input, existing, rates: { USD: 10.9 } });
    expect(plan.counts).toMatchObject({ add: 8, exists: 2, existsDeleted: 1 });
    expect(plan.ops[0]).toMatchObject({ status: 'exists', existsDeleted: false });
    expect(plan.ops[1]).toMatchObject({ status: 'exists', existsDeleted: true });
  });

  it('«уже есть» важнее блокировки и ожидания курса', async () => {
    const { input, ids } = await setup(text);
    const existing = new Map(ids.tx.map((id) => [id, false] as const));
    const plan = buildPlan({ ...input, existing }); // курса нет — но все уже есть
    expect(plan.counts.waitRate).toBe(0);
    expect(plan.counts.exists).toBe(10);
  });
});

describe('buildPlan: проверки перед записью', () => {
  it('перевод в одной валюте: зачислено больше, чем списано, — «нужно проверить»', async () => {
    const { plan } = await setup(csv('2025-01-10,,,,Карта,100,TJS,Наличные,120,TJS'));
    expect(plan.counts.add).toBe(0);
    expect(plan.review[0]).toMatchObject({ code: 'creates-money', line: 2 });
  });

  it('два счёта, сопоставленных вручную с одним кошельком: перевод между ними невозможен', async () => {
    const wallets = [wallet({ id: 'w1', name: 'Общий' })];
    const base = await setup(csv('2025-01-10,,,,Карта,100,TJS,Наличные,100,TJS', '2025-01-11,Еда,,,Карта,5,TJS,,0,'), { wallets });
    const [a, b] = base.plan.wallets;
    const plan = buildPlan({ ...base.input, walletChoices: { [a!.key]: 'w1', [b!.key]: 'w1' } });
    expect(plan.review.map((r) => r.code)).toEqual(['same-wallet']);
    expect(plan.counts.add).toBe(1);
  });

  it('комиссия перевода в небазовой валюте оценивается тем же курсом; без курса ждёт его', async () => {
    const text = csv('2025-01-10,,,,Карта,100,USD,Копилка,98,USD', '2025-01-10,,,,Карта,100,USD,Копилка,100,USD');
    const a = await setup(text);
    expect(a.plan.counts).toMatchObject({ add: 1, waitRate: 1 });
    expect(a.plan.rates).toEqual([{ currency: 'USD', rows: 1, rate: null }]);
    const b = buildPlan({ ...a.input, rates: { USD: 11 } });
    expect(b.counts).toMatchObject({ add: 2, waitRate: 0 });
    const withFee = b.ops.find((o) => o.row.income!.amountMinor === 9800)!;
    expect(withFee.input!.fx).toEqual({ rate: 11, source: 'manual' });
    expect(b.ops.find((o) => o.row.income!.amountMinor === 10000)!.input!.fx).toBeUndefined();
  });

  it('сумма слишком велика для пересчёта по курсу — на проверку, а не ошибка записи', async () => {
    const text = csv('2025-01-10,,,,Карта,9000000000000.00,USD,,0,');
    const a = await setup(text, { rates: { USD: 1000 } });
    expect(a.plan.counts.add).toBe(0);
    expect(a.plan.review[0]).toMatchObject({ code: 'fx-overflow' });
    expect(a.plan.rates).toEqual([]);
    const ok = buildPlan({ ...a.input, rates: { USD: 0.5 } });
    expect(ok.counts.add).toBe(1);
  });

  it('непригодный курс считается отсутствующим', async () => {
    for (const bad of [0, -1, NaN, Infinity, null, undefined, 1e12]) {
      const { plan } = await setup(csv('2025-01-10,Еда,,,Карта,5,USD,,0,'), { rates: { USD: bad as number } });
      expect(plan.counts.waitRate, String(bad)).toBe(1);
      expect(plan.rates[0]!.rate).toBeNull();
    }
    expect(isUsableRate(10.9)).toBe(true);
    expect(isUsableRate('10.9')).toBe(false);
  });

  it('заметка и дата переходят в операцию как есть', async () => {
    const { plan } = await setup(csv('2024-02-29,Еда,Магазин,молоко,Карта,5,TJS,,0,'));
    expect(plan.ops[0]!.input).toMatchObject({ occurredOn: '2024-02-29', note: 'Магазин — молоко', kind: 'expense', amountMinor: 500 });
  });
});

describe('buildPlan: остатки по файлу (сумма движений)', () => {
  it('basic.csv с курсом: Карта Алиф 3 114,50, Доллары 85,50 $, Наличные 800', async () => {
    const { plan } = await setup(fixtureText('basic.csv'), { rates: { USD: 10.9 } });
    const m = Object.fromEntries(plan.wallets.map((w) => [w.name, w.movementMinor]));
    expect(m).toEqual({ 'Карта Алиф': 311450, Наличные: 80000, Доллары: 8550 });
  });

  it('строки, которые не будут добавлены, в сумму не входят', async () => {
    const { plan } = await setup(fixtureText('basic.csv')); // без курса USD
    expect(plan.wallets.find((w) => w.name === 'Доллары')!.movementMinor).toBe(10000); // только обмен валют: +100 $
  });

  it('переполнение суммы движений не роняет план: null', async () => {
    const big = '10000000000000.00';
    const rows = Array.from({ length: 12 }, (_, i) => `2025-01-${String(10 + i).padStart(2, '0')},,,${i},,0,,Карта,${big},TJS`);
    const { plan } = await setup(csv(...rows));
    expect(plan.wallets[0]!.movementMinor).toBeNull();
    expect(plan.notes.join()).toMatch(/слишком велика/);
  });
});

describe('buildPlan: пустые данные', () => {
  it('только заголовок', async () => {
    const { plan } = await setup(HEAD + '\n');
    expect(plan.counts).toEqual({ add: 0, exists: 0, existsDeleted: 0, review: 0, skipped: 0, waitRate: 0, blocked: 0 });
    expect(plan.wallets).toEqual([]);
    expect(plan.period).toBeNull();
  });

  it('все строки с ошибками', async () => {
    const { plan } = await setup(csv('2025-01-10,,,,Карта,abc,TJS,,0,', '2025-13-10,,,,Карта,5,TJS,,0,'));
    expect(plan.counts).toMatchObject({ add: 0, review: 2 });
    expect(plan.wallets).toEqual([]);
  });
});

describe('предупреждения об обрезке', () => {
  it('длинные заметки и названия', async () => {
    const parsed: ParsedFile = parseZenmoney(csv(`2025-01-10,Еда,,${'я'.repeat(600)},${'К'.repeat(100)},5,TJS,,0,`));
    const ids: PlanIds = await computeIds(USER, parsed);
    const plan = buildPlan({ parsed, ids, baseCurrency: 'TJS', wallets: [], categories: [], existing: new Map() });
    expect(plan.notes.join('\n')).toMatch(/заметка длиннее 500/);
    expect(plan.notes.join('\n')).toMatch(/Названия длиннее 60/);
  });
});
