import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, write } from '@/app/testkit';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import {
  opsDeps,
  pinToday,
  showApp,
  storeOf,
  table,
  unpinToday,
  type OpsDeps,
} from '@/features/transactions/__fixtures__/opsKit';
import DebtDetailPage from './DebtDetailPage';
import DebtsPage from './DebtsPage';
import DebtsWidget from './DebtsWidget';

/**
 * Состязательные проверки «свежести»: что видит человек, если экран открыт давно, а мир тем временем изменился
 * (пришла правка с другого устройства; прошла полночь).
 */

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const DEBT_ID = '0d6c0d3e-5a3b-4f43-9c59-7b4b0d3a2222';
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (el: Element | null) => norm(el?.textContent);
const button = (name: string | RegExp) => screen.getByRole('button', { name });

type Debt = Parameters<Store['debts']['create']>[0];
const make = (s: Store, over: Partial<Debt> = {}, id?: string) =>
  s.debts.create(
    { direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', ...over },
    id ? { id } : undefined,
  );

describe('правка долга, пока на другом устройстве долг уже изменили', () => {
  async function openDetail(over: Partial<Debt> = {}): Promise<OpsDeps> {
    const td = opsDeps([table()], { setup: async (s) => void (await make(s, over, DEBT_ID)) });
    await showApp(
      <Routes>
        <Route path="/debts/:id" element={<DebtDetailPage />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>,
      td,
      `/debts/${DEBT_ID}`,
    );
    await findByRole('button', { name: 'Править' });
    return td;
  }

  it('человек правит только заметку: срок, который тем временем поставили с другого устройства, не откатывается', async () => {
    const td = await openDetail({ dueOn: null, note: '' });
    await user.click(button('Править'));
    await findByRole('dialog', { name: 'Правка долга' });

    // с другого устройства пришла правка срока (синхронизация записывает её в ту же локальную базу)
    await write(async () => void (await storeOf(td).debts.update(DEBT_ID, { dueOn: '2026-11-20' })));
    await waitFor(async () => expect((await storeOf(td).db.debts.get(DEBT_ID))?.dueOn).toBe('2026-11-20'));

    await user.type(screen.getByRole('textbox', { name: 'Заметка' }), 'на ремонт');
    await user.click(button('Сохранить'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Правка долга' })).toBeNull());

    const row = await storeOf(td).db.debts.get(DEBT_ID);
    expect(row?.note).toBe('на ремонт');
    expect(row?.dueOn).toBe('2026-11-20'); // чужая правка срока должна уцелеть
  });

  it('человек правит только имя: сумма, которую тем временем изменили в другом месте, не откатывается', async () => {
    const td = await openDetail();
    await user.click(button('Править'));
    await findByRole('dialog', { name: 'Правка долга' });

    await write(async () => void (await storeOf(td).debts.update(DEBT_ID, { principalMinor: 80_000 })));
    await waitFor(async () => expect((await storeOf(td).db.debts.get(DEBT_ID))?.principalMinor).toBe(80_000));

    const nameField = screen.getByRole('textbox', { name: 'Кому я дал' });
    await user.clear(nameField);
    await user.type(nameField, 'Алишер Р.');
    await user.click(button('Сохранить'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Правка долга' })).toBeNull());

    const row = await storeOf(td).db.debts.get(DEBT_ID);
    expect(row?.counterparty).toBe('Алишер Р.');
    expect(row?.principalMinor).toBe(80_000);
  });
});

describe('экран открыт, а наступила полночь', () => {
  /**
   * Переводит «сейчас» на следующий день и делает то, что делает человек: возвращается на вкладку (событие видимости и фокус).
   * Именно эти события в проекте обновляют «сегодня» на экранах платежей (src/recurring/useToday.ts); долги их не слушают.
   */
  async function nextDay(): Promise<void> {
    await act(async () => {
      vi.setSystemTime(new Date(2026, 9, 16, 0, 5, 0));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
  }

  beforeEach(() => {
    vi.setSystemTime(new Date(2026, 9, 15, 23, 58, 0));
  });

  it('список долгов: срок «сегодня» после полуночи становится просрочкой', async () => {
    const td = opsDeps([table()], { setup: async (s) => void (await make(s, { dueOn: '2026-10-15' })) });
    await showApp(<DebtsPage />, td, '/debts');
    const row = await waitFor(() => screen.getByRole('link', { name: /^Алишер/ }));
    expect(text(row)).toContain('сегодня');
    expect(text(row)).not.toContain('Просрочен');

    await nextDay();

    await waitFor(() => expect(text(screen.getByRole('link', { name: /^Алишер/ }))).toContain('Просрочен на 1 день'), 4000);
  });

  it('виджет «Главной»: «сегодня» после полуночи становится «Просрочен на 1 день»', async () => {
    const td = opsDeps([table()], { setup: async (s) => void (await make(s, { dueOn: '2026-10-15' })) });
    await showApp(<DebtsWidget />, td, '/');
    const next = await waitFor(() => {
      const el = document.querySelector('[data-testid="debts-widget-next"]');
      if (!el) throw new Error('нет виджета');
      return el;
    });
    expect(text(next)).toContain('сегодня');

    await nextDay();

    await eventually(() => expect(text(document.querySelector('[data-testid="debts-widget-next"]'))).toContain('Просрочен на 1 день'), 4000);
  });

  it('страница долга: строка срока тоже обновляется', async () => {
    const td = opsDeps([table()], { setup: async (s) => void (await make(s, { dueOn: '2026-10-15' }, DEBT_ID)) });
    await showApp(
      <Routes>
        <Route path="/debts/:id" element={<DebtDetailPage />} />
      </Routes>,
      td,
      `/debts/${DEBT_ID}`,
    );
    await findByRole('button', { name: 'Править' });
    expect(text(document.querySelector('[data-testid="debt-summary"]'))).toContain('Сегодня');

    await nextDay();

    await waitFor(() => expect(text(document.querySelector('[data-testid="debt-summary"]'))).toContain('Просрочен на 1 день'), 4000);
  });
});
