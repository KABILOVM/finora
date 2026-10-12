import { LOCAL_USER_ID } from '@/auth/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOB, eventually, makeTestDeps, pick, renderAppRoot, write, type TestDeps } from '@/app/testkit';
import { fire, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { exportBackup } from '@/db';
import { makeTable, NOW, ok, setup, stubProvider, fail } from '@/rates/__fixtures__/testkit';
import type { RateService } from '@/rates/types';
import { version } from '../../../package.json';
import { readFileText } from './download';
import SettingsPage from './SettingsPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const store = (td: TestDeps) => {
  const s = td.stores[0];
  if (!s) throw new Error('Хранилище не открыто');
  return s;
};

/** Экран «Настройки» в локальном режиме; service — тот самый сервис курсов, которым пользуется экран. */
async function openSettings(options: { rates?: RateService; td?: TestDeps } = {}) {
  const td = options.td ?? makeTestDeps();
  if (options.rates) td.deps.createRates = () => options.rates as RateService;
  renderAppRoot(<SettingsPage />, { deps: td.deps, path: '/settings' });
  await findByRole('heading', { name: 'Настройки', level: 1 });
  await waitFor(() => expect(td.stores.length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getByText(/Основная валюта/)).toBeInTheDocument());
  await eventually(async () => expect((screen.getByRole('combobox', { name: /Основная валюта/ }) as HTMLSelectElement).value).toBe('TJS'));
  return td;
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Сеть в тестах запрещена')));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'storage');
});

describe('Настройки: общий вид (локальный режим)', () => {
  it('только нужное: оформление, валюта, копия, категории; версия берётся из package.json', async () => {
    await openSettings();
    for (const name of ['Оформление', 'Валюта учёта', 'Резервная копия']) {
      expect(screen.getByRole('heading', { name, level: 2 })).toBeInTheDocument();
    }
    expect(screen.getByText(new RegExp(`Sumoima ${version.replace(/\./g, '\\.')} `))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Категории/ })).toHaveAttribute('href', '/settings/categories');
  });

  it('лишнего нет: облака и входа в локальном режиме не видно, технических разделов нет вовсе', async () => {
    await openSettings();
    for (const name of ['Аккаунт', 'Синхронизация', 'Проверка облака', 'Проверка данных', 'Хранилище', 'Установка на телефон', 'О приложении']) {
      expect(screen.queryByRole('heading', { name, level: 2 })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: 'Синхронизировать сейчас' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Выйти' })).toBeNull();
    expect(screen.queryByText(/Дополнительно/)).toBeNull();
  });
});

