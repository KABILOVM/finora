import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeLastUser } from '@/auth/lastUser';
import { fakeAuthClient, makeTestDeps, renderAppRoot, type FakeAccount, type FakeAuthOptions, type TestDeps } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { DENIED, NETWORK, PROJECT_URL, U, checkViolation, fakeCloud, gate, type Script } from '@/sync/__fixtures__/diagKit';
import { CloudCheckSection, README_URL } from './CloudCheckSection';
import SettingsPage from './SettingsPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

/** Пользователь, чьи строки лежат в «облаке» тестового набора (id совпадает с U). */
const ME: FakeAccount = { id: U, email: 'me@example.com', password: 'pw-12345678' };

async function openCloud(script: Script = {}, o: { auth?: FakeAuthOptions; td?: TestDeps; bootTimeoutMs?: number; page?: boolean } = {}) {
  const td = o.td ?? makeTestDeps();
  const fake = fakeAuthClient({ accounts: [ME], session: ME, ...o.auth });
  const cloud = fakeCloud(script);
  // вход берём у подмены входа, таблицы — у поддельного облака
  (fake.client as unknown as { from: unknown }).from = cloud.client.from;
  const ui = o.page ? <SettingsPage /> : <CloudCheckSection url={PROJECT_URL} />;
  const view = renderAppRoot(ui, { client: fake.client, deps: td.deps, path: '/settings', bootTimeoutMs: o.bootTimeoutMs });
  await findByRole('heading', { name: 'Проверка облака', level: 2 });
  return { td, fake, cloud, view };
}

const checkButton = () => screen.getByRole('button', { name: 'Проверить' });
async function runCheck() {
  await user.click(checkButton());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Скопировать отчёт' })).toBeInTheDocument(), 5000);
}
const items = () => screen.getAllByRole('listitem');
const itemFor = (title: string) => {
  const li = items().find((x) => x.textContent?.includes(title));
  if (!li) throw new Error(`Нет шага «${title}»`);
  return li;
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Сеть в тестах запрещена')));
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
});

describe('Проверка облака: локальный режим', () => {
  it('объясняет, что облако не подключено, и даёт ссылку «см. README»; кнопки проверки нет', async () => {
    const td = makeTestDeps();
    renderAppRoot(<CloudCheckSection />, { deps: td.deps, path: '/settings' });
    await findByRole('heading', { name: 'Проверка облака', level: 2 });
    expect(screen.getByText(/Облако пока не подключено, поэтому проверять нечего/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'см. README' });
    expect(link).toHaveAttribute('href', README_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(README_URL).toContain('подключение-облака');
    expect(screen.queryByRole('button', { name: 'Проверить' })).toBeNull();
  });

  it('в «Настройках» раздел есть и в локальном режиме, и с облаком', async () => {
    const td = makeTestDeps();
    const local = renderAppRoot(<SettingsPage />, { deps: td.deps, path: '/settings' });
    await findByRole('heading', { name: 'Проверка облака', level: 2 });
    expect(screen.queryByRole('button', { name: 'Проверить' })).toBeNull();
    local.unmount();
    await openCloud({}, { page: true });
    expect(checkButton()).toBeEnabled();
  });
});

describe('Проверка облака: облако подключено', () => {
  it('пока не нажали «Проверить», на сервер никто не ходит и результатов нет', async () => {
    const { cloud } = await openCloud();
    expect(checkButton()).toBeEnabled();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Скопировать отчёт' })).toBeNull();
    expect(cloud.calls.selects).toHaveLength(0);
    expect(cloud.calls.upserts).toHaveLength(0);
  });

  it('всё в порядке: семь шагов с галочками и итог «Все проверки пройдены»', async () => {
    const { cloud } = await openCloud();
    await runCheck();
    expect(items()).toHaveLength(7);
    expect(screen.getByText('Все проверки пройдены')).toBeInTheDocument();
    for (const li of items()) expect(li.textContent).toContain('✔');
    expect(itemFor('Запись данных').textContent).toContain('защита данных работает');
    // по одной заведомо неверной строке в каждую из четырёх таблиц (синхронизация пишет во все)
    expect(cloud.calls.upserts.map((u) => u.table).sort()).toEqual(['categories', 'settings', 'transactions', 'wallets']);
  });

  it('данные берутся из провайдеров: сессия ОТ этого пользователя, в «Данных на устройстве» видны неотправленные записи', async () => {
    await openCloud();
    await runCheck();
    expect(itemFor('Вход в аккаунт').textContent).toContain('Вход выполнен');
    expect(itemFor('Данные на этом устройстве').textContent).toMatch(/Ждут отправки: \d+ /); // затравка ещё не отправлена
  });

  it('ошибка связи: ✖, понятный совет, остальные шаги «–» пропущены', async () => {
    await openCloud({ tables: { settings: NETWORK } });
    await runCheck();
    expect(screen.getByText('Есть ошибки: исправляйте сверху вниз')).toBeInTheDocument();
    expect(itemFor('Связь с сервером').textContent).toContain('✖');
    expect(itemFor('Связь с сервером').textContent).toContain('VITE_SUPABASE_URL');
    expect(itemFor('Вход в аккаунт').textContent).toContain('–');
    expect(itemFor('Вход в аккаунт').textContent).toContain('Пропущено');
  });

  it('замечание: ⚠ и итог «Есть замечания»', async () => {
    await openCloud({ tables: { exchange_rates: { data: [], error: null, status: 200 } } });
    await runCheck();
    expect(screen.getByText('Есть замечания: прочитайте ниже')).toBeInTheDocument();
    expect(itemFor('Курсы валют на сервере').textContent).toContain('⚠');
  });

  it('нет прав записи: ошибка и совет про schema.sql', async () => {
    await openCloud({ upsert: DENIED });
    await runCheck();
    expect(itemFor('Запись данных').textContent).toContain('✖');
    expect(itemFor('Запись данных').textContent).toContain('schema.sql');
  });

  it('вставка внезапно прошла: на экране «Проверка создала лишнюю строку»', async () => {
    await openCloud({ upsert: { data: null, error: null, status: 201 } });
    await runCheck();
    expect(itemFor('Запись данных').textContent).toContain('Проверка создала лишнюю строку');
  });

  it('пока идёт проверка: кнопка занята, повторное нажатие ничего не запускает; шаги появляются после ответа', async () => {
    const g = gate();
    const { cloud } = await openCloud({ tables: { settings: g.reply } });
    await user.click(checkButton());
    await waitFor(() => expect(screen.getByText('Идёт проверка…')).toBeInTheDocument());
    expect(checkButton()).toBeDisabled();
    expect(checkButton()).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(cloud.calls.selects).toHaveLength(1)); // запрос к серверу ушёл и ждёт ответа
    await user.click(checkButton());
    await user.click(checkButton());
    expect(cloud.calls.selects).toHaveLength(1); // одна проверка, а не три
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    g.open();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Скопировать отчёт' })).toBeInTheDocument(), 5000);
    expect(items()).toHaveLength(7);
    expect(screen.queryByText('Идёт проверка…')).toBeNull();
    expect(checkButton()).toBeEnabled();
  });

  it('повторная проверка заменяет старый результат', async () => {
    const { fake } = await openCloud({ tables: { settings: NETWORK } });
    await runCheck();
    expect(itemFor('Связь с сервером').textContent).toContain('✖');
    (fake.client as unknown as { from: unknown }).from = fakeCloud().client.from; // сеть «починилась»
    await runCheck();
    expect(items()).toHaveLength(7);
    expect(itemFor('Связь с сервером').textContent).toContain('✔');
    expect(screen.getByText('Все проверки пройдены')).toBeInTheDocument();
  });

  it('экран закрыли посреди проверки: ничего не падает, предупреждений React нет', async () => {
    const g = gate();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { view } = await openCloud({ tables: { settings: g.reply } });
    await user.click(checkButton());
    await waitFor(() => expect(screen.getByText('Идёт проверка…')).toBeInTheDocument());
    view.unmount();
    g.open();
    await new Promise((r) => setTimeout(r, 50));
    expect(errors).not.toHaveBeenCalled();
  });

  it('приложение открыто без подтверждённого входа (нет сети при старте): шаг «Вход» — замечание', async () => {
    const td = makeTestDeps({ online: false });
    const first = await td.deps.openStore(ME.id);
    await first.sync.setMeta('initialPullDone', true);
    first.close();
    writeLastUser({ id: ME.id, email: ME.email });
    const { fake } = await openCloud({}, { td, auth: { session: null, getSession: 'hang' }, bootTimeoutMs: 40 });
    fake.setSession(ME);
    fake.state.getSession = 'ok';
    await runCheck();
    expect(itemFor('Вход в аккаунт').textContent).toContain('⚠');
    expect(itemFor('Вход в аккаунт').textContent).toContain('ещё не подтвердило вход');
  });
});

