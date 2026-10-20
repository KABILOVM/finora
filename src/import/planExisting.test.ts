import { describe, expect, it } from 'vitest';
import { computeIds } from './ids';
import { parseZenmoney } from './parse';
import { buildPlan, type PlanInput } from './plan';
import type { ExistingTx, WalletLite } from './types';

/**
 * Что планировщик делает с операциями, уже лежащими в базе: поиск «по содержимому» (после переноса данных в аккаунт номера
 * операций другие), счёт идёт туда, где уже лежит его история, и «создать новый» предлагается только когда он правда создастся.
 */

const USER = 'user-1';
const HEAD =
  'date,categoryName,payee,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle';
const csv = (...rows: string[]) => [HEAD, ...rows].join('\n') + '\n';

const wallet = (over: Partial<WalletLite> & { id: string; name: string }): WalletLite => ({ currency: 'TJS', archivedAt: null, deletedAt: null, ...over });
const stored = (over: Partial<ExistingTx> = {}): ExistingTx => ({
  deleted: false,
  kind: 'expense',
  walletId: 'w1',
  toWalletId: null,
  amountMinor: 1200,
  toAmountMinor: null,
  occurredOn: '2026-09-02',
  note: 'Корвон — Хлеб',
  ...over,
});

async function setup(text: string, over: Partial<Omit<PlanInput, 'parsed' | 'ids'>> = {}) {
  const parsed = parseZenmoney(text);
  const ids = await computeIds(USER, parsed);
  const input: PlanInput = { parsed, ids, baseCurrency: 'TJS', wallets: [wallet({ id: 'w1', name: 'Карта' })], categories: [], existing: new Map(), ...over };
  return { parsed, ids, input, plan: buildPlan(input) };
}

const BREAD = '2026-09-02,Еда,Корвон,Хлеб,Карта,12.00,TJS,,0,';

