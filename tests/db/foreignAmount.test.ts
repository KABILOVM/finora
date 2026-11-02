import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup, ValidationError } from '@/db';
import { computeBalances } from '@/domain/balances';
import { basics, makeStore } from './helpers';

/**
 * «Сумма в валюте» у операции: оплата картой в другой валюте (банк списал 135 с., на чеке 50 AED). Хранится рядом с суммой в валюте
 * кошелька и ни на остаток, ни на курс не влияет.
 */

const day = '2026-10-05';

async function setup() {
  const store = await makeStore();
  const b = await basics(store);
  return { store, ...b };
}

describe('сумма в валюте: запись', () => {
  it('расход картой: 135 с. списано, 50 AED на чеке; остаток и снимок считаются по сумме в валюте кошелька', async () => {
    const { store, cash } = await setup();
    const t = await store.transactions.create({
      kind: 'expense',
      walletId: cash.id,
      amountMinor: 13_500,
      occurredOn: day,
      note: 'кафе',
      foreignCurrency: 'AED',
      foreignAmountMinor: 5_000,
    });
    expect(t).toMatchObject({ amountMinor: 13_500, baseAmountMinor: 13_500, fxRate: 1, foreignCurrency: 'AED', foreignAmountMinor: 5_000 });
    const balances = computeBalances(await store.db.wallets.toArray(), await store.db.transactions.toArray());
    expect(balances.get(cash.id)).toBe(100_000 - 13_500);
  });

  it('без суммы в валюте оба поля пусты (null, а не undefined)', async () => {
    const { store, cash } = await setup();
    const t = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100, occurredOn: day });
    expect(t.foreignCurrency).toBeNull();
    expect(t.foreignAmountMinor).toBeNull();
  });

  it.each([
    ['только валюта', { foreignCurrency: 'AED' }],
    ['только сумма', { foreignAmountMinor: 5_000 }],
    ['сумма 0', { foreignCurrency: 'AED', foreignAmountMinor: 0 }],
    ['отрицательная сумма', { foreignCurrency: 'AED', foreignAmountMinor: -1 }],
    ['дробная сумма', { foreignCurrency: 'AED', foreignAmountMinor: 1.5 }],
    ['валюта строчными', { foreignCurrency: 'aed', foreignAmountMinor: 5_000 }],
    ['валюта не из трёх букв', { foreignCurrency: 'DIRHAM', foreignAmountMinor: 5_000 }],
  ])('%s — ошибка, операция не записана', async (_name, extra) => {
    const { store, cash } = await setup();
    await expect(store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100, occurredOn: day, ...extra })).rejects.toBeInstanceOf(ValidationError);
    expect(await store.db.transactions.count()).toBe(0);
  });

  it('валюта суммы совпала с валютой кошелька — ошибка', async () => {
    const { store, cash } = await setup();
    await expect(
      store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100, occurredOn: day, foreignCurrency: 'TJS', foreignAmountMinor: 100 }),
    ).rejects.toThrow(/отличаться от валюты кошелька/);
  });

  it('у перевода суммы в валюте не бывает', async () => {
    const { store, cash, usd } = await setup();
    await expect(
      store.transactions.create({
        kind: 'transfer',
        walletId: cash.id,
        toWalletId: usd.id,
        amountMinor: 10_900,
        toAmountMinor: 1_000,
        occurredOn: day,
        foreignCurrency: 'AED',
        foreignAmountMinor: 5_000,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('доход тоже может хранить сумму в валюте', async () => {
    const { store, cash, salary } = await setup();
    const t = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 20_000, categoryId: salary.id, occurredOn: day, foreignCurrency: 'USD', foreignAmountMinor: 1_800 });
    expect(t).toMatchObject({ foreignCurrency: 'USD', foreignAmountMinor: 1_800 });
  });
});

describe('сумма в валюте: правка', () => {
  async function withCard() {
    const s = await setup();
    const t = await s.store.transactions.create({ kind: 'expense', walletId: s.cash.id, amountMinor: 13_500, occurredOn: day, note: 'кафе', foreignCurrency: 'AED', foreignAmountMinor: 5_000 });
    return { ...s, t };
  }

  it('правка заметки сумму в валюте не трогает и лишней записи не создаёт', async () => {
    const { store, t } = await withCard();
    const same = await store.transactions.update(t.id, { note: 'кафе' });
    expect(same.dirty).toBe(t.dirty);
    const next = await store.transactions.update(t.id, { note: 'кафе у отеля' });
    expect(next).toMatchObject({ note: 'кафе у отеля', foreignCurrency: 'AED', foreignAmountMinor: 5_000 });
  });

  it('сумму в валюте можно изменить и очистить (оба поля вместе)', async () => {
    const { store, t } = await withCard();
    expect(await store.transactions.update(t.id, { foreignCurrency: 'USD', foreignAmountMinor: 1_400 })).toMatchObject({ foreignCurrency: 'USD', foreignAmountMinor: 1_400 });
    const cleared = await store.transactions.update(t.id, { foreignCurrency: null, foreignAmountMinor: null });
    expect(cleared.foreignCurrency).toBeNull();
    expect(cleared.foreignAmountMinor).toBeNull();
    await expect(store.transactions.update(t.id, { foreignCurrency: 'USD' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('перевод на кошелёк той же валюты, что и сумма в валюте, не принимается', async () => {
    const { store, t, usd } = await withCard();
    await expect(store.transactions.update(t.id, { walletId: usd.id, foreignCurrency: 'USD', foreignAmountMinor: 100, fx: { rate: 10.9, source: 'nbt' } })).rejects.toThrow(/отличаться от валюты кошелька/);
  });

  it('расход становится переводом — сумма в валюте сбрасывается сама', async () => {
    const { store, t, usd } = await withCard();
    const moved = await store.transactions.update(t.id, { kind: 'transfer', toWalletId: usd.id, toAmountMinor: 1_000, categoryId: null });
    expect(moved.kind).toBe('transfer');
    expect(moved.foreignCurrency).toBeNull();
    expect(moved.foreignAmountMinor).toBeNull();
  });
});

describe('сумма в валюте: резервная копия', () => {
  it('круговой обмен сохраняет сумму в валюте; копия без этих полей (старая) читается как «нет»', async () => {
    const { store, cash } = await setup();
    const t = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 13_500, occurredOn: day, foreignCurrency: 'AED', foreignAmountMinor: 5_000 });
    const plain = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100, occurredOn: day });
    const file = await exportBackup(store);
    expect(file.transactions.find((x) => x.id === t.id)).toMatchObject({ foreignCurrency: 'AED', foreignAmountMinor: 5_000 });

    const other = await makeStore({ factory: new IDBFactory() });
    await importBackup(other, JSON.parse(JSON.stringify(file)));
    expect(await other.db.transactions.get(t.id)).toMatchObject({ foreignCurrency: 'AED', foreignAmountMinor: 5_000 });

    // копия, сделанная до появления поля: в строках его просто нет
    const old = JSON.parse(JSON.stringify(file)) as { transactions: Record<string, unknown>[] };
    for (const row of old.transactions) {
      delete row['foreignCurrency'];
      delete row['foreignAmountMinor'];
    }
    const third = await makeStore({ factory: new IDBFactory() });
    await importBackup(third, old as never);
    expect(await third.db.transactions.get(plain.id)).toMatchObject({ foreignCurrency: null, foreignAmountMinor: null });
  });
});