describe('Проверка облака: копирование отчёта', () => {
  const REPORT_START = 'Проверка облака Finora';

  it('современный способ: navigator.clipboard.writeText получает весь отчёт', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await openCloud({ tables: { exchange_rates: { data: [], error: null, status: 200 } } });
    await runCheck();
    await user.click(screen.getByRole('button', { name: 'Скопировать отчёт' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text.startsWith(REPORT_START)).toBe(true);
    expect(text).toContain('Итог: есть замечания');
    expect(text).toContain('✔ Связь с сервером');
    expect(text).toContain('⚠ Курсы валют на сервере');
    expect(text).not.toContain(ME.id);
    expect(await waitFor(() => screen.getByText('Отчёт скопирован'))).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Отчёт для копирования' })).toBeNull();
  });

  it('запасной способ: нет navigator.clipboard — копирует через скрытое поле и execCommand', async () => {
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    await openCloud();
    await runCheck();
    await user.click(screen.getByRole('button', { name: 'Скопировать отчёт' }));
    await waitFor(() => expect(exec).toHaveBeenCalledWith('copy'));
    expect(await waitFor(() => screen.getByText('Отчёт скопирован'))).toBeInTheDocument();
    expect(document.querySelectorAll('textarea')).toHaveLength(0); // скрытое поле убрано
  });

  it('writeText отказал (нет разрешения) — переходит на запасной способ', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    const exec = vi.fn(() => true);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    await openCloud();
    await runCheck();
    await user.click(screen.getByRole('button', { name: 'Скопировать отчёт' }));
    await waitFor(() => expect(exec).toHaveBeenCalledWith('copy'));
    expect(await waitFor(() => screen.getByText('Отчёт скопирован'))).toBeInTheDocument();
  });

  it('ничего не сработало: честная ошибка и поле с отчётом, чтобы скопировать вручную', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('нельзя')) } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    await openCloud({ upsert: checkViolation });
    await runCheck();
    await user.click(screen.getByRole('button', { name: 'Скопировать отчёт' }));
    expect(await waitFor(() => screen.getByText(/Не удалось скопировать/))).toBeInTheDocument();
    expect(screen.queryByText('Отчёт скопирован')).toBeNull();
    const box = (await waitFor(() => screen.getByRole('textbox', { name: 'Отчёт для копирования' }))) as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);
    expect(box.value.startsWith(REPORT_START)).toBe(true);
    expect(box.value).toContain('Итог:');
  });
});
