import { describe, expect, it } from 'vitest';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { TransportError } from '@/sync/transport';
import { USER, openDevice, settle, snapshotOf, spy, type Device, type Spy } from './engineHarness';

/**
 * Состязательные проверки слияния по группам полей (src/db/syncMerge.ts + предварительный забор в engine.ts).
 * Каждый тест — одна атака; красный тест = найденная поломка.
 */

interface Rig {
  server: MemoryServer;
  a: Device;
  b: Device;
  spyA: Spy;
  txId: string;
  walletId: string;
}

/** Два устройства одного пользователя, обе синхронизированы, одна операция «такси» на 100,00. У A транспорт обёрнут шпионом. */
async function rig(): Promise<Rig> {
  const server = createMemoryServer();
  let spyA!: Spy;
  const a = await openDevice(server, 'dev-a', {
    seed: true,
    wrap: (inner) => {
      spyA = spy(inner);
      return spyA.transport;
    },
  });
  const b = await openDevice(server, 'dev-b', { seed: true });
  await a.engine.syncNow();
  await b.engine.syncNow();
  const wallet = (await a.store.db.wallets.toArray())[0]!;
  const tx = await a.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 10_000, occurredOn: '2026-10-05', note: 'такси' });
  await a.engine.syncNow();
  await b.engine.syncNow();
  return { server, a, b, spyA, txId: tx.id, walletId: wallet.id };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const serverTx = (r: Rig) => r.server.dump(USER, 'transactions').find((t) => t['id'] === r.txId)!;

describe('слияние: причинный порядок правок одной группы', () => {
  it('A отправил сумму, ответ потерялся; B увидел её и ПОЗЖЕ исправил сумму; повтор A не должен вернуть старую сумму', async () => {
    const r = await rig();
    await r.a.store.transactions.update(r.txId, { amountMinor: 20_000 });
    r.spyA.loseResponses = 1; // сервер принял, ответ до телефона не дошёл (обычное дело в мобильной сети)
    await r.a.engine.syncNow();
    expect(r.a.engine.getStatus().pending).toBe(1); // A считает, что не отправил
    expect(serverTx(r)['amount_minor']).toBe(20_000);

    await sleep(5);
    await r.b.engine.syncNow(); // B видит 200,00
    expect((await r.b.store.db.transactions.get(r.txId))!.amountMinor).toBe(20_000);
    await r.b.store.transactions.update(r.txId, { amountMinor: 30_000 }); // сознательная поправка ПОСЛЕ чужой правки
    await r.b.engine.syncNow();
    expect(serverTx(r)['amount_minor']).toBe(30_000);

    await sleep(5);
    await r.a.engine.syncNow(); // повторная отправка у A
    await r.b.engine.syncNow();
    await r.a.engine.syncNow();
    expect(serverTx(r)['amount_minor'], 'поздняя осознанная правка B затёрта повтором старой правки A').toBe(30_000);
    expect((await r.a.store.db.transactions.get(r.txId))!.amountMinor).toBe(30_000);
  });

  it('правка во время отправки, затем обрыв связи: в очереди остаётся уже отправленная группа и затирает чужую поправку', async () => {
    const r = await rig();
    await r.a.store.transactions.update(r.txId, { amountMinor: 20_000 });
    const gate = r.spyA.holdNextPush();
    let pushes = 0;
    r.spyA.onPush = () => {
      if (pushes++ >= 1) throw new TransportError('network', 'обрыв связи'); // первая отправка (с суммой) проходит, повтор — нет
    };
    // у A идёт отправка суммы; пока запрос в пути, человек правит заметку той же операции
    const p = r.a.engine.syncNow();
    await gate.entered;
    await r.a.store.transactions.update(r.txId, { note: 'такси из аэропорта' });
    gate.open();
    await p;
    expect(serverTx(r)['amount_minor']).toBe(20_000); // сумма уже на сервере
    expect(r.a.engine.getStatus().pending).toBe(1); // а заметка ждёт: связь оборвалась

    // B видит 200,00 и сознательно поправляет на 300,00
    await sleep(5);
    await r.b.engine.syncNow();
    await r.b.store.transactions.update(r.txId, { amountMinor: 30_000 });
    await r.b.engine.syncNow();
    expect(serverTx(r)['amount_minor']).toBe(30_000);

    // связь у A вернулась
    r.spyA.onPush = undefined;
    await sleep(5);
    await r.a.engine.syncNow();
    await r.b.engine.syncNow();
    expect(serverTx(r)['amount_minor'], 'сумма уже была отправлена, а группа «money» всё ещё числится у A грязной').toBe(30_000);
    expect(String(serverTx(r)['note'])).toBe('такси из аэропорта');
  });

  it('A трижды поменял сумму и вернул прежнюю (итого ничего не менял), B за это время поменял сумму: правка B не должна пропасть', async () => {
    const r = await rig();
    await r.a.store.transactions.update(r.txId, { amountMinor: 20_000 });
    await r.a.store.transactions.update(r.txId, { amountMinor: 10_000 });
    expect((await r.a.store.db.transactions.get(r.txId))!.amountMinor).toBe(10_000);
    await sleep(5);
    await r.b.store.transactions.update(r.txId, { amountMinor: 15_000 });
    await r.b.engine.syncNow();
    await sleep(5);
    await r.a.engine.syncNow();
    await r.b.engine.syncNow();
    expect(serverTx(r)['amount_minor'], 'A ничего не менял по итогу, но его «возвращённое» значение стёрло правку B').toBe(15_000);
  });

  it('A удалил операцию и сразу вернул (итого ничего не менял), B удалил её по-настоящему: операция остаётся удалённой', async () => {
    const r = await rig();
    await r.a.store.transactions.softDelete(r.txId);
    await r.a.store.transactions.restore(r.txId); // «отменить»
    await sleep(5);
    await r.b.store.transactions.softDelete(r.txId);
    await r.b.engine.syncNow();
    await sleep(5);
    await r.a.engine.syncNow();
    await r.b.engine.syncNow();
    await r.a.engine.syncNow();
    expect(serverTx(r)['deleted_at'], 'удаление B отменено «чистым нулём» A: операция воскресла и снова считается в остатке').not.toBeNull();
    expect((await r.a.store.db.transactions.get(r.txId))!.deletedAt).not.toBeNull();
  });

  it('старая правка суммы на A (10:00) против более поздней правки суммы на B (11:00): побеждает та, что позже', async () => {
    const r = await rig();
    await r.a.store.transactions.update(r.txId, { amountMinor: 20_000 }); // A офлайн, раньше
    await sleep(20);
    await r.b.store.transactions.update(r.txId, { amountMinor: 30_000 }); // B позже
    await r.b.engine.syncNow();
    await sleep(20);
    await r.a.engine.syncNow(); // A приходит с сетью позже
    await r.b.engine.syncNow();
    expect(serverTx(r)['amount_minor'], 'устаревшая правка победила по порядку синхронизации, а не по времени правки').toBe(30_000);
  });
});

