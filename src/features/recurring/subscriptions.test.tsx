import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { opsDeps, pinToday, showApp, storeOf, table, unpinToday, type OpsDeps } from '@/features/transactions/__fixtures__/opsKit';
import { resetAutoPostState } from '@/recurring/autoPostState';
import RecurringPage from './RecurringPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => {
  pinToday();
  resetAutoPostState();
  window.localStorage.clear();
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const fmt = (minor: number) => norm(formatMinor(minor, 'TJS'));
const card = () => document.querySelector<HTMLElement>('[data-testid="subscriptions-card"]');
const items = () => Array.from(document.querySelectorAll('[data-testid="subscription-item"]')).map((li) => norm(li.textContent));

const MONTHLY = ['2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03'];
const cashOf = async (s: Store) => (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
const spend = async (s: Store, dates: string[], over: { note?: string; amountMinor?: number; walletId?: string } = {}) => {
  const walletId = over.walletId ?? (await cashOf(s));
  for (const occurredOn of dates) await s.transactions.create({ kind: 'expense', walletId, amountMinor: over.amountMinor ?? 4_900, occurredOn, note: over.note ?? 'Netflix' });
};

async function openPage(setup?: (s: Store) => Promise<unknown>): Promise<OpsDeps> {
  const td = opsDeps([table()], { setup: setup ? async (s) => void (await setup(s)) : undefined });
  await showApp(<RecurringPage />, td, '/recurring');
  await findByRole('heading', { name: 'Регулярные платежи', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  // подсказки считаются отдельным запросом: ждём, пока он отработает
  await new Promise((r) => setTimeout(r, 50));
  return td;
}

/** Подсказки свёрнуты в одну строку «Похоже на подписки · N»: раскрываем, как это сделал бы человек. */
async function expandCard(): Promise<void> {
  const toggle = screen.getByRole('button', { name: /^Похоже на подписки · \d+$/ });
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
}

describe('«Похоже на подписки» на экране «Регулярные платежи»', () => {
  it('по умолчанию свёрнуто: одна строка «Похоже на подписки · N», подсказок не видно; нажатие раскрывает и сворачивает', async () => {
    await openPage((s) => spend(s, MONTHLY));
    await waitFor(() => expect(card()).not.toBeNull());
    const toggle = screen.getByRole('button', { name: 'Похоже на подписки · 1' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(items()).toHaveLength(0);
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(items()).toHaveLength(1);
    await user.click(toggle);
    expect(items()).toHaveLength(0);
  });

  it('повторяющийся расход: название, сумма, как часто, сколько платежей и когда последний', async () => {
    await openPage((s) => spend(s, MONTHLY));
    await waitFor(() => expect(card()).not.toBeNull());
    await expandCard();
    expect(screen.getByRole('heading', { name: /^Похоже на подписки · 1$/, level: 2 })).toBeTruthy();
    expect(items()).toHaveLength(1);
    expect(items()[0]).toContain('Netflix');
    expect(items()[0]).toContain(`${fmt(4_900)} раз в месяц · 4 платежа, последний 3 октября`);
  });

  it('нет повторов — карточки нет', async () => {
    await openPage((s) => spend(s, ['2026-10-03', '2026-10-09']));
    expect(card()).toBeNull();
  });

  it('«Создать платёж» открывает окно с заполненными полями; после сохранения подсказка пропадает (платёж заведён)', async () => {
    const td = await openPage((s) => spend(s, MONTHLY));
    await waitFor(() => expect(card()).not.toBeNull());
    await expandCard();
    await user.click(screen.getByRole('button', { name: 'Создать платёж: Netflix' }));
    const dlg = await findByRole('dialog', { name: 'Новый регулярный платёж' });
    expect((dlg.querySelector('input[inputmode="decimal"], input[aria-label^="Сумма"]') as HTMLInputElement | null)?.value ?? '').toContain('49');
    expect((screen.getByRole('textbox', { name: 'Название или заметка' }) as HTMLInputElement).value).toBe('Netflix');
    expect((dlg.querySelector('input[type="date"]') as HTMLInputElement).value).toBe('2026-11-03');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый регулярный платёж' })).toBeNull());
    const [rule] = await storeOf(td).db.recurring_rules.toArray();
    expect(rule).toMatchObject({ kind: 'expense', amountMinor: 4_900, note: 'Netflix', frequency: 'monthly', intervalN: 1, startOn: '2026-11-03' });
    await waitFor(() => expect(card()).toBeNull());
  });

  it('«Не показывать» убирает подсказку и запоминает отказ на этом устройстве', async () => {
    const td = await openPage((s) => spend(s, MONTHLY));
    await waitFor(() => expect(card()).not.toBeNull());
    await expandCard();
    await user.click(screen.getByRole('button', { name: 'Не показывать: Netflix' }));
    await waitFor(() => expect(card()).toBeNull());
    const stored = JSON.parse(window.localStorage.getItem(`finora:dismissed-subs:${storeOf(td).userId}`) ?? '[]') as string[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toContain('n:netflix');
  });

  const CARD = '8f9d3c1e-6a53-4f0b-9d77-1f2a3b4c5d6e';
  const withCard = async (s: Store) => {
    await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' }, { id: CARD });
    await spend(s, MONTHLY, { walletId: CARD });
  };

  it('отказ действует и при следующем открытии приложения (те же данные, новый сеанс)', async () => {
    await openPage(withCard);
    await waitFor(() => expect(card()).not.toBeNull());
    await expandCard();
    await user.click(screen.getByRole('button', { name: 'Не показывать: Netflix' }));
    await waitFor(() => expect(card()).toBeNull());
    await openPage(withCard);
    expect(card()).toBeNull();
  });

  it('испорченное хранилище (не JSON) не ломает экран: подсказка показывается', async () => {
    // ключ зависит от пользователя сеанса: отдаём испорченное значение на любой ключ отказов
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => (k.startsWith('finora:dismissed-subs:') ? '{{{' : null));
    await openPage((s) => spend(s, MONTHLY));
    await waitFor(() => expect(card()).not.toBeNull());
    await expandCard();
    spy.mockRestore();
  });

  it('хранилище недоступно (приватный режим): подсказка скрывается до перезагрузки, ошибок нет', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('нет доступа');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('нет доступа');
    });
    await openPage((s) => spend(s, MONTHLY));
    await waitFor(() => expect(card()).not.toBeNull());
    await expandCard();
    await user.click(screen.getByRole('button', { name: 'Не показывать: Netflix' }));
    await waitFor(() => expect(card()).toBeNull());
    get.mockRestore();
    set.mockRestore();
  });

  it('уже заведённый регулярный платёж («Netflix», та же сумма): подсказки нет', async () => {
    await openPage(async (s) => {
      await spend(s, MONTHLY);
      await s.recurring.create({ kind: 'expense', walletId: await cashOf(s), amountMinor: 4_900, frequency: 'monthly', startOn: '2026-11-03', note: 'Netflix' });
    });
    expect(card()).toBeNull();
  });

  it('кошелёк в архиве: подсказки нет (платёж в него не завести)', async () => {
    await openPage(async (s) => {
      await withCard(s);
      await s.wallets.archive(CARD);
    });
    expect(card()).toBeNull();
  });

  it('несколько подсказок: три сразу, остальные по кнопке; дорогие первыми', async () => {
    await openPage(async (s) => {
      await spend(s, MONTHLY, { note: 'Музыка', amountMinor: 1_000 });
      await spend(s, MONTHLY, { note: 'Облако', amountMinor: 2_000 });
      await spend(s, MONTHLY, { note: 'Видео', amountMinor: 4_900 });
      await spend(s, MONTHLY, { note: 'Спортзал', amountMinor: 30_000 });
    });
    await waitFor(() => expect(card()).not.toBeNull());
    await expandCard();
    expect(items().map((t) => /^[^\d]+/.exec(t)?.[0])).toEqual(['Спортзал', 'Видео', 'Облако']);
    await user.click(screen.getByRole('button', { name: 'Показать ещё 1' }));
    expect(items()).toHaveLength(4);
  });

  it('подсказка видна и когда платежей по расписанию ещё нет вовсе', async () => {
    await openPage((s) => spend(s, MONTHLY));
    await waitFor(() => expect(card()).not.toBeNull());
    expect(screen.getByText('Платежей по расписанию пока нет')).toBeTruthy();
  });
});
