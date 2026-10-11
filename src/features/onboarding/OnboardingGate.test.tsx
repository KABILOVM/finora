import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDeps, renderAppRoot } from '@/app/testkit';
import { LOCAL_USER_ID } from '@/auth/config';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { OnboardingGate } from './OnboardingGate';
import { onboardingKey } from './onboardingStorage';
import { parseProgress } from './onboardingLogic';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => {
  localStorage.clear();
});

const saved = () => parseProgress(localStorage.getItem(onboardingKey(LOCAL_USER_ID)));
const wizard = () => screen.queryByRole('dialog', { name: 'Настройка Finora' });
const click = (el: HTMLElement) => user.click(el);

function renderGate(path = '/') {
  const t = makeTestDeps();
  renderAppRoot(<OnboardingGate />, { path, deps: t.deps });
  return t;
}

async function liveWallets(store: Store) {
  return (await store.db.wallets.toArray()).filter((w) => w.deletedAt === null && w.archivedAt === null);
}

describe('OnboardingGate: когда мастер виден', () => {
  it('новому человеку на «Главной» — стартовый экран «Как начнём?»', async () => {
    renderGate();
    expect(await findByRole('heading', { name: 'Как начнём?' })).toBeInTheDocument();
    expect(wizard()).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Пропустить, настрою сам' })).toBeInTheDocument();
  });

  it('на других адресах (/add, /settings…) не появляется', async () => {
    const t = renderGate('/add');
    await waitFor(() => expect(t.opened).toContain(LOCAL_USER_ID));
    await new Promise((r) => setTimeout(r, 100));
    expect(wizard()).toBeNull();
  });

  it('«Пропустить, настрою сам»: мастер уходит и запоминается', async () => {
    renderGate();
    await click(await findByRole('button', { name: 'Пропустить, настрою сам' }));
    await waitFor(() => expect(wizard()).toBeNull());
    expect(saved()).toMatchObject({ done: true, skipped: true });
  });

  it('старый аккаунт (есть свой кошелёк): мастера нет, отметка «завершено» ставится сама', async () => {
    const t = makeTestDeps();
    // база с чужим кошельком готовится ДО открытия приложения
    const { openStore, ensureSeeded } = await import('@/db');
    const { IDBKeyRange } = await import('fake-indexeddb');
    const pre = await openStore(LOCAL_USER_ID, { deviceId: 'device-test-1', dexie: { indexedDB: t.factory, IDBKeyRange } });
    await ensureSeeded(pre);
    await pre.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 100, color: '#16a34a', icon: '🪙' });
    pre.close();
    renderAppRoot(<OnboardingGate />, { deps: t.deps });
    await waitFor(() => expect(saved()?.done).toBe(true));
    expect(wizard()).toBeNull();
  });

  it('испорченная отметка в localStorage — как её отсутствие', async () => {
    localStorage.setItem(onboardingKey(LOCAL_USER_ID), '{не json');
    renderGate();
    expect(await findByRole('heading', { name: 'Как начнём?' })).toBeInTheDocument();
  });
});