describe('Настройки: валюта учёта', () => {
  it('смена только после подтверждения, текст честно объясняет последствия', async () => {
    const td = await openSettings();
    pick(screen.getByRole('combobox', { name: /Основная валюта/ }), 'USD');
    const dialog = await findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Сменить валюту учёта на USD?');
    expect(dialog).toHaveTextContent('Старые операции остаются в TJS');
    expect(dialog).toHaveTextContent('не пересчитываются');
    expect((await store(td).settings.get())?.baseCurrency).toBe('TJS'); // пока не подтвердили — не изменилось
    await user.click(screen.getByRole('button', { name: 'Сменить' }));
    await eventually(async () => expect((await store(td).settings.get())?.baseCurrency).toBe('USD'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('«Отмена» оставляет прежнюю валюту', async () => {
    const td = await openSettings();
    pick(screen.getByRole('combobox', { name: /Основная валюта/ }), 'EUR');
    await findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((await store(td).settings.get())?.baseCurrency).toBe('TJS');
    expect((screen.getByRole('combobox', { name: /Основная валюта/ }) as HTMLSelectElement).value).toBe('TJS');
  });
});

describe('Настройки: курсы валют', () => {
  const usdWallet = {
    name: 'Доллары',
    currency: 'USD',
    kind: 'cash' as const,
    openingBalanceMinor: 0,
    color: '#2563eb',
    icon: '💲',
  };

  it('все кошельки в базовой валюте — курсы не нужны, раздела нет', async () => {
    await openSettings();
    expect(screen.queryByRole('heading', { name: 'Курсы валют', level: 2 })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Обновить курсы' })).toBeNull();
  });

  it('нет курса → «курса нет»; ручной курс сохраняется через сервис и показывается как «задан вручную»', async () => {
    const { service } = setup([], { now: () => NOW });
    const td = await openSettings({ rates: service });
    await write(() => store(td).wallets.create(usdWallet));
    await waitFor(() => expect(screen.getByText('USD: курса нет')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Свой курс USD' }));
    await findByRole('dialog', { name: 'Курс USD → TJS' });
    await user.type(screen.getByRole('textbox', { name: /Сколько TJS стоит 1 USD/ }), '10,9');
    await user.click(screen.getByRole('button', { name: 'Сохранить курс' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 10.9, manual: true, source: 'manual' });
    await waitFor(() => expect(screen.getByText(/1 USD = 10,9 с\./)).toBeInTheDocument());
    expect(screen.getByText(/задан вручную/)).toBeInTheDocument();
  });

  it('некорректный ручной курс не сохраняется; сообщение у поля', async () => {
    const { service } = setup([], { now: () => NOW });
    const td = await openSettings({ rates: service });
    await write(() => store(td).wallets.create(usdWallet));
    await waitFor(() => expect(screen.getByText('USD: курса нет')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Свой курс USD' }));
    await findByRole('dialog', { name: 'Курс USD → TJS' });
    for (const bad of ['0', 'abc', '-3', '1e5']) {
      await user.clear(screen.getByRole('textbox', { name: /Сколько TJS стоит 1 USD/ }));
      await user.type(screen.getByRole('textbox', { name: /Сколько TJS стоит 1 USD/ }), bad);
      await user.click(screen.getByRole('button', { name: 'Сохранить курс' }));
      expect(await waitFor(() => screen.getByText('Введите курс числом больше нуля, например 10,9'))).toBeInTheDocument();
      expect(service.getRate('USD', 'TJS')).toBeNull();
    }
  });

  it('свой курс можно убрать: снова курс из сети', async () => {
    const { service } = setup([stubProvider('nbt', ok())], { now: () => NOW });
    await service.refresh(); // курс сети 10,95
    service.setManualRate('USD', 'TJS', 11.5);
    const td = await openSettings({ rates: service });
    await write(() => store(td).wallets.create(usdWallet));
    await waitFor(() => expect(screen.getByText(/1 USD = 11,5 с\./)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Свой курс USD' }));
    await findByRole('dialog', { name: 'Курс USD → TJS' });
    await user.click(screen.getByRole('button', { name: 'Убрать свой курс' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 10.95, manual: false, source: 'nbt' });
    await waitFor(() => expect(screen.getByText(/1 USD = 10,95 с\./)).toBeInTheDocument());
    expect(screen.getByText(/Нацбанк Таджикистана/)).toBeInTheDocument();
  });

  it('устаревший курс (старше 3 суток) помечен предупреждением', async () => {
    const { service } = setup([stubProvider('nbt', ok({ asOf: '2026-10-01' }))], { now: () => NOW });
    await service.refresh();
    const td = await openSettings({ rates: service });
    await write(() => store(td).wallets.create(usdWallet));
    await waitFor(() => expect(screen.getByText(/Курс устарел/)).toBeInTheDocument());
    expect(screen.getByText(/· устарел/)).toBeInTheDocument();
  });

  it('«Обновить курсы»: успех → курс появляется; провал → честное сообщение, прежние курсы остаются', async () => {
    // (при открытии экрана сервис и сам пробует обновиться — поэтому сеть «включаем» флагом, а не счётчиком попыток)
    let failing = true;
    const provider = stubProvider('nbt', () => {
      if (failing) throw new Error('нет связи');
      return makeTable();
    });
    const { service } = setup([provider], { now: () => NOW });
    const td = await openSettings({ rates: service });
    await write(() => store(td).wallets.create(usdWallet));
    await waitFor(() => expect(screen.getByText('USD: курса нет')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Обновить курсы' }));
    expect(await waitFor(() => screen.getByText(/Не удалось обновить курсы: нет связи\. Остались прежние\./))).toBeInTheDocument();
    expect(screen.getByText('USD: курса нет')).toBeInTheDocument();
    expect(screen.getByText(/Последняя попытка не удалась/)).toBeInTheDocument();

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Обновить курсы' }));
    await waitFor(() => expect(screen.getByText(/1 USD = 10,95 с\./)).toBeInTheDocument());
    expect(screen.getByText('Курсы обновлены')).toBeInTheDocument();
  });

  it('когда курсы ни разу не получилось обновить — сервис не падает, экран спокоен', async () => {
    const { service } = setup([stubProvider('nbt', fail('таймаут'))], { now: () => NOW });
    const td = await openSettings({ rates: service });
    await write(() => store(td).wallets.create(usdWallet));
    await waitFor(() => expect(screen.getByText('Обновлены: ещё нет')).toBeInTheDocument());
  });
});

describe('Настройки: резервная копия', () => {
  let blobs: Blob[];
  let downloads: { name: string; href: string }[];

  beforeEach(() => {
    blobs = [];
    downloads = [];
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      blobs.push(b as Blob);
      return `blob:test-${blobs.length}`;
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, href: this.href });
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  function chooseFile(contents: string, name = 'копия.json') {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Нет поля выбора файла');
    const file = new File([contents], name, { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fire(input, new Event('change', { bubbles: true }));
  }

  it('«Сохранить копию» отдаёт файл sumoima-backup-ГГГГ-ММ-ДД.json с полными данными', async () => {
    const td = await openSettings();
    await user.click(screen.getByRole('button', { name: 'Сохранить копию' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.name).toMatch(/^sumoima-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(downloads[0]?.href).toBe('blob:test-1');
    const parsed = JSON.parse(await readFileText(blobs[0] as Blob)) as Awaited<ReturnType<typeof exportBackup>>;
    expect(parsed.format).toBeTruthy();
    expect(parsed.wallets.map((w) => w.name)).toEqual(['Наличные']);
    expect(parsed.settings?.baseCurrency).toBe('TJS');
    expect(parsed.categories.length).toBeGreaterThan(5);
    expect(td.stores).toHaveLength(1);
  });

  it('«Операции в таблицу (CSV)» отдаёт файл .csv', async () => {
    const td = await openSettings();
    const cash = (await store(td).db.wallets.toArray())[0];
    await write(() => store(td).transactions.create({ kind: 'expense', walletId: cash?.id ?? '', amountMinor: 12_345, occurredOn: '2026-10-05', note: 'хлеб' }));
    await user.click(screen.getByRole('button', { name: 'Операции в таблицу (CSV)' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.name).toMatch(/^sumoima-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFileText(blobs[0] as Blob);
    expect(csv).toContain('хлеб');
    expect(csv).toContain('123,45');
  });

  it('выгрузка не удалась → понятная ошибка, ничего не скачано', async () => {
    const td = await openSettings();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(store(td).db, 'transaction').mockRejectedValue(new Error('IDB упал'));
    await user.click(screen.getByRole('button', { name: 'Сохранить копию' }));
    expect(await findByRole('alert')).toHaveTextContent('Не удалось подготовить файл');
    expect(downloads).toHaveLength(0);
  });

  it('файл не JSON → «не копия Sumoima», данные не тронуты, окно подтверждения не открывается', async () => {
    const td = await openSettings();
    const before = await store(td).db.wallets.count();
    chooseFile('это просто текст, а не копия');
    expect(await findByRole('alert')).toHaveTextContent('это не копия Sumoima');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Загрузить копию?' })).toBeNull();
    expect(await store(td).db.wallets.count()).toBe(before);
  });

  it('JSON, но не копия Sumoima → после подтверждения понятная ошибка, данные не изменены', async () => {
    const td = await openSettings();
    const before = JSON.stringify(await store(td).db.wallets.toArray());
    chooseFile(JSON.stringify({ hello: 'world' }));
    await findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Загрузить' }));
    const alert = await findByRole('alert');
    expect(alert.textContent ?? '').not.toBe('');
    expect((alert.textContent ?? '').replace(/Sumoima/g, '')).not.toMatch(/[A-Za-z]{5,}/); // без английских технических слов
    expect(JSON.stringify(await store(td).db.wallets.toArray())).toBe(before);
    expect(screen.queryByText('Копия загружена')).toBeNull();
  });

  it('копия другого аккаунта: отдельный вопрос; «Отмена» — ничего не загружено', async () => {
    const td = await openSettings();
    const other = await td.deps.openStore(BOB.id);
    await other.settings.ensure({ baseCurrency: 'TJS' });
    await other.wallets.create({ name: 'Чужой', currency: 'TJS', kind: 'cash', openingBalanceMinor: 1, color: '#000000', icon: '💰' });
    const foreign = JSON.stringify(await exportBackup(other));
    other.close();
    chooseFile(foreign, 'чужая.json');
    const dialog = await findByRole('alertdialog', { name: 'Копия из другого аккаунта' });
    expect(dialog).toHaveTextContent('чужая.json');
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((await store(td).db.wallets.toArray()).map((w) => w.name)).toEqual(['Наличные']);
    expect(screen.queryByText('Копия загружена')).toBeNull();
  });

  it('копия другого аккаунта после согласия добавляется к данным, настройки текущего аккаунта не меняются', async () => {
    const td = await openSettings();
    const other = await td.deps.openStore(BOB.id);
    await other.settings.ensure({ baseCurrency: 'USD' });
    await other.wallets.create({ name: 'Из другого аккаунта', currency: 'TJS', kind: 'cash', openingBalanceMinor: 7, color: '#000000', icon: '💰' });
    const foreign = JSON.stringify(await exportBackup(other));
    other.close();
    chooseFile(foreign);
    await findByRole('alertdialog', { name: 'Копия из другого аккаунта' });
    await user.click(screen.getByRole('button', { name: 'Загрузить в этот аккаунт' }));
    await waitFor(() => expect(screen.getByText('Копия загружена')).toBeInTheDocument());
    expect((await store(td).db.wallets.toArray()).map((w) => w.name).sort()).toEqual(['Из другого аккаунта', 'Наличные']);
    expect((await store(td).settings.get())?.baseCurrency).toBe('TJS');
  });

  it('слишком большой файл отвергается до чтения', async () => {
    await openSettings();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const big = new File(['x'], 'огромный.json');
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [big], configurable: true });
    fire(input as HTMLInputElement, new Event('change', { bubbles: true }));
    expect(await findByRole('alert')).toHaveTextContent('слишком большой');
  });

  it('своя копия: подтверждение → отчёт «добавлено / обновлено»', async () => {
    const td = await openSettings();
    const s = store(td);
    await write(() => s.wallets.create({ name: 'Накопления', currency: 'TJS', kind: 'savings', openingBalanceMinor: 9_000, color: '#7c3aed', icon: '🪙' }));
    const backup = JSON.stringify(await exportBackup(s));
    // после снимка появляется ещё один кошелёк — его в копии нет, он должен остаться
    await write(() => s.wallets.create({ name: 'Новее копии', currency: 'TJS', kind: 'cash', openingBalanceMinor: 1, color: '#000000', icon: '💰' }));
    chooseFile(backup, 'моя.json');

    const confirm = await findByRole('alertdialog');
    expect(confirm).toHaveTextContent('моя.json');
    expect(confirm).toHaveTextContent('побеждает более новая версия, ничего не удаляется');
    await user.click(screen.getByRole('button', { name: 'Загрузить' }));

    const report = await findByRole('status', { name: undefined });
    await waitFor(() => expect(screen.getByText('Копия загружена')).toBeInTheDocument());
    expect(report).toBeTruthy();
    expect(screen.getByText(/Добавлено: 0 · обновлено: 0/)).toBeInTheDocument();
    expect((await s.db.wallets.toArray()).map((w) => w.name).sort()).toEqual(['Накопления', 'Наличные', 'Новее копии']);
  });

  it('копия на пустое устройство (другой телефон того же пользователя) добавляет записи и помечает их к отправке', async () => {
    const source = makeTestDeps();
    renderAppRoot(<SettingsPage />, { deps: source.deps, path: '/settings' });
    await waitFor(() => expect(source.stores.length).toBe(1));
    await eventually(async () => expect(await source.stores[0]?.settings.get()).not.toBeNull());
    await write(() =>
      (source.stores[0] as NonNullable<(typeof source.stores)[number]>).wallets.create({
        name: 'С другого телефона',
        currency: 'TJS',
        kind: 'cash',
        openingBalanceMinor: 5,
        color: '#000000',
        icon: '💰',
      }),
    );
    const json = JSON.stringify(await exportBackup(source.stores[0] as NonNullable<(typeof source.stores)[number]>));
    // чистое «устройство»: пустая база того же пользователя
    const targetDeps = makeTestDeps();
    const empty = await targetDeps.deps.openStore(LOCAL_USER_ID);
    empty.close();
    document.body.innerHTML = '';
    renderAppRoot(<SettingsPage />, { deps: targetDeps.deps, path: '/settings' });
    await findByRole('heading', { name: 'Настройки', level: 1 });
    await eventually(async () => expect(await targetDeps.stores.at(-1)?.settings.get()).not.toBeNull());
    chooseFile(json);
    await findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(screen.getByText('Копия загружена')).toBeInTheDocument());
    const names = (await targetDeps.stores.at(-1)?.db.wallets.toArray())?.map((w) => w.name);
    expect(names).toContain('С другого телефона');
  });
});
