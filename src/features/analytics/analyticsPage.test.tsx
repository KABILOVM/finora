import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import {
  currentPath,
  LocationProbe,
  opsDeps,
  pinToday,
  seedHistory,
  showApp,
  table,
  unpinToday,
} from '@/features/transactions/__fixtures__/opsKit';
import AnalyticsPage, { expenseTrend } from './AnalyticsPage';

/** «Сегодня» = четверг 15 октября 2026. Октябрь: расходы 12,50 (обед) + 3 (такси) + 109 (кофе, 10 $ по курсу) = 124,50; сентябрь: 45 + 2 = 47. */
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (el: Element | null | undefined) => norm(el?.textContent);
const fmt = (minor: number, sign: 'auto' | 'always' = 'auto') => norm(formatMinor(minor, 'TJS', { sign }));
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const heightOf = (id: string) => Number(tid(id)?.getAttribute('height'));
/** Строки таблицы для скринридера по её подписи (caption). */
const tableRows = (caption: string): Element[] => {
  const t = Array.from(document.querySelectorAll('table')).find((x) => norm(x.querySelector('caption')?.textContent) === caption);
  return Array.from(t?.querySelectorAll('tbody tr') ?? []);
};

async function openPage(options: { path?: string; empty?: boolean; setup?: (s: Store) => Promise<unknown>; tables?: ReturnType<typeof table>[] } = {}) {
  const td = opsDeps(options.tables ?? [table()], {
    setup: async (s) => {
      if (options.setup) await options.setup(s);
      else if (!options.empty) await seedHistory(s);
    },
  });
  await showApp(
    <>
      <AnalyticsPage />
      <LocationProbe />
    </>,
    td,
    options.path ?? '/analytics',
  );
  await findByRole('heading', { name: 'Аналитика', level: 1 });
  await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
  return td;
}

describe('expenseTrend: расходы месяца против прошлого', () => {
  it.each([
    [200, 100, 'На 100% больше, чем в прошлом месяце'],
    [50, 100, 'На 50% меньше, чем в прошлом месяце'],
    [100, 100, 'Столько же, сколько в прошлом месяце'],
    [100, 0, 'В прошлом месяце расходов не было'],
    [0, 0, null],
    [0, 100, 'На 100% меньше, чем в прошлом месяце'],
  ])('%i против %i → %s', (cur, prev, expected) => expect(expenseTrend(cur, prev)).toBe(expected));
});

