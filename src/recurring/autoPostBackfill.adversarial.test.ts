import { describe, expect, it } from 'vitest';
import { basics, makeStore } from '../../tests/db/helpers';
import { runAutoPost } from './autoPost';
import { historyNote } from './ruleForm';

/**
 * Атака «задним числом»: автопроведение берёт окно дат от (начала расписания, дня создания правила, «сегодня − 60 дней»),
 * но не знает, КОГДА автоплатёж реально стал действовать: после включения «Проводить само» у старого правила,
 * после возврата из архива и после правки расписания окно по-прежнему тянется на 60 дней в прошлое.
 * Человек этого не просил, а экран обещает обратное (см. тексты в ruleForm.historyNote и в окне «Убрать в архив»).
 *
 * Часы хранилища управляются тестом (makeStore({ now })), чтобы метки createdAt были настоящими, как у живого приложения.
 */

const TODAY = '2026-10-11';
const toLocal = (iso: string) => iso.slice(0, 10);
const at = (date: string) => Date.parse(`${date}T08:00:00.000Z`);

const run = (store: Awaited<ReturnType<typeof makeStore>>, today = TODAY) =>
  runAutoPost({ store, today, getRate: () => null, toLocal });
const datesOf = async (store: Awaited<ReturnType<typeof makeStore>>) =>
  (await store.db.transactions.toArray()).filter((t) => t.deletedAt === null).map((t) => t.occurredOn).sort();

describe('автопроведение не должно проводить прошлые даты, когда автоплатёж только что «ожил»', () => {
  it('возврат из архива: платежи за время, пока правило лежало в архиве, не записываются задним числом', async () => {
    let now = at('2026-07-03');
    const store = await makeStore({ now: () => now });
    const { cash } = await basics(store);
    // «Спортзал»: каждую неделю, с 3 июля; 10 июля человек убрал платёж в архив (окно «Убрать в архив» обещает:
    // «не будут проводиться сами»), а 11 октября вернул его
    const rule = await store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 5_000, frequency: 'weekly', startOn: '2026-07-03', autoPost: 1 });
    now = at('2026-07-10');
    await store.recurring.archive(rule.id);
    now = at(TODAY);
    await store.recurring.restore(rule.id);

    await run(store);

    const past = (await datesOf(store)).filter((d) => d < TODAY);
    expect(past, 'после возврата из архива записаны платежи за дни, когда правило лежало в архиве').toEqual([]);
  });

  it('включили «Проводить само» у старого правила: экран обещает, что прошлые даты сами не проводятся, — и они не проводятся', async () => {
    let now = at('2026-09-11');
    const store = await makeStore({ now: () => now });
    const { cash } = await basics(store);
    const rule = await store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 5_000, frequency: 'weekly', startOn: '2026-09-11', autoPost: 0 });
    now = at(TODAY);
    // это ровно то, что человек читает под переключателем, когда включает «Проводить само» в окне правки
    const promise = historyNote({ autoPost: true, startOn: rule.startOn }, TODAY);
    expect(promise).toContain('Платежи за прошлые даты сами не проводятся');
    await store.recurring.update(rule.id, { autoPost: 1 });

    await run(store);

    const past = (await datesOf(store)).filter((d) => d < TODAY);
    expect(past, 'за прошлые даты платежи записаны сами, хотя экран обещал, что этого не будет').toEqual([]);
  });

  it('правка расписания у автоплатежа (аренда с 5-го на 6-е): уже проведённые месяцы не проводятся второй раз', async () => {
    let now = at('2026-01-05');
    const store = await makeStore({ now: () => now });
    const { cash } = await basics(store);
    const rule = await store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 300_000, frequency: 'monthly', startOn: '2026-01-05', autoPost: 1 });
    // приложение открывали в дни платежей: август, сентябрь и октябрь проведены по одному разу
    for (const day of ['2026-08-05', '2026-09-05', '2026-10-05']) {
      now = at(day);
      await run(store, day);
    }
    expect((await datesOf(store)).filter((d) => d >= '2026-09-01')).toEqual(['2026-09-05', '2026-10-05']);

    // 8 октября человек поправил день платежа: «на самом деле 6-го»
    now = at('2026-10-08');
    await store.recurring.update(rule.id, { startOn: '2026-01-06' });
    await run(store, '2026-10-08');

    const sepOct = (await datesOf(store)).filter((d) => d >= '2026-09-01');
    expect(sepOct, 'после правки дня платежа аренда за сентябрь и октябрь записана дважды').toHaveLength(2);
  });
});
