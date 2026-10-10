import { describe, expect, it, vi } from 'vitest';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { USER, fakeTimers, openDevice, settle, spy, until, type Spy } from './engineHarness';

/** Просроченная сессия: обновить и повторить один раз, иначе честно сказать «нужен вход» и не долбить сервер. */

async function device(server: MemoryServer, onAuthError?: () => Promise<boolean>) {
  let sp!: Spy;
  const d = await openDevice(server, 'dev-a', { seed: true, wrap: (inner) => (sp = spy(inner)).transport, engine: { onAuthError } });
  await d.engine.syncNow();
  return { d, sp };
}
const newWallet = (d: Awaited<ReturnType<typeof device>>['d'], name = 'Новый') =>
  d.store.wallets.create({ name, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });

describe('auth', () => {
  it('сессия обновилась (true): цикл повторяется один раз и проходит, данные на сервере', async () => {
    const server = createMemoryServer();
    const refresh = vi.fn(async () => true);
    const { d } = await device(server, refresh);
    await newWallet(d);
    server.failNext('auth');
    await d.engine.syncNow();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(d.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, lastError: null });
    expect(server.dump(USER, 'wallets')).toHaveLength(2);
  });

  it('сессию обновить не удалось (false): фаза «нужен вход», данные остаются в очереди', async () => {
    const server = createMemoryServer();
    const refresh = vi.fn(async () => false);
    const { d } = await device(server, refresh);
    await newWallet(d);
    server.failNext('auth');
    await d.engine.syncNow();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(d.engine.getStatus()).toMatchObject({ phase: 'auth-required', pending: 1, lastError: 'Нужно войти заново' });
    expect(server.dump(USER, 'wallets')).toHaveLength(1);
    // после входа ручной запуск проходит
    await d.engine.syncNow();
    expect(d.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, lastError: null });
    expect(server.dump(USER, 'wallets')).toHaveLength(2);
  });

  it('onAuthError не задан: сразу «нужен вход»', async () => {
    const server = createMemoryServer();
    const { d } = await device(server);
    await newWallet(d);
    server.failNext('auth');
    await d.engine.syncNow();
    expect(d.engine.getStatus().phase).toBe('auth-required');
  });

  it('сессия «обновилась», но сервер снова отвечает auth: повтор только один, дальше «нужен вход»', async () => {
    const server = createMemoryServer();
    const refresh = vi.fn(async () => true);
    const { d } = await device(server, refresh);
    await newWallet(d);
    server.failNext('auth', 2);
    await d.engine.syncNow();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(d.engine.getStatus()).toMatchObject({ phase: 'auth-required', pending: 1 });
  });

  it('onAuthError упал с ошибкой: считается как «не обновилась», движок не падает', async () => {
    const server = createMemoryServer();
    const { d } = await device(server, async () => {
      throw new Error('нет сети для обновления токена');
    });
    await newWallet(d);
    server.failNext('auth');
    await d.engine.syncNow();
    expect(d.engine.getStatus().phase).toBe('auth-required');
  });

  it('транспорт «без входа»: нужен вход, локальные данные не тронуты', async () => {
    const server = createMemoryServer();
    const d = await openDevice(server, 'dev-x', { seed: true, wrap: () => server.signedOutTransport() });
    await d.engine.syncNow();
    expect(d.engine.getStatus()).toMatchObject({ phase: 'auth-required', lastSyncedAt: null });
    expect(await d.store.settings.get()).toBeNull(); // затравка не вызвана: первой загрузки не было
  });

  it('в состоянии «нужен вход» движок не долбит сервер: правки не будят его, таймер пробует не чаще раза в 5 минут', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await device(server);
    await newWallet(d, 'Первый');
    server.failNext('auth', 100); // токен так и не ожил
    d.engine.start();
    await until(() => d.engine.getStatus().phase === 'auth-required', 'нужен вход');
    sp.calls.length = 0;

    // правки и первые минуты: ни одного запроса
    await newWallet(d, 'Второй');
    await vi.advanceTimersByTimeAsync(5_000); // отложенный запуск после правки
    await vi.advanceTimersByTimeAsync(3 * 60_000); // и несколько «интервалов»
    await settle();
    expect(sp.calls).toHaveLength(0);
    expect(d.engine.getStatus().phase).toBe('auth-required');

    // дальше — редкие пробы (каждая — один запрос, он же отказ): за следующие 10 минут не больше двух
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await settle();
    expect(sp.calls.length).toBeGreaterThanOrEqual(1);
    expect(sp.calls.length).toBeLessThanOrEqual(2);
    expect(d.engine.getStatus().phase).toBe('auth-required');
  });

  it('возврат на вкладку пробует сразу, не дожидаясь таймера (сессия могла обновиться сама)', async () => {
    fakeTimers();
    const server = createMemoryServer();
    const { d, sp } = await device(server);
    await newWallet(d, 'Первый');
    server.failNext('auth');
    d.engine.start();
    await until(() => d.engine.getStatus().phase === 'auth-required', 'нужен вход');
    sp.calls.length = 0;
    await newWallet(d, 'Второй');
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(sp.calls).toHaveLength(0);

    document.dispatchEvent(new Event('visibilitychange'));
    await until(() => d.engine.getStatus().phase === 'idle', 'успешная попытка после возврата на вкладку');
    expect(server.dump(USER, 'wallets')).toHaveLength(3);
  });
});
