/**
 * ЛОМАТЕЛЬ: Настройки. Каждый тест — попытка доказать поломку. Падающий тест = находка.
 */
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_USER_ID } from '@/auth/config';
import { ALICE, BOB, eventually, fakeAuthClient, makeTestDeps, renderAppRoot, write, type TestDeps } from '@/app/testkit';
import { fire, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { syncBadgeText } from '@/components/SyncBadge';
import { exportBackup } from '@/db';
import { NOW, setup } from '@/rates/__fixtures__/testkit';
import type { SyncStatus } from '@/sync/transport';
import { describeSync } from './syncText';
import { parseRateInput } from './rateInput';
import SettingsPage from './SettingsPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Сеть в тестах запрещена')));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PHASES: SyncStatus['phase'][] = ['idle', 'syncing', 'offline', 'error', 'auth-required'];

describe('ATTACK: ложное «Всё отправлено / Синхронизировано»', () => {
  it('СВОЙСТВО: пока есть неотправленное, отвергнутое или фаза не idle, ни бейдж, ни раздел не говорят «отправлено»', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PHASES),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        fc.option(fc.constant('2026-10-10T08:00:00.000Z'), { nil: null }),
        fc.option(fc.constant('boom'), { nil: null }),
        (phase, pending, quarantined, lastSyncedAt, lastError) => {
          const status: SyncStatus = { phase, pending, quarantined, lastSyncedAt, lastError };
          const truthy = phase === 'idle' && pending === 0 && quarantined === 0;
          const badge = syncBadgeText(phase, pending, quarantined);
          const d = describeSync(status);
          const claims = /Синхронизировано/.test(badge) || /Всё отправлено/.test(d.headline);
          if (!truthy) expect(claims, `${JSON.stringify(status)} → «${badge}» / «${d.headline}»`).toBe(false);
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe('ATTACK: ручной курс', () => {
  it('открыть окно «Свой курс» и нажать «Сохранить», ничего не меняя, НЕ должно менять курс (10,123456 → 10,1235)', async () => {
    const { service } = setup([], { now: () => NOW });
    service.setManualRate('USD', 'TJS', 10.123456);
    const td = makeTestDeps();
    td.deps.createRates = () => service;
    renderAppRoot(<SettingsPage />, { deps: td.deps, path: '/settings' });
    await findByRole('heading', { name: 'Настройки', level: 1 });
    await waitFor(() => expect(td.stores.length).toBeGreaterThan(0));
    await eventually(async () => expect((screen.getByRole('combobox', { name: /Основная валюта/ }) as HTMLSelectElement).value).toBe('TJS'));
    await write(() =>
      (td.stores[0] as NonNullable<TestDeps['stores'][number]>).wallets.create({
        name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '💲',
      }),
    );
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Свой курс USD' })));
    await findByRole('dialog', { name: 'Курс USD → TJS' });
    await user.click(screen.getByRole('button', { name: 'Сохранить курс' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.123456);
  });

  it('СВОЙСТВО: всё, что принял parseRateInput, — конечное число в границах и равно записанному человеком', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 24 }), (s) => {
        const n = parseRateInput(s);
        if (n === null) return;
        expect(Number.isFinite(n) && n > 0).toBe(true);
        expect(n).toBe(Number(s.replace(/[\s  ]/g, '').replace(',', '.')));
      }),
      { numRuns: 3000 },
    );
    for (const bad of ['', ' ', ',', '.', '1,,5', '1.2.3', '1e3', '0x10', 'Infinity', '٣', '१', '10,9 с.', '1_000', '+5', '--5']) {
      expect(parseRateInput(bad), `«${bad}» не должно приниматься`).toBeNull();
    }
  });
});

/**
 * Кнопка «Загрузить копию» глазами человека. Сама функция importBackup (договор, src/db) по-прежнему отвергает копию с
 * блоком настроек чужого аккаунта — поэтому приложение обязано довести такую копию до загрузки само, с согласия человека.
 */
function chooseFile(contents: string, name = 'копия.json') {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('Нет поля выбора файла');
  Object.defineProperty(input, 'files', { value: [new File([contents], name, { type: 'application/json' })], configurable: true });
  fire(input, new Event('change', { bubbles: true }));
}

async function openCloudSettings(td: TestDeps, account = ALICE) {
  const fake = fakeAuthClient({ session: account });
  renderAppRoot(<SettingsPage />, { client: fake.client, deps: td.deps, path: '/settings' });
  await findByRole('heading', { name: 'Настройки', level: 1 });
  await waitFor(() => expect(td.stores.length).toBeGreaterThan(0));
  const store = () => td.stores.at(-1) as NonNullable<TestDeps['stores'][number]>;
  await eventually(async () => expect(await store().settings.get()).not.toBeNull());
  return store;
}