describe('«уже есть» по содержимому', () => {
  it('операция с другим номером, но той же датой, суммой, кошельком и заметкой считается имеющейся', async () => {
    const { plan } = await setup(csv(BREAD), { existing: new Map([['чужой-номер', stored()]]) });
    expect(plan.counts).toMatchObject({ add: 0, exists: 1, existsDeleted: 0 });
    expect(plan.ops[0]).toMatchObject({ status: 'exists', byContent: true, placed: { out: 'w1', in: null } });
    expect(plan.notes.some((n) => n.includes('совпали дата, сумма, кошелёк и заметка'))).toBe(true);
  });

  it('два одинаковых кофе в файле и один в базе: одно «уже есть», второе добавится', async () => {
    const { plan } = await setup(csv(BREAD, BREAD), { existing: new Map([['x', stored()]]) });
    expect(plan.ops.map((o) => o.status)).toEqual(['exists', 'add']);
    expect(plan.counts).toMatchObject({ add: 1, exists: 1 });
  });

  it('операция базы, уже занятая строкой файла по номеру, не засчитывается второй раз по содержимому', async () => {
    const parsed = parseZenmoney(csv(BREAD, BREAD));
    const ids = await computeIds(USER, parsed);
    const { plan } = await setup(csv(BREAD, BREAD), { existing: new Map([[ids.tx[0]!, stored()]]) });
    expect(plan.ops.map((o) => [o.status, o.byContent ?? false])).toEqual([
      ['exists', false],
      ['add', false],
    ]);
  });

  it('возможный дубль, который человек решил добавить всё равно, добавляется; остальные совпадения по-прежнему пропускаются', async () => {
    const first = await setup(csv(BREAD, BREAD), { existing: new Map([['x', stored()], ['y', stored()]]) });
    expect(first.plan.ops.map((o) => o.status)).toEqual(['exists', 'exists']);
    const forceId = first.ids.tx[1]!;
    const { plan } = await setup(csv(BREAD, BREAD), { existing: new Map([['x', stored()], ['y', stored()]]), forceAdd: new Set([forceId]) });
    expect(plan.ops.map((o) => o.status)).toEqual(['exists', 'add']);
    expect(plan.counts).toMatchObject({ add: 1, exists: 1 });
    expect(plan.ops[1]!.input).toMatchObject({ kind: 'expense', amountMinor: 1200, occurredOn: '2026-09-02' });
  });

  it('«добавить всё равно» не отменяет проверку по номеру: операция с тем же id в базе не добавится никогда', async () => {
    const parsed = parseZenmoney(csv(BREAD));
    const ids = await computeIds(USER, parsed);
    const { plan } = await setup(csv(BREAD), { existing: new Map([[ids.tx[0]!, stored()]]), forceAdd: new Set([ids.tx[0]!]) });
    expect(plan.ops[0]).toMatchObject({ status: 'exists' });
    expect(plan.counts.add).toBe(0);
  });

  it.each([
    ['другой кошелёк', { walletId: 'w2' }],
    ['другая дата', { occurredOn: '2026-09-03' }],
    ['другая сумма', { amountMinor: 1201 }],
    ['другая заметка', { note: 'Корвон — Молоко' }],
    ['другой вид', { kind: 'income' as const }],
  ])('%s: это другая операция, она добавится', async (_name, over) => {
    const { plan } = await setup(csv(BREAD), { wallets: [wallet({ id: 'w1', name: 'Карта' }), wallet({ id: 'w2', name: 'Другой' })], existing: new Map([['x', stored(over)]]) });
    expect(plan.counts).toMatchObject({ add: 1, exists: 0 });
  });

  it('категория в проверку не входит: человек мог исправить её после импорта', async () => {
    const { plan } = await setup(csv(BREAD), { existing: new Map([['x', stored()]]) });
    expect(plan.counts.exists).toBe(1);
  });

  it('живая операция засчитывается раньше удалённой; удалённая не воскрешает', async () => {
    const both = new Map([
      ['a', stored({ deleted: true })],
      ['b', stored()],
    ]);
    const { plan } = await setup(csv(BREAD, BREAD, BREAD), { existing: both });
    expect(plan.ops.map((o) => [o.status, o.existsDeleted ?? false])).toEqual([
      ['exists', false],
      ['exists', true],
      ['add', false],
    ]);
    expect(plan.counts).toMatchObject({ add: 1, exists: 2, existsDeleted: 1 });
  });

  it('если известно только «удалена ли» (без данных операции), по содержимому не ищем', async () => {
    const { plan } = await setup(csv(BREAD), { existing: new Map([['x', false]]) });
    expect(plan.counts).toMatchObject({ add: 1, exists: 0 });
  });

  it('курс для уже имеющейся операции не нужен', async () => {
    const text = csv('2026-09-08,Покупки,Рынок,Куртка,Доллары,40.00,USD,,0,');
    const { plan } = await setup(text, {
      wallets: [wallet({ id: 'w3', name: 'Доллары', currency: 'USD' })],
      existing: new Map([['x', stored({ walletId: 'w3', amountMinor: 4000, occurredOn: '2026-09-08', note: 'Рынок — Куртка' })]]),
    });
    expect(plan.counts).toMatchObject({ exists: 1, waitRate: 0, add: 0 });
    expect(plan.rates).toEqual([]);
  });

  it('перевод: совпадают оба кошелька и обе суммы', async () => {
    const text = csv('2026-09-06,,,Перевод,Карта,500.00,TJS,Наличные,495.00,TJS');
    const wallets = [wallet({ id: 'w1', name: 'Карта' }), wallet({ id: 'w2', name: 'Наличные' })];
    const row = stored({ kind: 'transfer', walletId: 'w1', toWalletId: 'w2', amountMinor: 50000, toAmountMinor: 49500, occurredOn: '2026-09-06', note: 'Перевод' });
    const hit = await setup(text, { wallets, existing: new Map([['x', row]]) });
    expect(hit.plan.counts).toMatchObject({ exists: 1, add: 0 });
    expect(hit.plan.ops[0]!.placed).toEqual({ out: 'w1', in: 'w2' });
    const miss = await setup(text, { wallets, existing: new Map([['x', { ...row, toAmountMinor: 50000 }]]) });
    expect(miss.plan.counts).toMatchObject({ exists: 0, add: 1 });
  });

  it('пустая база и файл без строк не ломают проверку', async () => {
    const { plan } = await setup(csv(), { existing: new Map([['x', stored()]]) });
    expect(plan.ops).toEqual([]);
    expect(plan.counts.exists).toBe(0);
  });
});