describe('слияние: перевезённые и возвращённые значения', () => {
  it('B правит другую группу и перевозит МОЁ прежнее значение с новой меткой: моя более поздняя правка не проигрывает по метке', async () => {
    const r = await rig();
    await r.a.store.transactions.update(r.txId, { note: 'первая' });
    r.spyA.loseResponses = 1; // сервер принял «первая», ответ потерян
    await r.a.engine.syncNow();
    await r.a.store.transactions.update(r.txId, { note: 'вторая' });
    await sleep(5);
    await r.b.store.transactions.update(r.txId, { amountMinor: 20_000 }); // B видел «первая» и несёт её дальше, поднимая метку записи
    await r.b.engine.syncNow();
    await sleep(5);
    await r.a.engine.syncNow();
    await r.b.engine.syncNow();
    await r.a.engine.syncNow();
    expect(String(serverTx(r)['note']), 'перевезённое чужим устройством старое значение победило более позднюю правку').toBe('вторая');
    expect(serverTx(r)['amount_minor']).toBe(20_000);
    expect(await snapshotOf(r.a.store)).toEqual(await snapshotOf(r.b.store));
  });

  it('сумма отправлена (ответ потерян), затем возвращена к прежней: возврат доходит до сервера, а не принимается за «ничего не менялось»', async () => {
    const r = await rig();
    await r.a.store.transactions.update(r.txId, { amountMinor: 20_000 });
    r.spyA.loseResponses = 1;
    await r.a.engine.syncNow();
    expect(serverTx(r)['amount_minor']).toBe(20_000);
    await r.a.store.transactions.update(r.txId, { amountMinor: 10_000 }); // «отменил»: вернул прежнюю сумму
    await sleep(5);
    await r.a.engine.syncNow();
    await r.b.engine.syncNow();
    await r.a.engine.syncNow();
    expect(serverTx(r)['amount_minor'], 'возврат к исходному принят за «не менялось», на сервере осталась отправленная сумма').toBe(10_000);
    expect((await r.b.store.db.transactions.get(r.txId))!.amountMinor).toBe(10_000);
  });

  it('удаление отправлено, затем отменено; B после этого удалил по-настоящему: остаётся удалённой, а не воскресает', async () => {
    const r = await rig();
    await r.a.store.transactions.softDelete(r.txId);
    r.spyA.loseResponses = 1;
    await r.a.engine.syncNow();
    await r.a.store.transactions.restore(r.txId);
    await sleep(5);
    await r.b.engine.syncNow(); // B видит удаление A
    await r.b.store.transactions.restore(r.txId);
    await r.b.store.transactions.softDelete(r.txId); // и удаляет сам, позже «отмены» A
    await r.b.engine.syncNow();
    await sleep(5);
    await r.a.engine.syncNow();
    await r.b.engine.syncNow();
    expect(serverTx(r)['deleted_at']).not.toBeNull();
    expect((await r.a.store.db.transactions.get(r.txId))!.deletedAt).not.toBeNull();
  });
});

