import { describe, expect, it } from 'vitest';
import { newId, ValidationError } from '@/db';
import { basics, expense, makeStore } from './helpers';

/** TransactionsRepo.create(input, { id }): повтор с тем же id не создаёт дубль (двойное нажатие «Сохранить»). */
describe('TransactionsRepo.create с заранее выданным id', () => {
  const input = (walletId: string) => ({ kind: 'expense', walletId, amountMinor: 700, occurredOn: '2026-10-05', note: 'Обед' }) as const;

  it('создаёт операцию именно с этим id', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const id = newId();
    const t = await s.transactions.create(input(cash.id), { id });
    expect(t.id).toBe(id);
    expect(await s.db.transactions.get(id)).toMatchObject({ amountMinor: 700, dirty: 1, deletedAt: null });
  });

  it('двойной вызов подряд: ровно одна операция, второй вызов возвращает ту же строку без новой записи', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const id = newId();
    const first = await s.transactions.create(input(cash.id), { id });
    const second = await s.transactions.create(input(cash.id), { id });
    expect(await s.db.transactions.count()).toBe(1);
    expect(second).toEqual(first);
    // метка правки не сдвинулась: повтор ничего не переписал
    expect((await s.db.transactions.get(id))?.clientUpdatedAt).toBe(first.clientUpdatedAt);
  });

  it('параллельно: Promise.all из двух вызовов с одним id — ровно одна операция', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const id = newId();
    const [a, b] = await Promise.all([s.transactions.create(input(cash.id), { id }), s.transactions.create(input(cash.id), { id })]);
    expect(await s.db.transactions.count()).toBe(1);
    expect(a.id).toBe(id);
    expect(b.id).toBe(id);
    expect(a.clientUpdatedAt).toBe(b.clientUpdatedAt);
  });

  it('параллельно: пять вызовов с одним id и разные id рядом — по одной операции на id', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const id = newId();
    const other = newId();
    await Promise.all([
      ...Array.from({ length: 5 }, () => s.transactions.create(input(cash.id), { id })),
      s.transactions.create(input(cash.id), { id: other }),
    ]);
    expect((await s.db.transactions.toArray()).map((t) => t.id).sort()).toEqual([id, other].sort());
  });

  it('повтор после softDelete не воскрешает операцию', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const id = newId();
    await s.transactions.create(input(cash.id), { id });
    const deleted = await s.transactions.softDelete(id);
    const again = await s.transactions.create(input(cash.id), { id });
    expect(again.deletedAt).toBe(deleted.deletedAt);
    expect(again.deletedAt).not.toBeNull();
    expect(await s.db.transactions.count()).toBe(1);
    expect((await s.db.transactions.get(id))?.deletedAt).toBe(deleted.deletedAt);
  });

  it('повтор с другими данными не переписывает существующую операцию', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const id = newId();
    await s.transactions.create(input(cash.id), { id });
    const again = await s.transactions.create({ ...input(cash.id), amountMinor: 99_999, note: 'другое' }, { id });
    expect(again).toMatchObject({ amountMinor: 700, note: 'Обед' });
    expect(await s.db.transactions.get(id)).toMatchObject({ amountMinor: 700, note: 'Обед' });
  });

  it('id в верхнем регистре приводится к нижнему и считается тем же id', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const id = newId();
    const a = await s.transactions.create(input(cash.id), { id: id.toUpperCase() });
    expect(a.id).toBe(id);
    await s.transactions.create(input(cash.id), { id });
    expect(await s.db.transactions.count()).toBe(1);
  });

  it.each([['не UUID', 'tx-1'], ['пустой', ''], ['без дефисов', 'a'.repeat(32)], ['число', 42], ['null', null], ['пробелы', ` ${'0'.repeat(8)}-0000-4000-8000-000000000000`]])(
    'некорректный id отвергается ValidationError, ничего не записывается: %s',
    async (_n, bad) => {
      const s = await makeStore();
      const { cash } = await basics(s);
      const err = await s.transactions.create(input(cash.id), { id: bad as never }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as Error).message).toMatch(/UUID/);
      expect(await s.db.transactions.count()).toBe(0);
    },
  );

  it('неверные данные с id: ошибка, ничего не записано, и тот же id потом можно использовать', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const id = newId();
    await expect(s.transactions.create({ ...input(cash.id), amountMinor: 0 }, { id })).rejects.toBeInstanceOf(ValidationError);
    expect(await s.db.transactions.count()).toBe(0);
    expect((await s.transactions.create(input(cash.id), { id })).id).toBe(id);
  });

  it('без opts.id всё как раньше: каждый вызов — новая операция со своим UUID', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const a = await expense(s, cash.id, 100);
    const b = await expense(s, cash.id, 100);
    expect(a.id).not.toBe(b.id);
    expect(await s.db.transactions.count()).toBe(2);
  });

  it('правила остаются в силе и для операции с заданным id (граница суммы, перевод в одной валюте)', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const card = await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    await expect(s.transactions.create({ ...input(cash.id), amountMinor: 1e15 + 1 }, { id: newId() })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      s.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 100, toAmountMinor: 101, occurredOn: '2026-10-05' }, { id: newId() }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await s.db.transactions.count()).toBe(0);
  });
});
