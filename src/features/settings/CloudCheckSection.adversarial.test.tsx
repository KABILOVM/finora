import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAuthClient, makeTestDeps, renderAppRoot, type FakeAccount } from '@/app/testkit';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { PROJECT_URL, U, fakeCloud, type Script } from '@/sync/__fixtures__/diagKit';
import { CloudCheckSection } from './CloudCheckSection';

/**
 * Состязательные проверки экрана «Проверка облака»: может ли он сказать «Все проверки пройдены» при опасной настройке,
 * выдать лишнее в отчёте или сломаться от быстрых нажатий.
 */

const ME: FakeAccount = { id: U, email: 'me@example.com', password: 'pw-12345678' };

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Ключ старого образца: JWT с ролью. service_role открывает ВСЮ базу, в браузер его класть нельзя. */
const legacyKey = (role: 'anon' | 'service_role') => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', ref: 'abcdefgh', role, iat: 1, exp: 2000000000 })}.c2lnbmF0dXJl`;

async function openCloud(script: Script = {}) {
  const td = makeTestDeps();
  const fake = fakeAuthClient({ accounts: [ME], session: ME });
  const cloud = fakeCloud(script);
  (fake.client as unknown as { from: unknown }).from = cloud.client.from;
  renderAppRoot(<CloudCheckSection url={PROJECT_URL} />, { client: fake.client, deps: td.deps, path: '/settings' });
  await findByRole('heading', { name: 'Проверка облака', level: 2 });
  return { cloud, td };
}
const finish = () => waitFor(() => expect(screen.getByRole('button', { name: 'Скопировать отчёт' })).toBeInTheDocument(), 5000);

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Сеть в тестах запрещена')));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('CloudCheckSection: опасный ключ', () => {
  it('контроль: с обычным anon-ключом всё хорошо', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', PROJECT_URL);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', legacyKey('anon'));
    await openCloud();
    await user.click(screen.getByRole('button', { name: 'Проверить' }));
    await finish();
    expect(screen.getByText('Все проверки пройдены')).toBeInTheDocument();
  });

  it('в VITE_SUPABASE_ANON_KEY лежит ключ service_role (открывает всю базу, попадает в публичную сборку): проверка обязана тревожить', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', PROJECT_URL);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', legacyKey('service_role'));
    await openCloud();
    await user.click(screen.getByRole('button', { name: 'Проверить' }));
    await finish();
    expect(screen.queryByText('Все проверки пройдены'), 'проверка показала зелёный итог при ключе service_role').toBeNull();
    expect(document.body.textContent).toMatch(/service_role/);
  });
});

describe('CloudCheckSection: отчёт и быстрые нажатия', () => {
  it('контроль: в скопированном отчёте нет ключа, почты и id пользователя', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', PROJECT_URL);
    const key = legacyKey('anon');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', key);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await openCloud({ tables: { exchange_rates: { data: [], error: null, status: 200 } } });
    await user.click(screen.getByRole('button', { name: 'Проверить' }));
    await finish();
    await user.click(screen.getByRole('button', { name: 'Скопировать отчёт' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    for (const secret of [key, ME.email, ME.password, ME.id]) expect(text).not.toContain(secret);
  });

  it('контроль: два нажатия «Проверить» в одном такте — одна серия пробных записей (по строке на таблицу), а не две', async () => {
    const { cloud } = await openCloud();
    const btn = screen.getByRole('button', { name: 'Проверить' });
    act(() => {
      btn.click();
      btn.click();
      btn.click();
    });
    await finish();
    expect(cloud.calls.upserts).toHaveLength(4);
    expect(cloud.calls.selects.filter((s) => s.table === 'settings')).toHaveLength(1);
  });
});