describe('слияние: строка, чьё создание ушло, но ответ потерялся', () => {
  it('A создал операцию (ответ потерян) и правит заметку; B за это время правит дату: обе правки сохраняются', async () => {
    const server = createMemoryServer();
    let spyA!: Spy;
    const a = await openDevice(server, 'dev-a', { seed: true, wrap: (i) => ((spyA = spy(i)), spyA.transport) });
    const b = await openDevice(server, 'dev-b', { seed: true });
    await a.engine.syncNow();
    await b.engine.syncNow();
    const wallet = (await a.store.db.wallets.toArray())[0]!;
    const tx = await a.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 10_000, occurredOn: '2026-10-05', note: 'такси' });
    spyA.loseResponses = 1; // сервер принял создание, телефон об этом не знает
    await a.engine.syncNow();
    expect(a.engine.getStatus().pending).toBe(1);

    await sleep(5);
    await b.engine.syncNow(); // B получил операцию
    await b.store.transactions.update(tx.id, { occurredOn: '2026-10-01' });
    await b.engine.syncNow();
    await sleep(5);
    await a.store.transactions.update(tx.id, { note: 'такси из аэропорта' }); // у строки ещё нет групп: «вся запись»
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();

    const row = server.dump(USER, 'transactions').find((t) => t['id'] === tx.id)!;
    expect(row['occurred_on'], 'дата B затёрта слепой отправкой всей строки A').toBe('2026-10-01');
    expect(String(row['note'])).toBe('такси из аэропорта');
  });

  it('то же, но правка A старше правки B по метке: заметка A не должна пропасть молча', async () => {
    const server = createMemoryServer();
    let spyA!: Spy;
    const a = await openDevice(server, 'dev-a', { seed: true, wrap: (i) => ((spyA = spy(i)), spyA.transport) });
    const b = await openDevice(server, 'dev-b', { seed: true });
    await a.engine.syncNow();
    await b.engine.syncNow();
    const wallet = (await a.store.db.wallets.toArray())[0]!;
    const tx = await a.store.transactions.create({ kind: 'expense', walletId: wallet.id, amountMinor: 10_000, occurredOn: '2026-10-05', note: 'такси' });
    spyA.loseResponses = 1;
    await a.engine.syncNow();
    await a.store.transactions.update(tx.id, { note: 'такси из аэропорта' });
    await sleep(5);
    await b.engine.syncNow();
    await b.store.transactions.update(tx.id, { occurredOn: '2026-10-01' });
    await b.engine.syncNow();
    await sleep(5);
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    const row = server.dump(USER, 'transactions').find((t) => t['id'] === tx.id)!;
    expect(row['occurred_on']).toBe('2026-10-01');
    expect(String(row['note']), 'заметка A проиграла по метке и пропала молча').toBe('такси из аэропорта');
  });
});

