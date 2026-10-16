/**
 * Атака 9. Часовые пояса и полночь: Asia/Dushanbe (UTC+5), America/Los_Angeles, переход через полночь при вводе
 * «Сегодня/Вчера», границы месяца в итогах. Настоящий шит «Новая операция», настоящая главная (капсулы прихода/расхода) и «Аналитика» (листание месяцев).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { makeTestDeps, renderAppRoot } from '@/app/testkit';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { ensureSeeded } from '@/db';
import { formatMinor } from '@/domain/money';
import { clickSave, liveTxs, openAddSheet, opsDeps, pickDate, storeOf, tapAmount } from '@/features/transactions/__fixtures__/opsKit';
import { addDays, monthKey, todayLocal } from '@/lib/dates';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const ORIGINAL_TZ = process.env['TZ'];

/** Календарная дата в поясе tz — считается стандартной библиотекой браузера, независимо от кода приложения. */
function dateIn(tz: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

function setClock(tz: string, iso: string) {
  process.env['TZ'] = tz;
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(iso));
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ORIGINAL_TZ;
  localStorage.clear();
  vi.restoreAllMocks();
});

const CASES: Array<[string, string, string]> = [
  // пояс, момент (UTC), что ожидаем увидеть как «сегодня» по часам на стене
  ['Asia/Dushanbe', '2026-10-10T18:59:20.000Z', '23:59 10 окт — в UTC ещё 10 окт'],
  ['Asia/Dushanbe', '2026-10-10T19:00:40.000Z', '00:00 11 окт — в UTC ещё 10 окт'],
  ['Asia/Dushanbe', '2026-10-10T20:30:00.000Z', '01:30 11 окт — в UTC ещё 10 окт'],
  ['America/Los_Angeles', '2026-10-11T06:59:20.000Z', '23:59 10 окт — в UTC уже 11 окт'],
  ['America/Los_Angeles', '2026-10-11T07:00:40.000Z', '00:00 11 окт'],
  ['America/Los_Angeles', '2026-11-01T08:30:00.000Z', 'ночь перевода часов назад (1 ноя)'],
  ['Pacific/Kiritimati', '2026-10-09T10:30:00.000Z', 'UTC+14: местный день впереди UTC'],
  ['Pacific/Pago_Pago', '2026-10-10T10:30:00.000Z', 'UTC-11: местный день позади UTC'],
];

describe('атака 9: «Сегодня» и «Вчера» в разных поясах', () => {
  for (const [tz, instant, what] of CASES) {
    it(`${tz}, ${instant} (${what}): «Сегодня» и «Вчера» сохраняются по местному календарю`, async () => {
      setClock(tz, instant);
      const local = dateIn(tz, new Date(instant));
      const { td, onClose } = await openAddSheet();
      await tapAmount('5');
      await clickSave();
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect((await liveTxs(td))[0]?.occurredOn).toBe(local);
      expect(todayLocal()).toBe(local);

      // «Вчера» в новой операции
      const second = await openAddSheet(opsDeps());
      await tapAmount('6');
      await pickDate('Вчера');
      await clickSave();
      await waitFor(() => expect(second.onClose).toHaveBeenCalled());
      expect((await liveTxs(second.td))[0]?.occurredOn).toBe(addDays(local, -1));
    }, 30_000);
  }

  it('Душанбе: шит открыт в 23:59:30, человек вводит сумму, полночь проходит, «Сохранить» → «Сегодня» теперь уже НОВЫЙ день, дата в списке та же, что показана', async () => {
    setClock('Asia/Dushanbe', '2026-10-10T18:59:30.000Z');
    const { td, onClose } = await openAddSheet();
    await tapAmount('9');
    act(() => vi.setSystemTime(new Date('2026-10-10T19:00:45.000Z'))); // 00:00:45 11 окт
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const tx = (await liveTxs(td))[0]!;
    // «Сегодня» разрешается в момент сохранения: операция в дне, который сейчас на часах
    expect(tx.occurredOn).toBe('2026-10-11');
    // и она не в «будущем» относительно часов, и не позади них более чем на сутки
    expect(tx.occurredOn <= todayLocal()).toBe(true);
  }, 30_000);

  it('Душанбе: «Вчера» выбрано в 23:59:30 и сохранено после полуночи — остаётся 9 окт (а не съезжает на 10 окт)', async () => {
    setClock('Asia/Dushanbe', '2026-10-10T18:59:30.000Z');
    const { td, onClose } = await openAddSheet();
    await tapAmount('9');
    await pickDate('Вчера');
    act(() => vi.setSystemTime(new Date('2026-10-10T19:00:45.000Z')));
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]?.occurredOn).toBe('2026-10-09');
  }, 30_000);
});

