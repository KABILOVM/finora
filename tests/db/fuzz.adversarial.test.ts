import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ValidationError, importBackup, exportBackup } from '@/db';
import { basics, makeStore } from './helpers';

const weird = fc.oneof(fc.anything(), fc.constantFrom(NaN, Infinity, -0, 1e21, '', ' ', '\u0000', '2026-02-30', null, undefined, Number.MAX_SAFE_INTEGER, -1, 0, {}, [], 'TJS', 'expense'));

describe('мусор на входе: только ValidationError, и никаких записанных кривых строк', () => {
  it('репозитории', { timeout: 120_000 }, async () => {
    const s = await makeStore();
    const { cash, usd, food } = await basics(s);
    const keys = ['name', 'currency', 'kind', 'openingBalanceMinor', 'color', 'icon', 'sortOrder', 'parentId', 'walletId', 'toWalletId', 'amountMinor', 'toAmountMinor', 'categoryId', 'occurredOn', 'note', 'fx', 'baseCurrency', 'weekStartsOn', 'defaultWalletId', 'id', 'dirty', 'deletedAt'];
    const obj = fc.dictionary(fc.constantFrom(...keys), weird, { maxKeys: 8 });
    const targets: Array<(o: Record<string, unknown>) => Promise<unknown>> = [
      (o) => s.wallets.create(o as never),
      (o) => s.wallets.update(cash.id, o as never),
      (o) => s.categories.create(o as never),
      (o) => s.categories.update(food.id, o as never),
      (o) => s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 1, occurredOn: '2026-10-05', ...o } as never),
      (o) => s.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 1, toAmountMinor: 1, occurredOn: '2026-10-05', ...o } as never),
      (o) => s.settings.update(o as never),
    ];
    await fc.assert(
      fc.asyncProperty(obj, fc.integer({ min: 0, max: targets.length - 1 }), async (o, i) => {
        try {
          await targets[i]!(o);
        } catch (e) {
          expect(e instanceof ValidationError, `не ValidationError: ${String(e)}`).toBe(true);
        }
        // после любого вызова база остаётся в допустимом состоянии
        for (const t of await s.db.transactions.toArray()) {
          expect(Number.isSafeInteger(t.amountMinor) && t.amountMinor > 0).toBe(true);
          expect(typeof t.note).toBe('string');
        }
        for (const w of await s.db.wallets.toArray()) {
          expect(/^[A-Z]{3}$/.test(w.currency)).toBe(true);
          expect(Number.isSafeInteger(w.openingBalanceMinor)).toBe(true);
          expect(w.name.length >= 1 && w.name.length <= 60).toBe(true);
        }
      }),
      { numRuns: 600 },
    );
  });

  it('importBackup на мусоре: ValidationError или успех, но не другое исключение', { timeout: 120_000 }, async () => {
    const s = await makeStore();
    await basics(s);
    const base = JSON.parse(JSON.stringify(await exportBackup(s)));
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('settings', 'wallets', 'categories', 'transactions'), fc.nat(3), fc.constantFrom('id', 'name', 'kind', 'amountMinor', 'parentId', 'walletId', 'categoryId', 'currency', 'clientUpdatedAt', 'deviceId', 'occurredOn', 'toWalletId', 'toAmountMinor', 'fxRate', 'baseAmountMinor'), weird, async (table, idx, key, value) => {
        const file = JSON.parse(JSON.stringify(base));
        const target = table === 'settings' ? file.settings : file[table][idx % Math.max(file[table].length, 1)];
        if (target) target[key] = value;
        try {
          await importBackup(s, file);
        } catch (e) {
          expect(e instanceof ValidationError, `не ValidationError: ${String(e)}`).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });
});