describe('слияние: часы устройства убежали вперёд + потерянный ответ', () => {
  it('новая запись с меткой из будущего: после повторной отправки её метки и дата создания совпадают с серверными на всех устройствах', async () => {
    const server = createMemoryServer();
    const HOURS_11 = 11 * 3_600_000;
    let spyA!: Spy;
    const a = await openDevice(server, 'dev-a', { seed: true, now: () => Date.now() + HOURS_11, wrap: (i) => ((spyA = spy(i)), spyA.transport) });
    const b = await openDevice(server, 'dev-b', { seed: true });
    await a.engine.syncNow();
    await b.engine.syncNow();
    const seeded = (await a.store.db.wallets.toArray())[0]!;
    // у A есть правка существующей записи (значит, перед отправкой идёт забор) и новый кошелёк
    await a.store.wallets.update(seeded.id, { name: 'Переименован' });
    const w = await a.store.wallets.create({ name: 'Новый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'c' });
    spyA.loseResponses = 1; // сервер принял обе записи (метки зажал до «сейчас + 5 минут»), ответ потерян
    await a.engine.syncNow();
    for (let i = 0; i < 3; i++) {
      await a.engine.syncNow();
      await b.engine.syncNow();
    }
    const onA = (await a.store.db.wallets.get(w.id))!;
    const onB = (await b.store.db.wallets.get(w.id))!;
    const onServer = server.dump(USER, 'wallets').find((x) => x['id'] === w.id)!;
    expect(Date.parse(String(onServer['created_at']))).toBeLessThan(Date.now() + 10 * 60_000);
    expect(onB.clientUpdatedAt).toBe(new Date(String(onServer['client_updated_at'])).toISOString());
    expect({ createdAt: onA.createdAt, clientUpdatedAt: onA.clientUpdatedAt }, 'A хранит свои метки из будущего, а не серверные').toEqual({
      createdAt: onB.createdAt,
      clientUpdatedAt: onB.clientUpdatedAt,
    });
  });
});

describe('слияние: окно между предварительным забором и отправкой', () => {
  it('B успевает отправить заметку между заборами A и отправкой A: обе правки сохраняются', async () => {
    const r = await rig();
    await r.a.store.transactions.update(r.txId, { amountMinor: 20_000 });
    let fired = false;
    r.spyA.onPull = async (table, _after, rows) => {
      if (table === 'transactions' && !fired) {
        fired = true;
        await r.b.store.transactions.update(r.txId, { note: 'такси из аэропорта' });
        await r.b.engine.syncNow();
      }
      return rows;
    };
    await r.a.engine.syncNow();
    for (let i = 0; i < 3; i++) {
      await r.b.engine.syncNow();
      await r.a.engine.syncNow();
    }
    expect(serverTx(r)['amount_minor']).toBe(20_000);
    expect(String(serverTx(r)['note']), 'заметка B затёрта отправкой A, которая не знала о ней').toBe('такси из аэропорта');
  });

  it('то же, но чужая правка успевает раньше по метке, чем слияние A: правка A не пропадает', async () => {
    const r = await rig();
    await r.a.store.transactions.update(r.txId, { note: 'моя заметка' });
    let fired = false;
    r.spyA.onPull = async (table, _after, rows) => {
      if (table === 'transactions' && !fired) {
        fired = true;
        await r.b.store.transactions.update(r.txId, { amountMinor: 55_000 });
        await r.b.engine.syncNow();
      }
      return rows;
    };
    await r.a.engine.syncNow();
    for (let i = 0; i < 3; i++) {
      await r.b.engine.syncNow();
      await r.a.engine.syncNow();
    }
    expect(String(serverTx(r)['note'])).toBe('моя заметка');
    expect(serverTx(r)['amount_minor'], 'сумма B затёрта').toBe(55_000);
  });
});

describe('слияние: сервер отверг объединённую запись', () => {
  it('отказ по одной записи после слияния не клинит очередь и не теряет остальные', async () => {
    const r = await rig();
    await r.a.store.transactions.update(r.txId, { amountMinor: 20_000 });
    await r.b.store.transactions.update(r.txId, { note: 'заметка B' });
    await r.b.engine.syncNow();
    let rejectOnce = true;
    r.spyA.onPush = (table) => {
      if (table === 'transactions' && rejectOnce) {
        rejectOnce = false;
        throw new TransportError('rejected', 'значение вне границ', '23514');
      }
    };
    await r.a.store.wallets.update(r.walletId, { color: '#123456' }); // другая запись не должна пострадать
    await r.a.engine.syncNow();
    expect(r.a.engine.getStatus().quarantined).toBe(1);
    expect(r.server.dump(USER, 'wallets').find((w) => w['id'] === r.walletId)!['color']).toBe('#123456');
    // человек нажал «повторить»
    await r.a.store.sync.retryQuarantined();
    await r.a.engine.syncNow();
    await r.b.engine.syncNow();
    expect(serverTx(r)['amount_minor']).toBe(20_000);
    expect(String(serverTx(r)['note'])).toBe('заметка B');
    expect(r.a.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });
    expect(await snapshotOf(r.a.store)).toEqual(await snapshotOf(r.b.store));
    await settle(5);
  });
});