describe('атака 9: границы месяца в итогах («Главная» и «Аналитика»)', () => {
  /**
   * Итоги месяца на «Главной» — две капсулы «приход/расход» за ТЕКУЩИЙ месяц; переключатель месяца, «Разница» и разбивка живут на «Аналитике»,
   * поэтому границу месяца проверяем в обоих местах: сначала капсулы, потом — переходом по меню — экран «Аналитика» с листанием месяцев.
   */
  async function homeAt(tz: string, instant: string) {
    setClock(tz, instant);
    const td = makeTestDeps();
    const open = td.deps.openStore;
    td.deps.openStore = async (uid) => {
      const s = await open(uid);
      await ensureSeeded(s);
      const cash = (await s.db.wallets.toArray())[0]!;
      const days: Array<[string, number]> = [
        ['2026-09-30', 111_00],
        ['2026-10-01', 22_00],
        ['2026-10-31', 33_00],
        ['2026-11-01', 44_00],
      ];
      for (const [d, a] of days) await s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: a, occurredOn: d, note: `день-${d}` });
      return s;
    };
    renderAppRoot(<AppRoutes />, { deps: td.deps, path: '/' });
    await findByRole('heading', { name: 'Главная', level: 1 });
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull(), 10_000);
    return td;
  }
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const fmt = (minor: number, sign: 'auto' | 'always' = 'auto') => norm(formatMinor(minor, 'TJS', { sign }));
  /** Капсулы «приход/расход месяца» в шапке «Главной»: расход со знаком «−», приход со знаком «+». */
  const flow = (kind: 'income' | 'expense') => norm(document.querySelector(`[data-testid="home-flow-${kind}"]`)?.textContent);
  const summary = () => {
    const el = document.querySelector<HTMLElement>('[data-testid="analytics-summary"]');
    if (!el) throw new Error('нет карточки итогов месяца на «Аналитике»');
    return el;
  };
  /** Крупная сумма «Расходы за …» (первая сумма карточки) и значения строк «Доходы» / «Разница». */
  const analyticsExpense = () => norm(summary().querySelector('.money')?.textContent);
  const analyticsRow = (label: string) =>
    norm(Array.from(summary().querySelectorAll('dl > div')).find((n) => n.querySelector('dt')?.textContent === label)?.querySelector('dd')?.textContent);
  async function openAnalytics() {
    await user.click(screen.getAllByRole('link', { name: 'Аналитика' })[0] as HTMLElement);
    await findByRole('heading', { name: 'Аналитика', level: 1 });
    await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull(), 10_000);
  }

  it('Душанбе, 00:30 1 ноября (в UTC ещё 31 октября): «этот месяц» — ноябрь, расход 44 с.; «предыдущий» — октябрь, 22+33=55 с.; 30 сентября — уже сентябрь', async () => {
    await homeAt('Asia/Dushanbe', '2026-10-31T19:30:00.000Z');
    expect(todayLocal()).toBe('2026-11-01');
    // «Главная»: капсулы показывают ноябрь — только операцию 1 ноября
    await waitFor(() => expect(flow('expense')).toBe(fmt(-44_00)));
    expect(flow('income')).toBe(fmt(0, 'always'));
    expect(flow('expense')).not.toMatch(/55|33|22|111/);

    // «Аналитика»: открывается на текущем месяце — ноябре (дальше вперёд не пускает)
    await openAnalytics();
    await waitFor(() => expect(summary().textContent).toMatch(/ноябрь 2026/));
    expect(analyticsExpense()).toBe(fmt(44_00));
    expect(analyticsRow('Доходы')).toBe(fmt(0, 'always'));
    expect(analyticsRow('Разница')).toBe(fmt(-44_00));
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();

    // предыдущий месяц — октябрь: 22 (1 окт) + 33 (31 окт) = 55; ни ноябрьские 44, ни сентябрьские 111 сюда не попадают
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(summary().textContent).toMatch(/октябрь 2026/));
    await waitFor(() => expect(analyticsExpense()).toBe(fmt(55_00)));
    expect(analyticsRow('Разница')).toBe(fmt(-55_00));
    expect(summary().textContent).not.toContain(fmt(44_00));
    expect(summary().textContent).not.toContain(fmt(111_00));
    expect(norm(document.querySelector('[data-testid="analytics-trend"]')?.textContent)).toBe('На 50% меньше, чем в прошлом месяце'); // 55 против сентябрьских 111
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeEnabled();

    // ещё месяц назад — сентябрь: 30 сентября лежит там, а не в октябре
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(summary().textContent).toMatch(/сентябрь 2026/));
    await waitFor(() => expect(analyticsExpense()).toBe(fmt(111_00)));
    expect(summary().textContent).not.toContain(fmt(55_00));
  }, 40_000);

  it('Лос-Анджелес, 22:30 31 октября (в UTC уже 1 ноября): «этот месяц» — октябрь (22+33=55), ноябрьская операция сюда не попадает', async () => {
    await homeAt('America/Los_Angeles', '2026-11-01T05:30:00.000Z');
    expect(todayLocal()).toBe('2026-10-31');
    expect(monthKey(todayLocal())).toBe('2026-10');
    // «Главная»: капсулы — октябрь (сентябрьские 111 и ноябрьские 44 не входят, 99 = 55+44 — признак смешения)
    await waitFor(() => expect(flow('expense')).toBe(fmt(-55_00)));
    expect(flow('income')).toBe(fmt(0, 'always'));
    expect(flow('expense')).not.toMatch(/44|111|99/);

    // «Аналитика»: текущий месяц — октябрь, ноябрь недоступен
    await openAnalytics();
    await waitFor(() => expect(summary().textContent).toMatch(/октябрь 2026/));
    await waitFor(() => expect(analyticsExpense()).toBe(fmt(55_00)));
    expect(summary().textContent).not.toMatch(/44|111|99/);
    expect(analyticsRow('Разница')).toBe(fmt(-55_00));
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
  }, 40_000);
});

