// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RUN_BUDGET_MS, SEND_TIMEOUT_MS, createHandler } from '../../supabase/functions/send-reminders/index';
import { CRON, FakeStore, USER_A, USER_B, captureConsole, deps, fakeSender, request, settings, sub, type FakeSender } from './testkit';

/* ---------------------------------------------------------------------------------------------
 * У каждой отправки свой срок. Зависшее соединение с push-сервисом — это сбой: запуск не ждёт его дольше SEND_TIMEOUT_MS,
 * запись журнала снимается (следующий час повторит), остальные люди не страдают. Время — поддельное.
 * ------------------------------------------------------------------------------------------- */

const out = captureConsole();
afterEach(() => vi.useRealTimers());

const NOW = new Date('2026-10-10T04:10:00Z'); // 09:10 в Душанбе
const daily = (userId: string) => settings(userId, { remindPayments: false, remindDebts: false, remindDaily: true });

/** Отправитель с заданной задержкой по id подписки: число — ответ через столько мс, 'hang' — никогда, 'reject' + мс — отказ позже. */
type Plan = Record<string, number | 'hang' | { rejectAfter: number }>;
function slowSender(plan: Plan): FakeSender {
  const base = fakeSender();
  const send = (async (s, body, opts) => {
    const p = plan[s.id];
    if (p === 'hang') return new Promise<never>(() => undefined);
    if (typeof p === 'number') await new Promise((r) => setTimeout(r, p));
    if (typeof p === 'object') {
      await new Promise((r) => setTimeout(r, p.rejectAfter));
      throw new Error(`поздний сбой на ${s.endpoint}`);
    }
    return base(s, body, opts);
  }) as FakeSender;
  Object.assign(send, { calls: base.calls, outcomes: base.outcomes, bodies: base.bodies });
  return send;
}

function setup(plan: Plan, users: Array<{ id: string; subs: string[] }>) {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const store = new FakeStore();
  store.settings = users.map((u) => daily(u.id));
  for (const u of users) store.subs.set(u.id, u.subs.map((s) => sub(s)));
  const send = slowSender(plan);
  const h = createHandler(deps({ store, send, now: () => NOW }));
  const startedAt = Date.now();
  const state = { done: false, finishedAfter: 0 };
  const run = h(request('POST', { token: CRON, body: {} })).then(async (r) => {
    state.done = true;
    state.finishedAfter = Date.now() - startedAt;
    return (await r.json()) as Record<string, unknown>;
  });
  return { store, send, h, run, state };
}