describe('счёт идёт туда, где уже лежит его история', () => {
  async function withHistory(places: string[], over: Partial<Omit<PlanInput, 'parsed' | 'ids'>> = {}) {
    const text = csv(
      '2026-09-01,Еда,,Один,Карта Алиф,10.00,TJS,,0,',
      '2026-09-02,Еда,,Два,Карта Алиф,20.00,TJS,,0,',
      '2026-09-03,Еда,,Три,Карта Алиф,30.00,TJS,,0,',
    );
    const ids = await computeIds(USER, parseZenmoney(text));
    const existing = new Map<string, ExistingTx>(places.map((walletId, i) => [ids.tx[i]!, stored({ walletId })]));
    return setup(text, {
      wallets: [wallet({ id: 'mine', name: 'Моя карта' }), wallet({ id: 'zzz', name: 'Запасная' })],
      existing,
      ...over,
    });
  }

  it('новые строки того же счёта идут в кошелёк, куда направили прошлые', async () => {
    const { plan } = await withHistory(['mine', 'mine']);
    expect(plan.wallets[0]!.target).toEqual({ kind: 'existing', id: 'mine', name: 'Моя карта', how: 'history' });
    expect(plan.wallets[0]!.chosen).toBe(false);
    expect(plan.ops[2]!.input!.walletId).toBe('mine');
  });

  it('при расхождении побеждает кошелёк, где операций больше; при равенстве — с меньшим id (не зависит от порядка)', async () => {
    expect((await withHistory(['zzz', 'mine', 'mine'])).plan.wallets[0]!.target).toMatchObject({ id: 'mine', how: 'history' });
    expect((await withHistory(['zzz', 'mine'])).plan.wallets[0]!.target).toMatchObject({ id: 'mine' });
    expect((await withHistory(['mine', 'zzz'])).plan.wallets[0]!.target).toMatchObject({ id: 'mine' });
  });

  it('ручной выбор сильнее истории', async () => {
    const { plan } = await withHistory(['mine'], { walletChoices: { 'карта алиф|TJS': 'zzz' } });
    expect(plan.wallets[0]!.target).toMatchObject({ id: 'zzz', how: 'chosen' });
  });

  it('если кошелька истории больше нет (архив или другая валюта), счёт не гадает: подбор идёт дальше', async () => {
    const archived = await withHistory(['mine'], { wallets: [wallet({ id: 'mine', name: 'Моя карта', archivedAt: '2026-01-01T00:00:00.000Z' })] });
    expect(archived.plan.wallets[0]!.target.kind).toBe('create');
    const otherCur = await withHistory(['mine'], { wallets: [wallet({ id: 'mine', name: 'Моя карта', currency: 'USD' })] });
    expect(otherCur.plan.wallets[0]!.target.kind).toBe('create');
  });

  it('кошелёк прошлого импорта сильнее истории; найденный по названию — слабее', async () => {
    const text = csv('2026-09-01,Еда,,Один,Карта Алиф,10.00,TJS,,0,', '2026-09-02,Еда,,Два,Карта Алиф,20.00,TJS,,0,');
    const ids = await computeIds(USER, parseZenmoney(text));
    const detId = ids.wallets.get('карта алиф|TJS')!;
    const existing = new Map<string, ExistingTx>([[ids.tx[0]!, stored({ walletId: 'mine' })]]);
    const saved = await setup(text, { wallets: [wallet({ id: 'mine', name: 'Моя карта' }), wallet({ id: detId, name: 'Карта Алиф' })], existing });
    expect(saved.plan.wallets[0]!.target).toMatchObject({ id: detId, how: 'saved' });
    const named = await setup(text, { wallets: [wallet({ id: 'mine', name: 'Моя карта' }), wallet({ id: 'same', name: 'Карта Алиф' })], existing });
    expect(named.plan.wallets[0]!.target).toMatchObject({ id: 'mine', how: 'history' });
  });

  it('история и название указывают на один кошелёк — это обычный «найден по названию»', async () => {
    const text = csv('2026-09-01,Еда,,Один,Карта Алиф,10.00,TJS,,0,');
    const ids = await computeIds(USER, parseZenmoney(text));
    const { plan } = await setup(text, {
      wallets: [wallet({ id: 'same', name: 'Карта Алиф' })],
      existing: new Map([[ids.tx[0]!, stored({ walletId: 'same' })]]),
    });
    expect(plan.wallets[0]!.target).toMatchObject({ id: 'same', how: 'name' });
  });

  it('история берётся из сторон перевода: списание — из кошелька списания, зачисление — из кошелька зачисления', async () => {
    const text = csv('2026-09-06,,,Перевод,Карта,500.00,TJS,Наличные,495.00,TJS');
    const ids = await computeIds(USER, parseZenmoney(text));
    const { plan } = await setup(text, {
      wallets: [wallet({ id: 'a', name: 'Первый' }), wallet({ id: 'b', name: 'Второй' })],
      existing: new Map([[ids.tx[0]!, stored({ kind: 'transfer', walletId: 'a', toWalletId: 'b', amountMinor: 50000, toAmountMinor: 49500 })]]),
    });
    const byName = Object.fromEntries(plan.wallets.map((w) => [w.name, w.target]));
    expect(byName['Карта']).toMatchObject({ id: 'a', how: 'history' });
    expect(byName['Наличные']).toMatchObject({ id: 'b', how: 'history' });
  });

  it('операция, вид которой человек поменял руками, историю не определяет', async () => {
    const text = csv(BREAD);
    const ids = await computeIds(USER, parseZenmoney(text));
    const { plan } = await setup(text, {
      wallets: [wallet({ id: 'w1', name: 'Другое имя' })],
      existing: new Map([[ids.tx[0]!, stored({ kind: 'income' })]]),
    });
    expect(plan.wallets[0]!.target.kind).toBe('create');
  });
});

describe('можно ли создать новый кошелёк', () => {
  const text = csv(BREAD);
  it('нет кошелька с детерминированным id — можно', async () => {
    const { plan } = await setup(text);
    expect(plan.wallets[0]!.canCreate).toBe(true);
  });
  it.each([
    ['живой', {}],
    ['в архиве', { archivedAt: '2026-01-01T00:00:00.000Z' }],
    ['удалён', { deletedAt: '2026-01-01T00:00:00.000Z' }],
  ])('кошелёк прошлого импорта %s — нельзя: id занят', async (_name, over) => {
    const ids = await computeIds(USER, parseZenmoney(text));
    const detId = ids.wallets.get('карта|TJS')!;
    const { plan } = await setup(text, { wallets: [wallet({ id: detId, name: 'Карта', ...over })] });
    expect(plan.wallets[0]!.canCreate).toBe(false);
  });
});