describe('OnboardingGate: шаги', () => {
  it('«Создать с нуля» → валюта → кошельки: стартовый «Наличные» показан, «Дальше» работает', async () => {
    const t = renderGate();
    await click(await findByRole('button', { name: /Создать с нуля/ }));
    expect(await findByRole('heading', { name: 'Основная валюта' })).toBeInTheDocument();
    expect(screen.getByText('Шаг 1 из 5')).toBeInTheDocument();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Дальше' }) as HTMLButtonElement).disabled).toBe(false));
    await click(screen.getByRole('button', { name: 'Дальше' }));
    expect(await findByRole('heading', { name: 'Ваши кошельки' })).toBeInTheDocument();
    expect(screen.getByText('Шаг 2 из 5')).toBeInTheDocument();
    const list = await findByRole('list', { name: 'Заведённые кошельки' });
    expect(list.textContent).toContain('Наличные');
    expect(saved()).toMatchObject({ step: 'wallets', path: 'scratch', done: false });
    expect(await liveWallets(t.stores[0]!)).toHaveLength(1);
  });

  it('шаг кошельков: чип «Карта» → «Добавить кошелёк»; повторное нажатие не создаёт второй', async () => {
    const t = renderGate();
    localStorage.setItem(onboardingKey(LOCAL_USER_ID), JSON.stringify({ v: 1, step: 'wallets', path: 'scratch', done: false, skipped: false, wants: {} }));
    await click(await findByRole('button', { name: 'Карта', pressed: false }));
    const add = screen.getByRole('button', { name: 'Добавить кошелёк' });
    await click(add);
    await waitFor(async () => expect(await liveWallets(t.stores[0]!)).toHaveLength(2));
    // форма очистилась; вписываем то же название ещё раз — понятная ошибка, дубля нет
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'карта');
    await click(screen.getByRole('button', { name: 'Добавить кошелёк' }));
    expect(await findByRole('alert')).toHaveTextContent('Кошелёк с таким названием уже есть');
    expect(await liveWallets(t.stores[0]!)).toHaveLength(2);
  });

  it('убрали все кошельки: «Дальше» выключено и сказано почему', async () => {
    const t = renderGate();
    localStorage.setItem(onboardingKey(LOCAL_USER_ID), JSON.stringify({ v: 1, step: 'wallets', path: 'scratch', done: false, skipped: false, wants: {} }));
    await click(await findByRole('button', { name: 'Убрать «Наличные»' }));
    await waitFor(async () => expect(await liveWallets(t.stores[0]!)).toHaveLength(0));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Дальше' }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText('Добавьте хотя бы один кошелёк.')).toBeInTheDocument();
  });

  it('категории: снятая галочка прячет категорию (архив), поставленная возвращает', async () => {
    const t = renderGate();
    localStorage.setItem(onboardingKey(LOCAL_USER_ID), JSON.stringify({ v: 1, step: 'categories', path: 'scratch', done: false, skipped: false, wants: {} }));
    const food = await findByRole('button', { name: 'Еда' });
    expect(food.getAttribute('aria-pressed')).toBe('true');
    await click(food);
    await waitFor(async () => {
      const row = (await t.stores[0]!.db.categories.toArray()).find((c) => c.name === 'Еда');
      expect(row?.archivedAt).not.toBeNull();
    });
    await click(await findByRole('button', { name: 'Еда', pressed: false }));
    await waitFor(async () => {
      const row = (await t.stores[0]!.db.categories.toArray()).find((c) => c.name === 'Еда');
      expect(row?.archivedAt).toBeNull();
    });
  });

  it('включения: переключатель запоминает выбор; сводка называет, что настроить в Настройках', async () => {
    renderGate();
    localStorage.setItem(onboardingKey(LOCAL_USER_ID), JSON.stringify({ v: 1, step: 'extras', path: 'scratch', done: false, skipped: false, wants: {} }));
    const lock = await findByRole('switch', { name: 'Замок Face ID' });
    await click(lock);
    expect(saved()?.wants).toMatchObject({ lock: true, reminders: false });
    await click(screen.getByRole('button', { name: 'Дальше' }));
    expect(await findByRole('heading', { name: 'Готово!' })).toBeInTheDocument();
    expect(screen.getByText(/замок Face ID/)).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-testid="onb-wallet-count"]')?.textContent).toBe('1 кошелёк'));
  });

  it('«На главную» завершает мастер', async () => {
    renderGate();
    localStorage.setItem(onboardingKey(LOCAL_USER_ID), JSON.stringify({ v: 1, step: 'finish', path: 'scratch', done: false, skipped: false, wants: {} }));
    await click(await findByRole('button', { name: 'На главную' }));
    await waitFor(() => expect(wizard()).toBeNull());
    expect(saved()?.done).toBe(true);
  });
});