describe('атака 9: переезд между поясами не сдвигает сохранённые даты', () => {
  it('операция внесена в 01:30 11 окт по Душанбе (в UTC ещё 10-е); после смены пояса на Лос-Анджелес она по-прежнему в списке под 11 октября', async () => {
    setClock('Asia/Dushanbe', '2026-10-10T20:30:00.000Z');
    const d = opsDeps();
    const { onClose } = await openAddSheet(d);
    await tapAmount('15');
    await user.click(screen.getByRole('button', { name: 'Заметка' }));
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'ночная');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const row = (await liveTxs(d))[0]!;
    expect(row.occurredOn).toBe('2026-10-11');
    // человек прилетел в Лос-Анджелес (там всё ещё 10 окт): запись не должна «переехать» на другой день
    process.env['TZ'] = 'America/Los_Angeles';
    expect((await storeOf(d).db.transactions.get(row.id))?.occurredOn).toBe('2026-10-11');
    expect(todayLocal()).toBe('2026-10-10');
    // а в «Операциях» — это будущая для этого пояса дата: список не прячет её
    const td = d;
    renderAppRoot(<AppRoutes />, { deps: td.deps, path: '/transactions' });
    await waitFor(() => screen.getByRole('heading', { name: 'Операции', level: 1 }), 10_000);
    await waitFor(() => expect(document.body.textContent).toMatch(/ночная/), 8000);
  }, 40_000);
});
