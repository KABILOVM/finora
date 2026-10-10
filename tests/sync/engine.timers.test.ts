import { describe, expect, it, vi } from 'vitest';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { USER, fakeTimers, openDevice, settle, spy, until, type Device, type Spy } from './engineHarness';

/** Триггеры и фоновые повторы. Время поддельное: ждать секунды по-настоящему не нужно. */

const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await settle(40);
};

async function open(server: MemoryServer, seed = true): Promise<{ d: Device; sp: Spy }> {
  let sp!: Spy;
  const d = await openDevice(server, 'dev-a', { seed, wrap: (inner) => (sp = spy(inner)).transport });
  return { d, sp };
}
const attempts = (sp: Spy) => sp.pulls('settings').length; // каждый заход начинается с получения настроек (успешный первый — ещё раз в конце)
/** Цикл завершился успешно (поддельные часы: время только растёт, поэтому отличаем по сохранённой метке). */
const syncedOk = (d: Device) => d.engine.getStatus().lastSyncedAt !== null && d.engine.getStatus().phase === 'idle';
const newWallet = (d: Device, name = 'Новый') =>
  d.store.wallets.create({ name, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};
const resetVisibility = () => Reflect.deleteProperty(document, 'visibilityState');

describe('повторы после сбоя: 5 с, 10 с, 20 с … до 5 минут', () => {
  it('сбой сервера: повторы с удвоением паузы, после успеха прекращаются', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await open(server);
    server.failNext('server', 3);
    d.engine.start();
    await until(() => attempts(sp) === 1 && d.engine.getStatus().phase === 'error', 'первый сбой');
    expect(d.engine.getStatus().lastError).toBeTruthy();

    await advance(4_999);
    expect(attempts(sp)).toBe(1);
    await advance(1);
    await until(() => attempts(sp) === 2, 'повтор через 5 с');
    await advance(9_999);
    expect(attempts(sp)).toBe(2);
    await advance(1);
    await until(() => attempts(sp) === 3, 'повтор через 10 с');
    await advance(19_999);
    expect(attempts(sp)).toBe(3);
    await advance(1);
    await until(() => syncedOk(d), 'успех на четвёртой попытке');
    expect(attempts(sp)).toBe(5); // три сбоя по одному получению и успешный заход (получение до затравки и после отправки)

    const t = sp.pulls('settings').map((c) => c.at);
    expect(t.slice(1, 4).map((x, i) => x - (t[i] as number))).toEqual([5_000, 10_000, 20_000]);
    expect(d.engine.getStatus()).toMatchObject({ phase: 'idle', lastError: null });
    expect(await d.store.sync.getMeta('initialPullDone')).toBe(true);
    // повторов по таймеру больше нет (до ближайшего «интервального» цикла, раз в минуту, ещё далеко)
    const before = attempts(sp);
    await advance(20_000);
    expect(attempts(sp)).toBe(before);
  });

  it('точные паузы: 5, 10, 20, 40, 80, 160, 300, 300 секунд', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await open(server);
    server.failNext('network', 8);
    d.engine.start();
    await until(() => attempts(sp) === 1, 'первая попытка');
    const expected = [5, 10, 20, 40, 80, 160, 300, 300];
    for (const [i, sec] of expected.entries()) {
      await advance(sec * 1000 - 1);
      expect(attempts(sp), `за 1 мс до попытки ${i + 2}`).toBe(i + 1);
      await advance(1);
      await until(() => attempts(sp) === i + 2, `попытка ${i + 2}`);
    }
  });

  it('возврат сети (online) сбрасывает паузу: попытка сразу, следующая пауза снова 5 с', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await open(server);
    server.failNext('network', 5);
    d.engine.start();
    await until(() => attempts(sp) === 1, 'первая попытка');
    await advance(5_000);
    await until(() => attempts(sp) === 2, 'вторая');
    await advance(10_000);
    await until(() => attempts(sp) === 3, 'третья (теперь ждём 20 с)');
    window.dispatchEvent(new Event('online'));
    await until(() => attempts(sp) === 4, 'четвёртая сразу по online');
    const t = sp.pulls('settings').map((c) => c.at);
    expect((t[3] as number) - (t[2] as number)).toBe(0);
    await advance(4_999);
    expect(attempts(sp)).toBe(4);
    await advance(1);
    await until(() => attempts(sp) === 5, 'пятая через 5 с, а не через 40');
  });

  it('ручной запуск тоже сбрасывает паузу', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await open(server);
    server.failNext('server', 3);
    d.engine.start();
    await until(() => attempts(sp) === 1, 'первая попытка');
    await advance(5_000);
    await until(() => attempts(sp) === 2, 'вторая');
    await d.engine.syncNow(); // третий сбой, но пауза начинается заново
    expect(attempts(sp)).toBe(3);
    expect(d.engine.getStatus().phase).toBe('error');
    await advance(4_999);
    expect(attempts(sp)).toBe(3);
    await advance(1);
    await until(() => syncedOk(d), 'успех через 5 с');
  });

  it('пока идёт пауза после сбоя, правки и интервал не запускают лишних попыток', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await open(server);
    await d.engine.syncNow(); // начальная загрузка прошла
    server.failNext('server', 1);
    d.engine.start();
    await until(() => d.engine.getStatus().phase === 'error', 'сбой при старте');
    const n = attempts(sp);
    await newWallet(d);
    await advance(2_000); // сработал отложенный запуск после правки — но идёт пауза
    expect(attempts(sp)).toBe(n);
    await advance(3_000);
    await until(() => attempts(sp) === n + 1 && d.engine.getStatus().pending === 0 && d.engine.getStatus().phase === 'idle', 'повтор по таймеру забрал и правку');
    expect(server.dump(USER, 'wallets')).toHaveLength(2);
  });

  it('телефон «заснул» и таймер повтора не сработал: возврат на вкладку после срока запускает повтор сразу, раньше срока — нет', async () => {
    fakeTimers();
    try {
      const server = createMemoryServer();
      const { d, sp } = await open(server);
      server.failNext('server', 1);
      d.engine.start();
      await until(() => d.engine.getStatus().phase === 'error', 'сбой');
      expect(attempts(sp)).toBe(1);

      vi.setSystemTime(Date.now() + 3_000); // время идёт, но таймеры «спят» (не сработали)
      setVisibility('visible');
      await settle();
      expect(attempts(sp)).toBe(1); // срок (5 с) ещё не наступил

      vi.setSystemTime(Date.now() + 10_000);
      setVisibility('visible');
      await until(() => syncedOk(d), 'повтор после возврата на вкладку');
      expect(vi.getTimerCount()).toBe(1); // остался только интервал; просроченный таймер повтора снят
    } finally {
      resetVisibility();
    }
  });

  it('сбой с кодом «отвергнуто» в получении тоже повторяется с паузой (не зависает навсегда)', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d } = await open(server);
    server.failNext('rejected', 1);
    d.engine.start();
    await until(() => d.engine.getStatus().phase === 'error', 'ошибка');
    await advance(5_000);
    await until(() => syncedOk(d), 'повтор прошёл');
  });
});