describe('ATTACK: восстановление копии в пересозданный аккаунт', () => {
  it('копия, скачанная приложением из СТАРОГО аккаунта, загружается в новый аккаунт того же человека (иначе данные потеряны)', async () => {
    const td = makeTestDeps();
    const old = await td.deps.openStore(ALICE.id);
    await old.settings.ensure({ baseCurrency: 'USD' });
    await old.wallets.create({ name: 'Накопления', currency: 'TJS', kind: 'savings', openingBalanceMinor: 500_000, color: '#7c3aed', icon: '🪙' });
    const file = JSON.stringify(await exportBackup(old));
    old.close();

    // владелец удалил пользователя и создал заново: новый id (BOB здесь — «тот же человек» под новым id)
    const store = await openCloudSettings(td, BOB);
    chooseFile(file, 'старая.json');
    const dialog = await findByRole('alertdialog', { name: 'Копия из другого аккаунта' });
    expect(dialog).toHaveTextContent('Если файл не ваш — нажмите «Отмена»');
    await user.click(screen.getByRole('button', { name: 'Загрузить в этот аккаунт' }));

    await waitFor(() => expect(screen.getByText('Копия загружена')).toBeInTheDocument());
    expect(screen.getByText(/Основная валюта и кошелёк по умолчанию из файла не переносились/)).toBeInTheDocument();
    const saved = (await store().db.wallets.toArray()).find((w) => w.name === 'Накопления');
    expect(saved?.openingBalanceMinor).toBe(500_000);
    expect(saved?.dirty).toBe(1); // уйдёт в облако
    // настройки нового аккаунта не тронуты: основная валюта осталась TJS, а не USD из старой копии
    expect((await store().settings.get())?.baseCurrency).toBe('TJS');
    expect((await store().settings.get())?.id).toBe(BOB.id);
  });

  it('если человек нажал «Отмена», ничего не загружается', async () => {
    const td = makeTestDeps();
    const old = await td.deps.openStore(ALICE.id);
    await old.settings.ensure({ baseCurrency: 'TJS' });
    await old.wallets.create({ name: 'Чужой', currency: 'TJS', kind: 'cash', openingBalanceMinor: 1, color: '#000000', icon: '💰' });
    const file = JSON.stringify(await exportBackup(old));
    old.close();
    const store = await openCloudSettings(td, BOB);
    const before = (await store().db.wallets.toArray()).map((w) => w.name);
    chooseFile(file);
    await findByRole('alertdialog', { name: 'Копия из другого аккаунта' });
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((await store().db.wallets.toArray()).map((w) => w.name)).toEqual(before);
    expect(screen.queryByText('Копия загружена')).toBeNull();
  });

  it('копия СВОЕГО аккаунта грузится как раньше, без лишних вопросов про «другой аккаунт»', async () => {
    const td = makeTestDeps();
    const store = await openCloudSettings(td, ALICE);
    const file = JSON.stringify(await exportBackup(store()));
    chooseFile(file);
    const dialog = await findByRole('alertdialog', { name: 'Загрузить копию?' });
    expect(dialog).not.toHaveTextContent('другом аккаунте');
  });

  it('испорченный блок настроек (id не UUID) НЕ выдаётся за «другой аккаунт»: файл отвергается, ничего не загружено', async () => {
    const td = makeTestDeps();
    const store = await openCloudSettings(td, ALICE);
    const file = JSON.parse(JSON.stringify(await exportBackup(store()))) as { settings: { id: string } };
    file.settings.id = 'не-uuid';
    const before = await store().db.wallets.count();
    chooseFile(JSON.stringify(file));
    await findByRole('alertdialog', { name: 'Загрузить копию?' });
    await user.click(screen.getByRole('button', { name: 'Загрузить' }));
    expect(await findByRole('alert')).toHaveTextContent('UUID');
    expect(await store().db.wallets.count()).toBe(before);
  });
});

describe('ATTACK: данные, начатые без облака (локальный режим), нельзя перенести в облачный аккаунт', () => {
  it('копия из локального режима загружается в аккаунт после подключения облака', async () => {
    const td = makeTestDeps();
    const local = await td.deps.openStore(LOCAL_USER_ID);
    await local.settings.ensure({ baseCurrency: 'TJS' });
    await local.wallets.create({ name: 'Мои наличные', currency: 'TJS', kind: 'cash', openingBalanceMinor: 12_300, color: '#16a34a', icon: '💵' });
    const file = JSON.stringify(await exportBackup(local));
    local.close();

    const store = await openCloudSettings(td, ALICE);
    chooseFile(file, 'локальная.json');
    await findByRole('alertdialog', { name: 'Копия из другого аккаунта' });
    await user.click(screen.getByRole('button', { name: 'Загрузить в этот аккаунт' }));
    await waitFor(() => expect(screen.getByText('Копия загружена')).toBeInTheDocument());
    const mine = (await store().db.wallets.toArray()).find((w) => w.name === 'Мои наличные');
    expect(mine?.openingBalanceMinor).toBe(12_300);
  });

  it('повторная загрузка того же файла не задваивает деньги', async () => {
    const td = makeTestDeps();
    const local = await td.deps.openStore(LOCAL_USER_ID);
    await local.settings.ensure({ baseCurrency: 'TJS' });
    const w = await local.wallets.create({ name: 'Мои наличные', currency: 'TJS', kind: 'cash', openingBalanceMinor: 12_300, color: '#16a34a', icon: '💵' });
    await local.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 500, occurredOn: '2026-10-05' });
    const file = JSON.stringify(await exportBackup(local));
    local.close();

    const store = await openCloudSettings(td, ALICE);
    for (let n = 0; n < 2; n++) {
      chooseFile(file);
      await findByRole('alertdialog', { name: 'Копия из другого аккаунта' });
      await user.click(screen.getByRole('button', { name: 'Загрузить в этот аккаунт' }));
      await waitFor(() => expect(screen.getByText('Копия загружена')).toBeInTheDocument());
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    }
    expect((await store().db.transactions.toArray()).filter((t) => t.walletId === w.id)).toHaveLength(1);
    expect((await store().db.wallets.toArray()).filter((x) => x.name === 'Мои наличные')).toHaveLength(1);
  });
});
