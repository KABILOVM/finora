import { afterEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.hoisted(() => vi.fn(() => ({ auth: {} })));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { AUTH_STORAGE_KEY, createFinoraClient } from './supabaseClient';

afterEach(() => createClient.mockClear());

describe('createFinoraClient', () => {
  it('настройки входа: сессия хранится и обновляется сама, адрес страницы не разбирается, ключ finora-auth', () => {
    createFinoraClient({ url: 'https://abc.supabase.co', anonKey: 'sb_publishable_k' });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith('https://abc.supabase.co', 'sb_publishable_k', {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'finora-auth' },
    });
    expect(AUTH_STORAGE_KEY).toBe('finora-auth');
  });

  it('Realtime не включается: в настройках клиента нет разделов realtime', () => {
    createFinoraClient({ url: 'https://abc.supabase.co', anonKey: 'k' });
    const options = (createClient.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2];
    expect(Object.keys(options)).toEqual(['auth']);
  });
});