describe('экран «Аналитика»', () => {
  it('итог месяца: расходы, доходы, разница и сравнение с прошлым месяцем', async () => {
    await openPage();
    const summary = tid('analytics-summary')!;
    expect(text(summary)).toContain('Расходы за октябрь 2026');
    expect(text(summary)).toContain(fmt(12_450));
    expect(text(tid('analytics-trend'))).toBe('На 165% больше, чем в прошлом месяце'); // (124,50 − 47) ÷ 47
    expect(text(summary)).toContain(fmt(500_000, 'always'));
    expect(text(summary)).toContain(fmt(487_550, 'always')); // доходы 5 000 − расходы 124,50
  });

  it('график по месяцам: шесть месяцев, высота столбиков по суммам, таблица для скринридера', async () => {
    await openPage();
    const rows = tableRows('Доходы и расходы по месяцам');
    expect(rows.map((r) => r.querySelector('th')?.textContent)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    const oct = rows[5]!.querySelectorAll('td');
    expect(norm(oct[0]?.textContent)).toBe(norm(formatMinor(500_000, 'TJS')));
    expect(norm(oct[1]?.textContent)).toBe(norm(formatMinor(12_450, 'TJS')));
    expect(heightOf('bar-income-2026-10')).toBeGreaterThan(heightOf('bar-expense-2026-10')); // 5 000 > 124,50
    expect(heightOf('bar-expense-2026-10')).toBeGreaterThanOrEqual(heightOf('bar-expense-2026-09')); // 124,50 ≥ 47 (обе почти нулевые: минимальная видимая высота)
    expect(heightOf('bar-expense-2026-08')).toBe(0); // пустой месяц — без столбика
    expect(heightOf('bar-income-2026-07')).toBeGreaterThan(0); // июльский доход 70 — виден, хоть и маленький
  });

  it('категории: сумма, прошлый месяц, «новая» и «нет трат»; строка — ссылка на операции категории месяца', async () => {
    await openPage();
    const list = screen.getByRole('list', { name: 'Расходы по категориям' });
    const rows = Array.from(list.querySelectorAll('li')).map((li) => text(li));
    expect(rows[0]).toContain('Еда');
    expect(rows[0]).toContain(fmt(12_150)); // обед 12,50 + кофе 109
    expect(rows[0]).toContain('новая');
    expect(rows[1]).toContain('Транспорт');
    const gone = rows.filter((r) => r.includes('нет трат'));
    expect(gone.some((r) => r.includes('Продукты') && r.includes(`В прошлом месяце ${fmt(4_500)}`))).toBe(true);
    const food = list.querySelector<HTMLAnchorElement>('a[data-testid^="compare-"]')!;
    expect(food.getAttribute('href')).toMatch(/^\/transactions\?month=2026-10&category=[\w-]+&kind=expense$/);
    expect(tid('compare-none')?.getAttribute('href')).toBe('/transactions?month=2026-10&category=none&kind=expense');
  });

  it('нажатие на категорию открывает список операций', async () => {
    await openPage();
    await user.click(screen.getByRole('list', { name: 'Расходы по категориям' }).querySelector('a')!);
    await waitFor(() => expect(currentPath()).toBe('/transactions'));
  });

  it('дни недели: самый «дорогой» день выделен и назван словами, среднее считается по числу таких дней', async () => {
    await openPage();
    // среды октября до 15-го: 7 и 14 → расход 14-го (такси 3 + кофе 109) ÷ 2 = 56; четверги 1, 8, 15 → 12,50 ÷ 3 = 4,16
    expect(text(tid('weekday-summary'))).toBe(`Чаще всего вы тратите по средам: в среднем ${fmt(5_600)} в такой день.`);
    expect(heightOf('weekday-bar-2')).toBeGreaterThan(heightOf('weekday-bar-3'));
    expect(heightOf('weekday-bar-0')).toBe(0); // по понедельникам не тратили
  });

  it('самые крупные расходы: крупные первыми, подпись — заметка или категория, строка открывает правку', async () => {
    await openPage();
    const items = Array.from(screen.getByRole('list', { name: 'Самые крупные расходы' }).querySelectorAll('li'));
    expect(items.map((li) => text(li))).toEqual([
      expect.stringContaining('coffee'),
      expect.stringContaining('обед'),
      expect.stringContaining('такси'),
    ]);
    expect(text(items[0])).toContain(fmt(-10_900));
    expect(items[0]!.querySelector('a')!.getAttribute('href')).toMatch(/^\/edit\//);
  });

  it('месяцы листаются: сентябрь — свои цифры; вперёд дальше текущего не пускают', async () => {
    await openPage();
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(text(tid('analytics-summary'))).toContain('Расходы за сентябрь 2026'));
    expect(text(tid('analytics-summary'))).toContain(fmt(4_700));
    expect(text(tid('analytics-trend'))).toBe('В прошлом месяце расходов не было');
    const top = Array.from(screen.getByRole('list', { name: 'Самые крупные расходы' }).querySelectorAll('li')).map((li) => text(li));
    expect(top[0]).toContain('рынок');
    expect(top).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    await waitFor(() => expect(text(tid('analytics-summary'))).toContain('Расходы за октябрь 2026'));
  });

  it('?month=2026-09 открывает сентябрь; будущий месяц и мусор — текущий', async () => {
    await openPage({ path: '/analytics?month=2026-09' });
    expect(text(tid('analytics-summary'))).toContain('Расходы за сентябрь 2026');
  });

  it.each(['/analytics?month=2027-03', '/analytics?month=ой', '/analytics?month='])('%s — открывается текущий месяц', async (path) => {
    await openPage({ path });
    expect(text(tid('analytics-summary'))).toContain('Расходы за октябрь 2026');
  });

  it('данных нет совсем — понятная подсказка, а не пустые графики', async () => {
    await openPage({ empty: true });
    expect(screen.getByRole('heading', { name: 'Пока нечего анализировать' })).toBeTruthy();
    expect(tid('monthly-bars')).toBeNull();
  });

  it('в выбранном месяце расходов нет, а в других есть: графики на месте, пустые места объяснены словами', async () => {
    await openPage({ path: '/analytics?month=2026-08' });
    expect(text(tid('analytics-summary'))).toContain(fmt(0));
    expect(text(tid('weekday-summary'))).toBe('Расходов в этом месяце пока нет.');
    expect(text(document.body)).toContain('Расходов в этом месяце пока нет.');
    expect(tid('monthly-bars')).not.toBeNull();
  });

  it('долги и переводы в расходы не попадают', async () => {
    await openPage({
      setup: async (s) => {
        const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
        const card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
        const debt = await s.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 90_000, currency: 'TJS', openedOn: '2026-10-10' });
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 90_000, occurredOn: '2026-10-10', debtId: debt.id });
        await s.transactions.create({ kind: 'transfer', walletId: cash, toWalletId: card, amountMinor: 5_000, toAmountMinor: 5_000, occurredOn: '2026-10-11' });
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 700, occurredOn: '2026-10-12' });
      },
    });
    expect(text(tid('analytics-summary'))).toContain(fmt(700));
    expect(Array.from(screen.getByRole('list', { name: 'Самые крупные расходы' }).querySelectorAll('li'))).toHaveLength(1);
  });
});

