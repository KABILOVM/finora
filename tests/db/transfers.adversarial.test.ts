import { describe, expect, it } from 'vitest';
import { computeBalances } from '@/domain/balances';
import { basics, makeStore } from './helpers';

describe('перевод: правка кошельков не должна создавать деньги из воздуха', () => {
  it('межвалютный перевод USD→TJS, источник заменили на кошелёк в TJS: сумма зачисления не остаётся от старой пары', async () => {
    const s = await makeStore();
    const { cash, usd } = await basics(s); // cash — TJS, usd — USD
    const card = await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 100_000, color: '#000000', icon: 'x' });
    // 1 доллар (100 центов) → 10,90 сомони (1090 дирам)
    const t = await s.transactions.create({ kind: 'transfer', walletId: usd.id, toWalletId: cash.id, amountMinor: 100, toAmountMinor: 1090, occurredOn: '2026-10-05' });
    // человек понял, что деньги ушли с карты (TJS), а не с долларового кошелька, и сменил источник
    const res = await s.transactions.update(t.id, { walletId: card.id }).then(
      (r) => r,
      () => null, // отказ с понятной ошибкой — тоже допустимое поведение
    );
    if (res === null) return;
    // 100 дирам списали, а зачислили 1090 дирам: баланс двух кошельков вырос на 990 из ничего
    const wallets = await s.db.wallets.toArray();
    const txs = await s.db.transactions.toArray();
    const before = 100_000 + 100_000; // карта + нал на начало
    const after = [...computeBalances(wallets, txs)].filter(([id]) => id === card.id || id === cash.id).reduce((m, [, v]) => m + v, 0);
    expect(after, `сумма на двух кошельках TJS выросла на ${after - before} дирам`).toBe(before);
  });

  it('то же в другую сторону: источник TJS→USD-перевода заменён на USD-кошелёк — разница от курса не должна стать «комиссией»', async () => {
    const s = await makeStore();
    const { cash, usd } = await basics(s);
    const usd2 = await s.wallets.create({ name: 'Доллары 2', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    // 1090 дирам (10,90 с.) → 100 центов (1 $)
    const t = await s.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 1090, toAmountMinor: 100, occurredOn: '2026-10-05' });
    const res = await s.transactions.update(t.id, { walletId: usd2.id }).then((r) => r, () => null);
    if (res === null) return;
    // теперь это перевод USD→USD; разница в суммах была курсом обмена, а не комиссией — она не должна превратиться в «комиссию»
    expect(res.toAmountMinor, `списано ${res.amountMinor}, зачислено ${res.toAmountMinor}: ${res.amountMinor - res.toAmountMinor!} центов исчезло`).toBe(res.amountMinor);
  });

  it('перевод в той же валюте: сумма зачисления больше суммы списания (деньги из воздуха) отвергается', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    const card = await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    // опечатка в поле «зачислено» (комиссия): вместо 4950 набрано 49500
    await expect(
      s.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 5000, toAmountMinor: 49_500, occurredOn: '2026-10-05' }),
    ).rejects.toThrow();
  });
});
