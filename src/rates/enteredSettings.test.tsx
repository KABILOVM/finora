import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAppRoot, makeTestDeps, write, type TestDeps } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import SettingsPage from '@/features/settings/SettingsPage';
import { pinToday, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { NOW, ok, setup, stubProvider } from './__fixtures__/testkit';
import { dayMonth, enteredLabel, enteredNote, enteredPhrase } from './enteredText';
import type { RateService } from './types';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

/** Настройки → Курсы валют: список курсов, введённых в операциях, и кнопка «Сбросить». */

const usdWallet = { name: 'Доллары', currency: 'USD', kind: 'cash' as const, openingBalanceMinor: 0, color: '#2563eb', icon: '💲' };

async function openSettings(rates: RateService) {
  const td: TestDeps = makeTestDeps();
  td.deps.createRates = () => rates;
  renderAppRoot(<SettingsPage />, { deps: td.deps, path: '/settings' });
  await findByRole('heading', { name: 'Настройки', level: 1 });
  await waitFor(() => expect(td.stores.length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getByText(/Основная валюта/)).toBeInTheDocument());
  return td;
}

const entered = () => document.querySelector<HTMLElement>('[data-testid="entered-rates"]');

describe('Настройки: введённые в операциях курсы', () => {
  beforeEach(() => {
    pinToday(); // «сегодня» 15.10.2026: год в подписи даты не показывается
    vi.stubGlobal('fetch', () => Promise.reject(new Error('Сеть в тестах запрещена')));
  });
  afterEach(() => {
    unpinToday();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('пока ни одного нет — блока нет', async () => {
    const { service } = setup([], { now: () => NOW });
    await openSettings(service);
    expect(entered()).toBeNull();
  });

  it('введённый курс виден с датой, «Сбросить» убирает его, и «Всего» снова просит курс', async () => {
    const { service } = setup([], { now: () => NOW });
    const td = await openSettings(service);
    await write(async () => td.stores[0]?.wallets.create(usdWallet));
    await write(async () => service.rememberEnteredRate('USD', 'TJS', 11));

    const block = await waitFor(() => {
      const el = entered();
      if (!el) throw new Error('нет блока');
      return el;
    });
    expect(block).toHaveTextContent('Курсы, введённые в операциях');
    expect(block).toHaveTextContent(/1 USD = 11 с\./);
    expect(block).toHaveTextContent('введён вручную 10.10');
    // курс в списке валют тоже подписан по-человечески, а не «задан вручную»
    expect(screen.getByRole('button', { name: 'Свой курс USD' })).toBeInTheDocument();
    expect(screen.getByText(/введён вручную 10\.10 · в операции/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Сбросить введённый курс USD' }));
    await waitFor(() => expect(entered()).toBeNull());
    expect(service.getRate('USD', 'TJS')).toBeNull();
    expect(service.listEnteredRates()).toEqual([]);
    expect(screen.getByText('USD: курса нет')).toBeInTheDocument();
    expect(screen.getByText('Введённый курс USD → TJS сброшен')).toBeInTheDocument();
  });

  it('есть свежий курс сети: введённый в списке остаётся, но сказано, что сейчас он не используется', async () => {
    const { service } = setup([stubProvider('nbt', ok())], { now: () => NOW });
    await service.refresh();
    service.rememberEnteredRate('USD', 'TJS', 99);
    const td = await openSettings(service);
    await write(async () => td.stores[0]?.wallets.create(usdWallet));
    const block = await waitFor(() => {
      const el = entered();
      if (!el) throw new Error('нет блока');
      return el;
    });
    expect(block).toHaveTextContent('сейчас не используется: есть другой курс');
    expect(screen.getByText(/1 USD = 10,95 с\./)).toBeInTheDocument(); // в списке валют — курс Нацбанка
  });

  it('«Сбросить» одного курса не трогает другой', async () => {
    const { service } = setup([], { now: () => NOW });
    service.rememberEnteredRate('USD', 'TJS', 11);
    service.rememberEnteredRate('EUR', 'TJS', 12);
    const td = await openSettings(service);
    await write(() => td.stores[0]!.wallets.create({ ...usdWallet, name: 'Евро', currency: 'EUR' }));
    await waitFor(() => expect(entered()).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Сбросить введённый курс EUR' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Сбросить введённый курс EUR' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Сбросить введённый курс USD' })).toBeInTheDocument();
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 11, entered: true });
  });

  it('курс сети устарел: введённый подписан в списке валют, а «Свой курс» его перекрывает', async () => {
    const { service } = setup([stubProvider('nbt', ok({ asOf: '2026-10-01' }))], { now: () => NOW });
    await service.refresh();
    service.rememberEnteredRate('USD', 'TJS', 11);
    const td = await openSettings(service);
    await write(async () => td.stores[0]?.wallets.create(usdWallet));
    await waitFor(() => expect(screen.getByText(/введён вручную 10\.10 · в операции/)).toBeInTheDocument());
    expect(screen.queryByText(/· устарел/)).toBeNull();
    await write(async () => service.setManualRate('USD', 'TJS', 10.5));
    await waitFor(() => expect(screen.getByText(/1 USD = 10,5 с\./)).toBeInTheDocument());
    expect(screen.getByText(/задан вручную/)).toBeInTheDocument();
  });
});

describe('тексты про введённый курс', () => {
  it('дата ДД.ММ; год добавляется, только если он не текущий', () => {
    expect(dayMonth('2026-10-10', '2026-10-15')).toBe('10.10');
    expect(dayMonth('2025-03-05', '2026-10-15')).toBe('05.03.2025');
    expect(dayMonth('мусор', '2026-10-15')).toBe('мусор');
  });

  it('подписи и пояснение под итогом', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12));
    try {
      expect(enteredLabel('2026-10-10')).toBe('введён вручную 10.10');
      expect(enteredPhrase('2026-10-10')).toBe('по введённому вами курсу от 10.10');
      expect(enteredNote([])).toBe('');
      expect(enteredNote([{ currency: 'USD', asOf: '2026-10-10' }])).toBe('Остаток в USD пересчитан по введённому вами курсу от 10.10.');
      expect(enteredNote([{ currency: 'EUR', asOf: '2026-10-05' }, { currency: 'USD', asOf: '2026-10-10' }])).toBe(
        'Пересчитано: EUR по введённому вами курсу от 05.10; USD по введённому вами курсу от 10.10.',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