describe('«Темп трат» для идущего месяца', () => {
  const findCat = async (s: Store, name: string) => (await s.db.categories.toArray()).find((c) => c.name === name && c.kind === 'expense')!.id;
  const withSetup = (extra: (s: Store, cash: string) => Promise<unknown>) => async (s: Store) => {
    await seedHistory(s);
    const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
    await extra(s, cash);
  };

  it('прогноз на конец месяца: расход ÷ прошедшие дни × дней в месяце, с вчерашним сравнением', async () => {
    await openPage();
    // 124,50 за 15 дней из 31 → floor(12 450 × 31 ÷ 15) = 25 730 → 257,30
    const projection = tid('pace-projection')!;
    expect(text(projection)).toContain(`≈ ${fmt(25_730)}`);
    expect(text(projection)).toContain('(15 из 31)');
    expect(text(tid('pace-previous'))).toBe(`В прошлом месяце было ${fmt(4_700)}`);
  });

  it('в прошедшем месяце карточки нет: прогнозировать нечего', async () => {
    await openPage();
    expect(tid('pace-card')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(text(tid('analytics-summary'))).toContain('сентябрь 2026'));
    expect(tid('pace-card')).toBeNull();
  });

  it('лимит, который кончится раньше конца месяца: день, когда он закончится, и перерасход к концу', async () => {
    await openPage({
      setup: withSetup(async (s) => void (await s.budgets.create({ categoryId: await findCat(s, 'Еда'), amountMinor: 20_000 }))),
    });
    // «Еда» 121,50 за 15 дней при лимите 200: к концу месяца 251,10 (на 51,10 больше), лимит кончится на ceil(200 × 15 ÷ 121,5) = 25-й день
    const item = tid('pace-budget')!;
    expect(text(item)).toContain('Еда');
    expect(text(item)).toContain(`лимит ${fmt(20_000)} закончится около 25 октября`);
    expect(text(item)).toContain(`выйдет на ${fmt(5_110)} больше лимита`);
  });

  it('лимит с запасом и уже исчерпанный в список «не дотянут» не попадают', async () => {
    await openPage({
      setup: withSetup(async (s) => {
        await s.budgets.create({ categoryId: await findCat(s, 'Еда'), amountMinor: 1_000_000 }); // хватит
        await s.budgets.create({ categoryId: await findCat(s, 'Транспорт'), amountMinor: 300 }); // уже исчерпан (3 с. из 3 с.)
      }),
    });
    expect(tid('pace-budget')).toBeNull();
    expect(tid('pace-card')).not.toBeNull(); // прогноз на месте
  });

  it('необычно много: уже потрачено ≥ 120 % медианы трёх прошлых месяцев', async () => {
    await openPage({
      setup: withSetup(async (s, cash) => {
        const fun = await findCat(s, 'Развлечения');
        for (const [date, amount] of [['2026-07-10', 10_000], ['2026-08-10', 12_000], ['2026-09-10', 11_000], ['2026-10-10', 14_000]] as const) {
          await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: amount, categoryId: fun, occurredOn: date });
        }
      }),
    });
    const item = tid('pace-unusual')!;
    expect(text(item)).toBe(`Развлечения: уже ${fmt(14_000)}, а обычно за месяц около ${fmt(11_000)}`);
  });

  it('траты есть только в этом месяце — «обычного» нет, необычных нет', async () => {
    await openPage();
    expect(tid('pace-unusual')).toBeNull();
  });

  it('нет расходов в этом месяце — прогноза нет, карточка не рисуется', async () => {
    await openPage({
      setup: async (s) => {
        const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
        await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 50_000, occurredOn: '2026-10-05' });
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 700, occurredOn: '2026-09-05' });
      },
    });
    expect(tid('pace-card')).toBeNull();
  });
});