describe('триггеры', () => {
  it('интервал 60 секунд, пока вкладка видна; на скрытой вкладке не работает; возврат запускает цикл сразу', async () => {
    fakeTimers();
    try {
      const server = createMemoryServer();
      const { d, sp } = await open(server);
      d.engine.start();
      await until(() => syncedOk(d), 'первый цикл');
      await settle();
      const n = attempts(sp);
      await advance(59_999);
      expect(attempts(sp)).toBe(n);
      await advance(1);
      await until(() => attempts(sp) === n + 1, 'цикл по интервалу');

      setVisibility('hidden');
      await settle();
      await advance(10 * 60_000);
      expect(attempts(sp)).toBe(n + 1);

      setVisibility('visible');
      await until(() => attempts(sp) === n + 2, 'цикл сразу при возврате на вкладку');
      await advance(60_000);
      await until(() => attempts(sp) === n + 3, 'интервал снова идёт');
    } finally {
      resetVisibility();
    }
  });

  it('локальные правки: серия правок даёт один цикл через ~1 с после последней', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await open(server);
    d.engine.start();
    await until(() => syncedOk(d), 'первый цикл');
    await settle();
    const n = attempts(sp);
    for (let i = 0; i < 5; i++) {
      await newWallet(d, `W${i}`);
      await advance(200);
    }
    expect(attempts(sp)).toBe(n); // с последней правки прошло 200 мс
    await advance(799);
    expect(attempts(sp)).toBe(n);
    await advance(1);
    await until(() => attempts(sp) === n + 1 && d.engine.getStatus().pending === 0, 'один цикл');
    expect(server.dump(USER, 'wallets')).toHaveLength(6);
    await advance(500);
    expect(attempts(sp)).toBe(n + 1);
  });

  it('затравка при первой загрузке не вызывает лишнего повторного цикла (её данные ушли в том же цикле)', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await open(server);
    d.engine.start();
    await until(() => syncedOk(d), 'первый цикл');
    await settle();
    const n = attempts(sp);
    expect(n).toBe(2); // получение до затравки и получение после отправки
    await advance(5_000); // дольше, чем отложенный запуск после правок
    expect(attempts(sp)).toBe(n);
    expect(d.engine.getStatus().pending).toBe(0);
  });

  it('браузер сообщает «нет сети»: фаза offline, попыток к серверу нет; событие online запускает синхронизацию', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await open(server);
    const onLine = vi.spyOn(Navigator.prototype, 'onLine', 'get').mockReturnValue(false);
    d.engine.start();
    await until(() => d.engine.getStatus().phase === 'offline', 'фаза offline');
    await advance(5 * 60_000);
    await d.engine.syncNow(); // даже ручной запуск не ходит в сеть, которой нет
    expect(sp.calls).toHaveLength(0);
    expect(d.engine.getStatus()).toMatchObject({ phase: 'offline', lastError: null });

    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await until(() => syncedOk(d), 'синхронизация после online');
    expect(server.dump(USER, 'settings')).toHaveLength(1);
  });

  it('событие offline сразу переводит неактивный движок в фазу offline (не оставляет «всё хорошо»)', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d } = await open(server);
    await d.engine.syncNow();
    d.engine.start();
    await until(() => syncedOk(d), 'idle');
    await settle();
    window.dispatchEvent(new Event('offline'));
    expect(d.engine.getStatus().phase).toBe('offline');
  });

  it('start/stop/start (двойной запуск в React StrictMode): один цикл, а не два, и циклы не идут параллельно', async () => {
    fakeTimers();
    const server = createMemoryServer();
    let inFlight = 0;
    let maxInFlight = 0;
    let sp!: Spy;
    const d = await openDevice(server, 'dev-a', {
      seed: true,
      wrap: (inner) => {
        sp = spy(inner);
        const run = async <T>(f: () => Promise<T>): Promise<T> => {
          maxInFlight = Math.max(maxInFlight, ++inFlight);
          try {
            return await f();
          } finally {
            inFlight--;
          }
        };
        return { pull: (t, a, l) => run(() => sp.transport.pull(t, a, l)), push: (t, r) => run(() => sp.transport.push(t, r)) };
      },
    });
    d.engine.start();
    d.engine.stop();
    d.engine.start();
    await until(() => syncedOk(d), 'цикл');
    await settle();
    expect(maxInFlight).toBe(1);
    expect(attempts(sp)).toBe(2); // ровно один цикл первой загрузки (получение до затравки и после отправки)
    expect(server.dump(USER, 'settings')).toHaveLength(1);
  });
});

