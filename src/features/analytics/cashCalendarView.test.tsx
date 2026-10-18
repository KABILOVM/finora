import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { opsDeps, pinToday, seedHistory, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import AnalyticsPage from './AnalyticsPage';

/**
 * «Сегодня» = четверг 15 октября 2026; календарь — 30 дней, по 13 ноября. Деньги на руках после seedHistory:
 * наличные 4 842,50 + карта 165 − 10 $ × 10,9 = 4 898,50. За окно обычных трат (с 15.09 по 14.10) ушло 45 + 3 + 109 = 157 с. → 5,23 с. в день.
 */
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (el: Element | null | undefined) => norm(el?.textContent);
const fmt = (minor: number) => norm(formatMinor(minor, 'TJS'));
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
const usualBox = () => document.getElementById('cal-usual') as HTMLInputElement;
const receivablesBox = () => document.getElementById('cal-receivables') as HTMLInputElement;

const START = 489_850;
const USUAL = 523; // floor(15 700 ÷ 30)

const cashOf = async (s: Store) => (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;

async function openCalendar(options: { setup?: (s: Store) => Promise<unknown>; usual?: boolean; tables?: ReturnType<typeof table>[] } = {}) {
  const td = opsDeps(options.tables ?? [table()], { setup: async (s) => void (await (options.setup ?? seedHistory)(s)) });
  await showApp(<AnalyticsPage />, td, '/analytics');
  await findByRole('heading', { name: 'Аналитика', level: 1 });
  await user.click(await findByRole('radio', { name: 'Календарь' }));
  await waitFor(() => expect(tid('calendar-summary')).not.toBeNull());
  // по умолчанию «Тратить как обычно» включено; большинству проверок нужны чистые суммы без среднего
  if (options.usual !== true && !usualBox().disabled && usualBox().checked) await user.click(usualBox());
  return td;
}

describe('вкладка «Календарь» на экране «Аналитика»', () => {
  it('по умолчанию открыт «Обзор»; «Календарь» переключает раздел и убирает выбор месяца', async () => {
    const td = opsDeps([table()], { setup: async (s) => void (await seedHistory(s)) });
    await showApp(<AnalyticsPage />, td, '/analytics');
    await findByRole('heading', { name: 'Аналитика', level: 1 });
    await waitFor(() => expect(tid('analytics-summary')).not.toBeNull());
    expect(screen.getByRole('radio', { name: 'Обзор' }).getAttribute('aria-checked')).toBe('true');
    expect(tid('calendar-summary')).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Календарь' }));
    await waitFor(() => expect(tid('calendar-summary')).not.toBeNull());
    expect(tid('analytics-summary')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Предыдущий месяц' })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Обзор' }));
    await waitFor(() => expect(tid('analytics-summary')).not.toBeNull());
    expect(tid('calendar-summary')).toBeNull();
  });

  it('без платежей и долгов: деньги не меняются, хватает на все 30 дней', async () => {
    await openCalendar();
    expect(text(tid('calendar-start'))).toContain(fmt(START));
    expect(text(tid('calendar-end'))).toBe(`К 13 ноя будет ${fmt(START)}`);
    expect(text(tid('calendar-verdict'))).toBe(`Денег хватает на все 30 дней. Меньше всего будет ${fmt(START)} (15 октября).`);
    expect(tid('calendar-verdict')!.getAttribute('role')).toBeNull();
    expect(tid('zero-line')).toBeNull();
    expect(text(document.body)).toContain('В ближайшие 30 дней нет платежей, доходов и сроков по долгам.');
    expect(all('cal-event')).toHaveLength(0);
  });

  it('«Тратить как обычно» включено по умолчанию: сегодня доплачивается только недостающее, дальше каждый день по среднему', async () => {
    await openCalendar({ usual: true });
    expect(usualBox().checked).toBe(true);
    // сегодня уже потрачено 12,50 > 5,23 — сегодня ничего не вычитаем; остальные 29 дней по 5,23
    expect(text(tid('calendar-end'))).toBe(`К 13 ноя будет ${fmt(START - 29 * USUAL)}`);
    expect(text(document.querySelector('label[for="cal-usual"]'))).toContain(`Каждый день минус ${fmt(USUAL)}`);

    await user.click(usualBox());
    expect(text(tid('calendar-end'))).toBe(`К 13 ноя будет ${fmt(START)}`);
    await user.click(usualBox());
    expect(text(tid('calendar-end'))).toBe(`К 13 ноя будет ${fmt(START - 29 * USUAL)}`);
  });

  it('нет истории расходов: «Тратить как обычно» выключено и недоступно, причина написана', async () => {
    await openCalendar({
      setup: async (s) => {
        await s.transactions.create({ kind: 'income', walletId: await cashOf(s), amountMinor: 100_000, occurredOn: '2026-10-15' });
      },
    });
    expect(usualBox().disabled).toBe(true);
    expect(usualBox().checked).toBe(false);
    expect(text(document.querySelector('label[for="cal-usual"]'))).toContain('Пока нет истории расходов');
    expect(text(tid('calendar-end'))).toBe(`К 13 ноя будет ${fmt(100_000)}`);
  });

  it('регулярный платёж уводит деньги в минус: тревожный вывод, нулевая черта и событие в нужном дне', async () => {
    await openCalendar({
      setup: async (s) => {
        const i = await seedHistory(s);
        await s.recurring.create({ kind: 'expense', walletId: i.cash, amountMinor: 600_000, frequency: 'monthly', startOn: '2026-10-20', note: 'Аренда' });
      },
    });
    const verdict = tid('calendar-verdict')!;
    expect(verdict.getAttribute('role')).toBe('alert');
    expect(text(verdict)).toBe(`Денег не хватит с 20 октября. Самый низкий остаток: ${fmt(START - 600_000)} (20 октября).`);
    expect(text(tid('calendar-end'))).toBe(`К 13 ноя будет ${fmt(START - 600_000)}`);
    expect(tid('zero-line')).not.toBeNull();

    const day = tid('cal-day-2026-10-20')!;
    expect(text(day)).toContain('вт, 20 окт');
    expect(text(day)).toContain(`Остаток ${fmt(START - 600_000)}`);
    expect(text(day.querySelector('[data-testid="cal-event"]'))).toContain('Аренда');
    expect(text(day.querySelector('[data-testid="cal-event"]'))).toContain('платёж');
    expect(text(day.querySelector('[data-testid="cal-event"]'))).toContain(fmt(600_000));
  });

  it('ежемесячный платёж и доход считаются по сроку: платёж 20-го, доход 1 ноября; сумма изменений совпадает с итогом', async () => {
    await openCalendar({
      setup: async (s) => {
        const i = await seedHistory(s);
        await s.recurring.create({ kind: 'expense', walletId: i.cash, amountMinor: 30_000, frequency: 'monthly', startOn: '2026-10-20', note: 'Интернет' });
        await s.recurring.create({ kind: 'income', walletId: i.cash, amountMinor: 200_000, frequency: 'monthly', startOn: '2026-11-01', note: 'Зарплата' });
      },
    });
    expect(all('cal-event').map((e) => text(e))).toEqual([
      expect.stringContaining('Интернет'),
      expect.stringContaining('Зарплата'),
    ]);
    expect(text(tid('calendar-end'))).toBe(`К 13 ноя будет ${fmt(START - 30_000 + 200_000)}`);
    expect(text(tid('calendar-verdict'))).toContain('Денег хватает на все 30 дней');
    expect(text(tid('calendar-verdict'))).toContain(`Меньше всего будет ${fmt(START - 30_000)} (20 октября)`);
  });

  it('«я должен» со сроком: платёж частями до срока — в свою дату, в срок — остаток за его вычетом; вместе не больше долга', async () => {
    await openCalendar({
      setup: async (s) => {
        const i = await seedHistory(s);
        const debt = await s.debts.create({ direction: 'borrowed', counterparty: 'Сосед', principalMinor: 20_000, currency: 'TJS', openedOn: '2026-09-01', dueOn: '2026-10-25' });
        // «платить частями» по этому же долгу: 22-го — 50, к сроку 25-го — оставшиеся 150 (и следующий плановый уже внутри срока)
        await s.recurring.create({ kind: 'expense', walletId: i.cash, amountMinor: 5_000, frequency: 'monthly', startOn: '2026-10-22', debtId: debt.id });
      },
    });
    const events = all('cal-event');
    expect(events).toHaveLength(2);
    expect(text(tid('cal-day-2026-10-22'))).toContain(`−${fmt(5_000)}`);
    expect(text(tid('cal-day-2026-10-25'))).toContain('Сосед');
    expect(text(tid('cal-day-2026-10-25'))).toContain('вернуть долг');
    expect(text(tid('cal-day-2026-10-25'))).toContain(`−${fmt(15_000)}`);
    expect(text(tid('calendar-end'))).toBe(`К 13 ноя будет ${fmt(START - 20_000)}`);
  });

  it('просроченный долг «я должен» считается сегодняшним днём и подписан', async () => {
    await openCalendar({
      setup: async (s) => {
        await seedHistory(s);
        await s.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-08-01', dueOn: '2026-10-01' });
      },
    });
    const day = tid('cal-day-2026-10-15')!;
    expect(text(day)).toContain('Сегодня');
    expect(text(day)).toContain('Банк');
    expect(text(day)).toContain('просрочен, считаем на сегодня');
    expect(text(day)).toContain(`Остаток ${fmt(START - 50_000)}`);
  });

  it('«Мне вернут долги в срок»: по умолчанию выключено; включение добавляет остаток долга в день срока', async () => {
    await openCalendar({
      setup: async (s) => {
        const i = await seedHistory(s);
        const lent = await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', dueOn: '2026-10-30' });
        await s.transactions.create({ kind: 'income', walletId: i.cash, amountMinor: 10_000, occurredOn: '2026-10-05', debtId: lent.id });
      },
    });
    expect(receivablesBox().checked).toBe(false);
    expect(all('cal-event')).toHaveLength(0);
    const startNow = START + 10_000; // частичный возврат 100 уже лежит на кошельке
    expect(text(tid('calendar-end'))).toBe(`К 13 ноя будет ${fmt(startNow)}`);

    await user.click(receivablesBox());
    const events = all('cal-event');
    expect(events).toHaveLength(1);
    expect(text(events[0])).toContain('Алишер');
    expect(text(events[0])).toContain('вернут долг');
    expect(text(tid('calendar-end'))).toBe(`К 13 ноя будет ${fmt(startNow + 40_000)}`); // остаток долга 400

    await user.click(receivablesBox());
    expect(all('cal-event')).toHaveLength(0);
  });

  it('нет курса доллара: долг в долларах не вошёл в расчёт, об этом сказано', async () => {
    await openCalendar({
      tables: [],
      setup: async (s) => {
        await seedHistory(s);
        await s.debts.create({ direction: 'borrowed', counterparty: 'Джон', principalMinor: 2_000, currency: 'USD', openedOn: '2026-10-01', dueOn: '2026-10-25' });
      },
    });
    expect(text(document.body)).toContain('Не вошло в расчёт — нет курса:');
    expect(text(document.body)).toContain(norm(formatMinor(2_000, 'USD')));
    expect(all('cal-event')).toHaveLength(0);
  });

  it('все кошельки — накопления: объяснение вместо календаря', async () => {
    const td = opsDeps([table()], {
      setup: async (s) => {
        for (const w of await s.db.wallets.toArray()) await s.wallets.update(w.id, { kind: 'savings' });
      },
    });
    await showApp(<AnalyticsPage />, td, '/analytics');
    await findByRole('heading', { name: 'Аналитика', level: 1 });
    await user.click(await findByRole('radio', { name: 'Календарь' }));
    await waitFor(() => expect(screen.getByText('Тратить нечего')).toBeTruthy());
    expect(tid('calendar-summary')).toBeNull();
  });
});
