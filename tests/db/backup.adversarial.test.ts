import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup } from '@/db';
import { basics, expense, makeStore } from './helpers';

const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('импорт копии не должен нарушать правила, которые держат репозитории', () => {
  it('валюта кошелька, по которому уже есть операции, не меняется импортом более новой копии', async () => {
    // Ноутбук (A) и телефон (B) — один человек. Телефон получил копию, когда операций ещё не было.
    let t = Date.UTC(2026, 9, 10, 12);
    const A = await makeStore({ now: () => t, deviceId: 'device-laptop-1' });
    const B = await makeStore({ now: () => t, deviceId: 'device-phone-22' });
    const { cash } = await basics(A);
    await importBackup(B, json(await exportBackup(A)));
    // на телефоне кошелёк «ещё пустой» — валюту можно поменять (по правилам репозитория)
    t += 60_000;
    await B.wallets.update(cash.id, { currency: 'USD' });
    // а на ноутбуке человек вносит расход в этот же кошелёк в сомони
    t += 60_000;
    await expense(A, cash.id, 5_000);
    // потом человек переносит копию с телефона на ноутбук
    t += 60_000;
    await importBackup(A, json(await exportBackup(B))).catch(() => undefined);
    const w = await A.db.wallets.get(cash.id);
    const txs = await A.db.transactions.where('walletId').equals(cash.id).toArray();
    expect(txs.length).toBe(1);
    // 5 000 дирам (50 сомони) не должны превратиться в 50 долларов
    expect(w?.currency, 'валюта кошелька с операциями изменилась импортом').toBe('TJS');
  });

  it('вид категории, по которой уже есть операции, не меняется импортом более новой копии', async () => {
    let t = Date.UTC(2026, 9, 10, 12);
    const A = await makeStore({ now: () => t, deviceId: 'device-laptop-1' });
    const B = await makeStore({ now: () => t, deviceId: 'device-phone-22' });
    const { cash, food } = await basics(A);
    await importBackup(B, json(await exportBackup(A)));
    t += 60_000;
    await B.categories.update(food.id, { kind: 'income' }); // у телефона по «Еде» операций нет
    t += 60_000;
    await expense(A, cash.id, 5_000, { categoryId: food.id });
    t += 60_000;
    await importBackup(A, json(await exportBackup(B))).catch(() => undefined);
    const cat = await A.db.categories.get(food.id);
    const tx = (await A.db.transactions.toArray()).find((x) => x.deletedAt === null);
    // расход не может висеть на категории доходов
    expect(tx?.kind === 'expense' && cat?.kind === 'income', 'расход оказался в категории доходов').toBe(false);
  });

  it('копия с кольцом категорий (A — родитель B, B — родитель A) отвергается, как это делает репозиторий', async () => {
    const A = await makeStore();
    const { food } = await basics(A);
    const base = json(await exportBackup(A));
    const stamp = '2026-10-10T12:30:00.000Z';
    // id — настоящие UUID: иначе файл отвергся бы по другой причине (id не UUID), а не из-за кольца
    const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const cat = (id: string, parentId: string) => ({ ...base.categories[0]!, id, parentId, name: id, kind: 'expense' as const, createdAt: stamp, clientUpdatedAt: stamp, deviceId: 'device-zzzzz-1' });
    base.categories.push(cat(idA, idB), cat(idB, idA));
    void food;
    await expect(importBackup(A, base)).rejects.toThrow(/кольц|цикл/);
  });

  // Решение: копия БЕЗ блока настроек (в том числе чужого аккаунта) ПРИНИМАЕТСЯ. Раньше здесь был тест «отвергается»,
  // но восстановление своей копии в новый аккаунт после потери старого — законный сценарий, и отказ его ломал бы.
  // Копию с блоком настроек ДРУГОГО аккаунта по-прежнему отвергает backup.test.ts («копия другого аккаунта»).

  it('собственная выгрузка всегда должна загружаться обратно: удалённая операция + смена вида её категории', async () => {
    const A = await makeStore();
    const { cash, food } = await basics(A);
    const t = await expense(A, cash.id, 5_000, { categoryId: food.id });
    await A.transactions.softDelete(t.id);
    // живых операций по категории нет — репозиторий разрешает сменить вид (расход → доход)
    await A.categories.update(food.id, { kind: 'income' });
    const file = json(await exportBackup(A));
    // новый телефон: восстановление из собственной резервной копии
    const B = await makeStore();
    await expect(importBackup(B, file)).resolves.toBeDefined();
  });

  it('копия с устройства, у которого часы шли вперёд на 10 минут, загружается обратно (его же данные!)', async () => {
    const real = Date.now();
    // телефон со сбитыми часами: приложение честно ставит метки «по часам телефона»
    const phone = await makeStore({ now: () => real + 10 * 60_000, deviceId: 'device-fast-0001' });
    await basics(phone);
    const file = json(await exportBackup(phone));
    // потом телефон потерян / часы исправлены: копия восстанавливается на устройстве с верными часами
    const fresh = await makeStore({ now: () => real });
    await expect(importBackup(fresh, file)).resolves.toBeDefined();
  });
});
