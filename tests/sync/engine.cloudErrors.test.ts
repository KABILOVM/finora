import { describe, expect, it } from 'vitest';
import { createMemoryServer } from '@/sync/memoryServer';
import { TransportError } from '@/sync/transport';
import { openDevice, spy, USER, type Spy } from './engineHarness';

/**
 * Что человек читает в статусе синхронизации, когда сервер ответил отказом «server» (5xx и всё нераспознанное).
 * Временная недоступность и «в облаке чего-то не хватает» — разные беды: во втором случае повтор сам не поможет, и текст говорит, что делать.
 */

async function ready() {
  const server = createMemoryServer();
  let sp!: Spy;
  const d = await openDevice(server, 'dev-a', { seed: true, wrap: (inner) => (sp = spy(inner)).transport });
  await d.engine.syncNow();
  // одна запись ждёт отправки: сбой пойдёт на push
  await d.store.wallets.create({ name: 'Новый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#111111', icon: 'w' });
  return { server, d, sp };
}

const failWith = (sp: Spy, error: TransportError) => {
  sp.onPush = () => {
    throw error;
  };
};

describe('причина сбоя в статусе движка', () => {
  it('временный сбой без кода: «Сервер временно недоступен», запись остаётся в очереди и уходит со следующего цикла', async () => {
    const { d, sp } = await ready();
    failWith(sp, new TransportError('server', 'Ошибка сервера (503): Service Unavailable'));
    await d.engine.syncNow();
    expect(d.engine.getStatus()).toMatchObject({ phase: 'error', pending: 1, lastError: 'Сервер временно недоступен' });
    sp.onPush = undefined;
    await d.engine.syncNow();
    expect(d.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, lastError: null });
  });

  it('временный сбой с кодом: код виден в тексте (PGRST002 — кэш схемы ещё грузится)', async () => {
    const { d, sp } = await ready();
    failWith(sp, new TransportError('server', 'Ошибка сервера (503): Could not query the database for the schema cache. Retrying.', 'PGRST002'));
    await d.engine.syncNow();
    expect(d.engine.getStatus()).toMatchObject({ phase: 'error', lastError: 'Сервер временно недоступен (код PGRST002)' });
  });

  it('странный «код» (длинный, с пробелами, разметкой) в текст не попадает', async () => {
    const { d, sp } = await ready();
    failWith(sp, new TransportError('server', 'Ошибка сервера', '<b>очень длинный код с пробелами</b>'));
    await d.engine.syncNow();
    expect(d.engine.getStatus().lastError).toBe('Сервер временно недоступен');
  });

  it.each([
    ['42703', 'Ошибка сервера (400): column "foo" does not exist', 'column "foo" does not exist'],
    ['42P01', 'Ошибка сервера (404): relation "public.debts" does not exist', 'relation "public.debts" does not exist'],
    ['PGRST205', "Ошибка сервера (404): Could not find the table 'public.shopping_items' in the schema cache", "Could not find the table 'public.shopping_items' in the schema cache"],
    ['PGRST204', "Ошибка сервера (400): Could not find the 'foo' column of 'wallets' in the schema cache.", "Could not find the 'foo' column of 'wallets' in the schema cache"],
  ])('нет таблицы или колонки (%s): сказано выполнить supabase/schema.sql, подробность сервера приведена, точки не задваиваются', async (code, message, detail) => {
    const { d, sp } = await ready();
    failWith(sp, new TransportError('server', message, code));
    await d.engine.syncNow();
    const s = d.engine.getStatus();
    expect(s).toMatchObject({ phase: 'error', pending: 1 });
    expect(s.lastError).toBe(`В облаке не хватает таблицы или колонки (код ${code}): ${detail}. Выполните supabase/schema.sql целиком в SQL Editor`);
    expect(s.lastError).not.toMatch(/временно/);
  });

  it('очень длинная подробность от сервера обрезается', async () => {
    const { d, sp } = await ready();
    failWith(sp, new TransportError('server', `Ошибка сервера (400): column "${'x'.repeat(500)}" does not exist`, '42703'));
    await d.engine.syncNow();
    const text = d.engine.getStatus().lastError ?? '';
    expect(text).toContain('…');
    expect(text.length).toBeLessThan(300);
    expect(text).toMatch(/Выполните supabase\/schema\.sql целиком в SQL Editor$/);
  });

  it('после исправления облака (схему выполнили) следующий цикл отправляет запись, ошибка уходит', async () => {
    const { server, d, sp } = await ready();
    failWith(sp, new TransportError('server', 'Ошибка сервера (400): column "foo" does not exist', '42703'));
    await d.engine.syncNow();
    expect(d.engine.getStatus().phase).toBe('error');
    sp.onPush = undefined;
    await d.engine.syncNow();
    expect(d.engine.getStatus()).toMatchObject({ phase: 'idle', pending: 0, lastError: null });
    expect(server.dump(USER, 'wallets')).toHaveLength(2);
  });

  it('запрет по правам (42501) к «не хватает в облаке» не относится: это отказ по данным, запись уходит в карантин, а не в «ошибку облака»', async () => {
    const { d, sp } = await ready();
    failWith(sp, new TransportError('rejected', 'Сервер отверг данные: permission denied', '42501'));
    await d.engine.syncNow();
    const s = d.engine.getStatus();
    expect(s.lastError ?? '').not.toMatch(/не хватает таблицы/);
    expect(s.quarantined).toBe(1);
  });
});
