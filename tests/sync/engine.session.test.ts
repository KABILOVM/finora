import { describe, expect, it, vi } from 'vitest';
import { SessionMismatchError, guardSession, type SessionAwareTransport } from '@/sync/session';
import { TransportError, type SyncTransport } from '@/sync/transport';

/** guardSession: сверка владельца токена перед каждым запросом. */

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function transport(whose: () => Promise<string | null | undefined>) {
  const pull = vi.fn(async () => []);
  const push = vi.fn(async () => undefined);
  const t: SessionAwareTransport = { currentUserId: whose, pull, push };
  return { t, pull, push };
}

describe('guardSession', () => {
  it('транспорт без currentUserId возвращается как есть: проверить нечем', () => {
    const plain: SyncTransport = { pull: async () => [], push: async () => undefined };
    expect(guardSession(plain, ME)).toBe(plain);
  });

  it('свой токен (в том числе другой регистр букв в id) — запрос проходит', async () => {
    const { t, pull, push } = transport(async () => ME.toUpperCase());
    const g = guardSession(t, ME);
    await g.pull('wallets', 0, 10);
    await g.push('wallets', [{ id: 'x' }]);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('чужой токен — SessionMismatchError, запрос до сервера не доходит ни на чтение, ни на запись', async () => {
    const { t, pull, push } = transport(async () => OTHER);
    const g = guardSession(t, ME);
    await expect(g.pull('wallets', 0, 10)).rejects.toBeInstanceOf(SessionMismatchError);
    await expect(g.push('wallets', [{ id: 'x' }])).rejects.toBeInstanceOf(SessionMismatchError);
    expect(pull).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('сверка идёт перед КАЖДЫМ запросом: сессия подменилась между двумя запросами', async () => {
    let who = ME;
    const { t, push } = transport(async () => who);
    const g = guardSession(t, ME);
    await g.push('wallets', [{ id: '1' }]);
    who = OTHER;
    await expect(g.push('wallets', [{ id: '2' }])).rejects.toBeInstanceOf(SessionMismatchError);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('сессии нет (null) — это «auth», как просроченный токен', async () => {
    const { t, push } = transport(async () => null);
    const err = await guardSession(t, ME).push('wallets', [{ id: 'x' }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).kind).toBe('auth');
    expect(push).not.toHaveBeenCalled();
  });

  it('узнать нельзя (undefined) — запрос проходит', async () => {
    const { t, pull } = transport(async () => undefined);
    await guardSession(t, ME).pull('wallets', 0, 10);
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it('сбой самой сверки (сеть) — TransportError наверх, запрос не уходит', async () => {
    const { t, push } = transport(async () => {
      throw new TransportError('network', 'нет сети');
    });
    const err = await guardSession(t, ME).push('wallets', [{ id: 'x' }]).catch((e: unknown) => e);
    expect((err as TransportError).kind).toBe('network');
    expect(push).not.toHaveBeenCalled();
  });

  it('пустая пачка ничего не отправляет и сверки не требует', async () => {
    const who = vi.fn(async () => OTHER);
    const { t, push } = transport(who);
    await guardSession(t, ME).push('wallets', []);
    expect(who).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