describe('срок одной отправки', () => {
  it('граница: ответ за 14,9 с принят, молчание после 15 с — сбой с пометкой timeout; принявшее устройство сохраняет запись журнала', async () => {
    const { run, send, store, state } = setup({ s1: SEND_TIMEOUT_MS - 100, s2: SEND_TIMEOUT_MS + 100 }, [{ id: USER_A, subs: ['s1', 's2'] }]);
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(state.done, 'запуск не должен ждать позднего ответа').toBe(true);
    expect(await run).toMatchObject({ sent: 1, failed: 1, notified: 1, failedStatuses: { timeout: 1 } });
    expect(send.calls.map((c) => c.subId)).toEqual(['s1']);
    expect([...store.log].length).toBe(1); // одно устройство приняло — напоминание доставлено, повтора не будет
  });

  it('все устройства человека молчат: запуск завершается за срок, записи журнала сняты, следующий час доставляет', async () => {
    const { run, store, state, send } = setup({ s1: 'hang', s2: 'hang' }, [{ id: USER_A, subs: ['s1', 's2'] }]);
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(state.done).toBe(true);
    expect(state.finishedAfter).toBe(SEND_TIMEOUT_MS);
    expect(await run).toMatchObject({ sent: 0, failed: 2, notified: 0, errors: 0, failedStatuses: { timeout: 2 } });
    expect(store.log.size, 'запись журнала снята: напоминание не потеряно').toBe(0);
    // сеть ожила: тот же человек, следующий запуск
    const good = fakeSender();
    const again = createHandler(deps({ store, send: good, now: () => new Date('2026-10-10T05:10:00Z') }));
    const r = (await (await again(request('POST', { token: CRON, body: {} }))).json()) as Record<string, unknown>;
    expect(r).toMatchObject({ sent: 2, notified: 1 });
    expect(send.calls).toEqual([]);
  });

  it('зависший у первого человека не мешает второму в том же запуске; общее время — один срок, а не сумма', async () => {
    const { run, send, state } = setup({ a1: 'hang', b1: 100 }, [
      { id: USER_A, subs: ['a1'] },
      { id: USER_B, subs: ['b1'] },
    ]);
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 200);
    expect(state.done).toBe(true);
    expect(state.finishedAfter).toBe(SEND_TIMEOUT_MS + 100);
    expect(await run).toMatchObject({ users: 2, sent: 1, failed: 1 });
    expect(send.calls.map((c) => c.subId)).toEqual(['b1']);
  });

  it('поздний отказ отправителя после срока не превращается в необработанную ошибку и ничего не меняет', async () => {
    const seen: unknown[] = [];
    const onRejection = (e: unknown) => void seen.push(e);
    process.on('unhandledRejection', onRejection);
    try {
      const { run, state } = setup({ s1: { rejectAfter: SEND_TIMEOUT_MS + 5_000 } }, [{ id: USER_A, subs: ['s1'] }]);
      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
      expect(state.done).toBe(true);
      expect(await run).toMatchObject({ failed: 1, failedStatuses: { timeout: 1 } });
      await vi.advanceTimersByTimeAsync(30_000); // отправитель «просыпается» и бросает ошибку
      await Promise.resolve();
      expect(seen).toEqual([]);
      expect(out.text()).not.toMatch(/fcm\.googleapis|s1/);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('после запуска не остаётся висящих таймеров ни при быстрой отправке, ни при зависшей', async () => {
    const fast = setup({ s1: 50 }, [{ id: USER_A, subs: ['s1'] }]);
    await vi.advanceTimersByTimeAsync(100);
    await fast.run;
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    const hung = setup({ s1: 'hang' }, [{ id: USER_A, subs: ['s1'] }]);
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    await hung.run;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('исключение отправителя без задержки — по-прежнему обычный сбой (не timeout)', async () => {
    vi.useFakeTimers();
    const store = new FakeStore();
    store.settings = [daily(USER_A)];
    store.subs.set(USER_A, [sub('s1')]);
    const send = fakeSender();
    send.outcomes.set('s1', 'throw');
    const h = createHandler(deps({ store, send, now: () => NOW }));
    const run = h(request('POST', { token: CRON, body: {} }));
    await vi.advanceTimersByTimeAsync(10);
    expect(await (await run).json()).toMatchObject({ failed: 1, failedStatuses: { network: 1 } });
  });

  it('«Проверить уведомление» при зависшей отправке: ответ 200 ok:false за срок, а не зависание', async () => {
    vi.useFakeTimers();
    const store = new FakeStore();
    store.subs.set(USER_A, [sub('s1')]);
    const send = slowSender({ s1: 'hang' });
    const h = createHandler(deps({ store, send, now: () => NOW, verifyJwt: async () => USER_A }));
    let done = false;
    const run = h(request('POST', { token: 'aaa.bbb.ccc', body: { action: 'test' } })).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(done).toBe(true);
    const res = await run;
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, mode: 'test', sent: 0, failed: 1, failedStatuses: { timeout: 1 } });
  });
});

describe('предел всего запуска при общей беде (push-сервис молчит у всех)', () => {
  it('8 человек, у всех зависание: новые люди после бюджета не начинаются, запуск укладывается в предел платформы (150 с)', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
    const plan: Plan = {};
    for (const id of ids) plan[`s-${id}`] = 'hang';
    const { run, state, store } = setup(
      plan,
      ids.map((id) => ({ id, subs: [`s-${id}`] })),
    );
    await vi.advanceTimersByTimeAsync(200_000);
    expect(state.done).toBe(true);
    const r = await run;
    expect(r).toMatchObject({ users: 8, errors: 0 });
    expect(r.skippedTimeBudget as number).toBeGreaterThanOrEqual(1);
    expect(state.finishedAfter).toBeLessThan(150_000);
    expect(state.finishedAfter).toBeLessThanOrEqual(RUN_BUDGET_MS + SEND_TIMEOUT_MS);
    expect(store.log.size, 'ни у кого запись не съедена').toBe(0);
  });
});