describe('«Чистый капитал»', () => {
  const cashOf = async (s: Store) => (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
  const rowsOf = () => Array.from(tid('networth-rows')?.querySelectorAll('div') ?? []).map((r) => text(r));

  it('без долгов равен «Всего» на главной (кошельки с накоплениями), «≈» — доллары пересчитаны по курсу', async () => {
    await openPage();
    // наличные 4 842,50 + карта 165 + (−10 $ × 10,9) = 4 898,50 — то же число, что «Всего» в HomePage.test
    expect(text(tid('networth-total'))).toBe(`≈ ${fmt(489_850)}`);
    expect(rowsOf()).toEqual([`Деньги в кошельках${fmt(489_850)}`]);
  });

  it('мне должны прибавляются, я должен вычитается; деньги в кошельках при этом те же', async () => {
    await openPage({
      setup: async (s) => {
        await seedHistory(s);
        await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' });
        await s.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 20_000, currency: 'TJS', openedOn: '2026-10-01' });
      },
    });
    expect(text(tid('networth-total'))).toBe(`≈ ${fmt(519_850)}`); // 4 898,50 + 500 − 200
    expect(rowsOf()).toEqual([`Деньги в кошельках${fmt(489_850)}`, `Мне должны${fmt(50_000, 'always')}`, `Я должен${fmt(-20_000)}`]);
  });

  it('остаток долга, а не его сумма: платёж уменьшает «мне должны»; закрытые и архивные долги не входят', async () => {
    await openPage({
      setup: async (s) => {
        await seedHistory(s);
        const cash = await cashOf(s);
        const a = await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' });
        await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 20_000, occurredOn: '2026-10-05', debtId: a.id });
        const closed = await s.debts.create({ direction: 'lent', counterparty: 'Закрытый', principalMinor: 9_000, currency: 'TJS', openedOn: '2026-10-01' });
        await s.debts.close(closed.id);
        const archived = await s.debts.create({ direction: 'borrowed', counterparty: 'Архивный', principalMinor: 8_000, currency: 'TJS', openedOn: '2026-10-01' });
        await s.debts.archive(archived.id);
      },
    });
    // платёж 200 лёг на «Наличные» (+200), остаток долга 300: капитал = (4 898,50 + 200) + 300
    expect(text(tid('networth-total'))).toBe(`≈ ${fmt(489_850 + 20_000 + 30_000)}`);
    expect(rowsOf()).toEqual([`Деньги в кошельках${fmt(509_850)}`, `Мне должны${fmt(30_000, 'always')}`]);
  });

  it('долг в долларах пересчитывается по курсу', async () => {
    await openPage({
      setup: async (s) => {
        await seedHistory(s);
        await s.debts.create({ direction: 'lent', counterparty: 'Джон', principalMinor: 2_000, currency: 'USD', openedOn: '2026-10-01' }); // 20 $ = 218 с.
      },
    });
    expect(rowsOf()[1]).toBe(`Мне должны${fmt(21_800, 'always')}`);
  });

  it('нет курса доллара: сумма в долларах НЕ входит, об этом сказано; «≈» стоит', async () => {
    await openPage({
      tables: [],
      setup: async (s) => {
        await seedHistory(s);
        await s.debts.create({ direction: 'borrowed', counterparty: 'Джон', principalMinor: 2_000, currency: 'USD', openedOn: '2026-10-01' });
      },
    });
    expect(text(tid('networth-total'))).toBe(`≈ ${fmt(500_750)}`); // наличные + карта, без доллара
    expect(text(tid('networth-missing'))).toBe(`Не вошло в расчёт — нет курса: ${norm(formatMinor(-1000, 'USD'))} (в кошельках), ${norm(formatMinor(2_000, 'USD'))} (я должен).`);
  });

  it('график по месяцам: конец каждого месяца считается обратным ходом от сегодняшнего итога', async () => {
    await openPage();
    const by = Object.fromEntries(tableRows('Деньги в кошельках по месяцам').map((r) => [r.querySelector('th')?.textContent, text(r.querySelector('td'))]));
    expect(Object.keys(by)).toHaveLength(12);
    expect(by['2026-10']).toBe(fmt(489_850)); // сегодня
    expect(by['2026-09']).toBe(fmt(2_300)); // до октябрьских 4 875,50 чистого дохода
    expect(by['2026-08']).toBe(fmt(7_000)); // до сентябрьских расходов 47
    expect(by['2026-07']).toBe(fmt(7_000));
    expect(by['2026-06']).toBe(fmt(0)); // до июльской подработки 70
    expect(by['2025-11']).toBe(fmt(0));
    expect(tid('balance-line')).not.toBeNull();
    expect(text(document.body)).toContain('Долги в историю не входят');
  });

  it('капитал не зависит от выбранного месяца', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(text(tid('analytics-summary'))).toContain('сентябрь 2026'));
    expect(text(tid('networth-total'))).toBe(`≈ ${fmt(489_850)}`);
  });
});