describe('остановка', () => {
  it('stop снимает таймеры и слушатели; запуск после stop работает', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await open(server);
    d.engine.start();
    await until(() => syncedOk(d), 'первый цикл');
    await settle();
    d.engine.stop();
    expect(vi.getTimerCount()).toBe(0);
    const n = sp.calls.length;
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await newWallet(d); // подписки на локальные правки нет
    await advance(5 * 60_000);
    expect(sp.calls).toHaveLength(n);
    d.engine.start();
    await until(() => server.dump(USER, 'wallets').length === 2, 'после повторного запуска правка ушла');
  });

  it('stop во время паузы после сбоя отменяет повтор', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await open(server);
    server.failNext('server', 1);
    d.engine.start();
    await until(() => d.engine.getStatus().phase === 'error', 'сбой');
    d.engine.stop();
    expect(vi.getTimerCount()).toBe(0);
    await advance(10 * 60_000);
    expect(attempts(sp)).toBe(1);
  });

  it('dispose: ни таймеров, ни слушателей, syncNow ничего не делает, подписчики отключены', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await open(server);
    const seen: string[] = [];
    d.engine.subscribe((s) => seen.push(s.phase));
    d.engine.start();
    await until(() => syncedOk(d), 'первый цикл');
    await settle();
    d.engine.dispose();
    expect(vi.getTimerCount()).toBe(0);
    const n = sp.calls.length;
    const seenCount = seen.length;
    window.dispatchEvent(new Event('online'));
    await d.engine.syncNow();
    d.engine.start(); // после dispose запуск невозможен
    await advance(5 * 60_000);
    expect(sp.calls).toHaveLength(n);
    expect(seen).toHaveLength(seenCount);
  });

  it('dispose посреди цикла: цикл тихо обрывается, ошибок нет, дальше ничего не отправляется', async () => {
    const server = createMemoryServer();
    const { d, sp } = await open(server);
    await d.engine.syncNow();
    await newWallet(d);
    const gate = sp.holdNextPush();
    const cycle = d.engine.syncNow();
    await gate.entered;
    d.engine.dispose();
    gate.open();
    await cycle; // не зависает и не бросает
    const pushes = sp.pushes().length;
    await settle();
    expect(sp.pushes()).toHaveLength(pushes);
  });
});
