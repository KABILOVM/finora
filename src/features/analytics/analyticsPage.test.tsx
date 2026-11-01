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
import { useLocation } from 'react-router-dom';
import AnalyticsPage, { expenseTrend } from './AnalyticsPage';

/** Строка запроса адреса: по ней видно, что экран записал (?tab=…&month=…). */
function SearchProbe() {
  return <p data-testid="search">{useLocation().search}</p>;
}

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

  it.each([
    [200, 100, 'На 100% больше, чем за те же 15 дней прошлого месяца'],
    [50, 100, 'На 50% меньше, чем за те же 15 дней прошлого месяца'],
    [100, 100, 'Столько же, сколько за те же 15 дней прошлого месяца'],
    [100, 0, 'За те же 15 дней прошлого месяца расходов не было'],
    [0, 0, null],
  ])('идущий месяц, первые 15 дней: %i против %i → %s', (cur, prev, expected) => expect(expenseTrend(cur, prev, 15)).toBe(expected));
});

describe('экран «Аналитика»', () => {
  it('итог месяца: расходы, доходы, разница и сравнение с прошлым месяцем', async () => {
    await openPage();
    const summary = tid('analytics-summary')!;
    expect(text(summary)).toContain('Расходы за октябрь 2026');
    expect(text(summary)).toContain(fmt(12_450));
    // 15 октября сравниваем с 1–15 сентября (там только «без категории» 2,00), а не со всем сентябрем (47)
    expect(text(tid('analytics-trend'))).toBe('На 6125% больше, чем за те же 15 дней прошлого месяца'); // (124,50 − 2) ÷ 2
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
    // идущий месяц сравнивается с теми же днями прошлого: «Продукты» (20 сентября) в сравнение не попали, «без категории» (3 сентября) — да
    const gone = rows.filter((r) => r.includes('нет трат'));
    expect(gone.some((r) => r.includes('Без категории') && r.includes(`За те же 15 дней прошлого месяца ${fmt(200)}`))).toBe(true);
    expect(rows.some((r) => r.includes('Продукты'))).toBe(false);
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
    expect(text(tid('weekday-summary'))).toBe(`Больше всего вы тратите по средам: в среднем ${fmt(5_600)} в такой день.`);
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

  it.each(['/analytics?month=2027-03', '/analytics?month=ой', '/analytics?month=', '/analytics?month=0000-01', '/analytics?month=1999-12'])('%s — открывается текущий месяц', async (path) => {
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
    expect(text(tid('pace-previous'))).toBe(`В прошлом месяце целиком было ${fmt(4_700)}`);
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

describe('экран «Аналитика»: вкладка и месяц в адресе', () => {
  const search = () => document.querySelector('[data-testid="search"]')?.textContent ?? '';

  async function openWithSearch(path: string) {
    const td = opsDeps([table()], { setup: async (s) => void (await seedHistory(s)) });
    await showApp(
      <>
        <AnalyticsPage />
        <SearchProbe />
      </>,
      td,
      path,
    );
    await findByRole('heading', { name: 'Аналитика', level: 1 });
    await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
  }

  it('по умолчанию адрес чистый; листание месяца пишет ?month=, возврат к текущему — снова чистый адрес', async () => {
    await openWithSearch('/analytics');
    expect(search()).toBe('');
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(search()).toBe('?month=2026-09'));
    await user.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    await waitFor(() => expect(search()).toBe(''));
  });

  it('вкладка «Календарь» пишется в адрес и открывается по ссылке; «Обзор» — снова чистый адрес', async () => {
    await openWithSearch('/analytics?tab=calendar');
    expect(screen.getByRole('radio', { name: 'Календарь' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', { name: 'Обзор' }));
    await waitFor(() => expect(search()).toBe(''));
    expect(tid('analytics-summary')).not.toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Календарь' }));
    await waitFor(() => expect(search()).toBe('?tab=calendar'));
  });

  it('вкладка и выбранный месяц живут вместе: ?tab=calendar&month=2026-08 сохраняет оба', async () => {
    await openWithSearch('/analytics?month=2026-08');
    await user.click(screen.getByRole('radio', { name: 'Календарь' }));
    await waitFor(() => expect(search()).toBe('?tab=calendar&month=2026-08'));
    await user.click(screen.getByRole('radio', { name: 'Обзор' }));
    await waitFor(() => expect(search()).toBe('?month=2026-08'));
    expect(text(tid('analytics-summary'))).toContain('Расходы за август 2026');
  });

  it('мусорная вкладка в адресе — «Обзор»', async () => {
    await openWithSearch('/analytics?tab=что-то');
    expect(screen.getByRole('radio', { name: 'Обзор' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('экран «Аналитика»: идущий и прошедший месяц', () => {
  it('идущий месяц: сказано, что сравнение — с теми же днями прошлого', async () => {
    await openPage();
    expect(text(document.body)).toContain('Месяц ещё идёт, поэтому сравниваем с числами 1–15 прошлого месяца, а не со всем месяцем');
  });

  it('прошедший месяц сравнивается с целым прошлым: оговорки нет, текст прежний', async () => {
    await openPage({ path: '/analytics?month=2026-09' });
    expect(text(document.body)).not.toContain('Месяц ещё идёт');
    expect(text(tid('analytics-trend'))).toBe('В прошлом месяце расходов не было');
  });
});

describe('экран «Аналитика»: категории с долями', () => {
  it('у категории — доля от всех расходов месяца и полоска; мелкая доля — «<1%»', async () => {
    await openPage({
      setup: async (s) => {
        await seedHistory(s);
        const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
        const c = await s.categories.create({ name: 'Мелочь', kind: 'expense', color: '#f97316', icon: '🛒' });
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1, categoryId: c.id, occurredOn: '2026-10-13' });
      },
    });
    // расходы октября 124,51: «Еда» 121,50 → 97%, «Транспорт» 3,00 → 2%, «Мелочь» 0,01 → меньше процента
    const rows = Array.from(screen.getByRole('list', { name: 'Расходы по категориям' }).querySelectorAll('li'));
    const row = (name: string) => rows.find((li) => text(li).includes(name))!;
    expect(text(row('Еда').querySelector('[data-testid^="share-"]'))).toBe('97%');
    expect(text(row('Транспорт').querySelector('[data-testid^="share-"]'))).toBe('2%');
    expect(text(row('Мелочь').querySelector('[data-testid^="share-"]'))).toBe('<1%');
    // у самой мелкой категории полоска всё равно видна (не меньше 2% ширины)
    expect(row('Мелочь').querySelector<HTMLElement>('span[class~="bg-brand/70"]')?.style.width).toBe('2%');
  });

  it('больше восьми категорий: восемь сразу, «Показать ещё 4 категории» раскрывает остальные, «Свернуть» возвращает', async () => {
    await openPage({
      setup: async (s) => {
        await seedHistory(s);
        const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
        for (let i = 1; i <= 9; i++) {
          const c = await s.categories.create({ name: `Кат ${i}`, kind: 'expense', color: '#f97316', icon: '🛒' });
          await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 100 * i, categoryId: c.id, occurredOn: '2026-10-13' });
        }
      },
    });
    // Еда, Транспорт + 9 новых = 11 с тратами, и «Без категории» из первых дней сентября (в октябре её нет) = 12 строк
    const list = () => screen.getByRole('list', { name: 'Расходы по категориям' });
    expect(list().querySelectorAll('li')).toHaveLength(8);
    const more = screen.getByRole('button', { name: 'Показать ещё 4 категории' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await user.click(more);
    expect(list().querySelectorAll('li')).toHaveLength(12);
    const less = screen.getByRole('button', { name: 'Свернуть' });
    expect(less.getAttribute('aria-expanded')).toBe('true');
    await user.click(less);
    expect(list().querySelectorAll('li')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Показать ещё 4 категории' })).toBeTruthy();
  });

  it('категория, которой не было в первых 15 днях сентября, но была 20-го, — «без сравнения», а не «новая»', async () => {
    await openPage({
      setup: async (s) => {
        await seedHistory(s); // «Продукты» в сентябре — 45 с. 20-го
        const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
        const food = (await s.db.categories.toArray()).find((c) => c.name === 'Продукты' && c.kind === 'expense')!.id;
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 8_000, categoryId: food, occurredOn: '2026-10-14' });
      },
    });
    const rows = Array.from(screen.getByRole('list', { name: 'Расходы по категориям' }).querySelectorAll('li')).map((li) => text(li));
    const products = rows.find((r) => r.includes('Продукты'))!;
    expect(products).toContain('без сравнения');
    expect(products).not.toContain('новая');
    expect(products).toContain('За те же 15 дней прошлого месяца трат не было');
    // «Еда» в сентябре не тратилась совсем — для неё «новая» по-прежнему верно
    expect(rows.find((r) => r.startsWith('Еда'))).toContain('новая');
  });

  it('«новая» не повторяется пояснением «трат не было» в каждой строке; у строк с прошлой суммой и у «без сравнения» пояснение остаётся', async () => {
    await openPage({
      setup: async (s) => {
        await seedHistory(s); // «Продукты» в сентябре — 45 с. 20-го; «Без категории» — 2 с. 3-го
        const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
        const cats = await s.db.categories.toArray();
        const id = (name: string) => cats.find((c) => c.name === name && c.kind === 'expense')!.id;
        // «Продукты»: в первых 15 днях сентября не было, но была 20-го — «без сравнения»
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 8_000, categoryId: id('Продукты'), occurredOn: '2026-10-14' });
        // «Жильё»: в сентябре не было совсем — «новая»; «Связь» — тоже «новая»
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 9_000, categoryId: id('Жильё'), occurredOn: '2026-10-13' });
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1_000, categoryId: id('Связь'), occurredOn: '2026-10-12' });
      },
    });
    const rows = Array.from(screen.getByRole('list', { name: 'Расходы по категориям' }).querySelectorAll('li')).map((li) => text(li));
    const row = (name: string) => rows.find((r) => r.includes(name))!;
    for (const name of ['Жильё', 'Связь', 'Еда']) {
      expect(row(name), name).toContain('новая');
      expect(row(name), `${name}: без повтора`).not.toContain('трат не было');
    }
    // «без сравнения»: пояснение осталось, оно объясняет отсутствие процента
    expect(row('Продукты')).toContain('без сравнения');
    expect(row('Продукты')).toContain('За те же 15 дней прошлого месяца трат не было');
    // категория с суммой в прошлом: пояснение — это сама прошлая сумма
    expect(rows.some((r) => r.includes('Без категории') && r.includes(`За те же 15 дней прошлого месяца ${fmt(200)}`))).toBe(true);
    // а «трат не было» во всём списке — ровно один раз (у «без сравнения»)
    expect(rows.filter((r) => r.includes('трат не было'))).toHaveLength(1);
  });

  it('идущий месяц без расходов, а в прошлом они были позже: «в этом месяце пока нет», а не «в этом и прошлом нет»', async () => {
    await openPage({
      setup: async (s) => {
        const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
        const food = (await s.db.categories.toArray()).find((c) => c.name === 'Продукты' && c.kind === 'expense')!.id;
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 4_500, categoryId: food, occurredOn: '2026-09-20' });
      },
    });
    const section = document.getElementById('analytics-categories')!.parentElement!;
    expect(text(section)).toContain('В этом месяце расходов пока нет.');
    expect(text(section)).not.toContain('в этом и прошлом месяце нет');
  });
});

describe('экран «Аналитика»: первые дни и операции из будущего', () => {
  it('2 октября: сравнения нет — «Месяц только начался», у категорий нет «новая» и «нет трат»', async () => {
    vi.setSystemTime(new Date(2026, 9, 2, 12, 0, 0));
    await openPage({
      setup: async (s) => {
        await seedHistory(s);
        const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
        const food = (await s.db.categories.toArray()).find((c) => c.name === 'Еда' && c.kind === 'expense')!.id;
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 5_000, categoryId: food, occurredOn: '2026-10-02' });
      },
    });
    expect(tid('analytics-trend')).toBeNull();
    expect(text(tid('analytics-trend-early'))).toBe('Месяц только начался: сравнение с прошлым появится на 3-й день.');
    const list = screen.getByRole('list', { name: 'Расходы по категориям' });
    const rows = Array.from(list.querySelectorAll('li')).map((li) => text(li));
    expect(rows).toHaveLength(1); // только «Еда» этого месяца; «Без категории» из сентября не вылезает строкой «нет трат»
    expect(rows[0]).toContain('Еда');
    expect(rows[0]).not.toMatch(/новая|нет трат|без сравнения|прошлого месяца/);
    expect(text(tid('compare-note'))).toBe('Месяц только начался: сравнение с прошлым месяцем появится через пару дней.');
  });

  it('3 октября сравнение уже есть: с числами 1–3 сентября', async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 12, 0, 0));
    await openPage();
    expect(tid('analytics-trend-early')).toBeNull();
    expect(text(tid('compare-note'))).toContain('с числами 1–3 прошлого месяца');
  });

  it('операция с датой позже сегодняшней: в итоге месяца есть, в сравнение не входит, об этом сказано', async () => {
    await openPage({
      setup: async (s) => {
        await seedHistory(s);
        const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
        const rent = await s.categories.create({ name: 'Аренда', kind: 'expense', color: '#f97316', icon: '🏠' });
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 50_000, categoryId: rent.id, occurredOn: '2026-10-25' });
      },
    });
    // 124,50 + 500 = 624,50 в заголовке; тренд считается по 124,50 (до сегодня) против 2 с. за те же дни сентября
    expect(text(tid('analytics-summary'))).toContain(fmt(62_450));
    expect(text(tid('analytics-trend'))).toBe('На 6125% больше, чем за те же 15 дней прошлого месяца');
    expect(text(tid('analytics-planned'))).toContain(fmt(50_000));
    // «Аренды» в сравнении нет (она ещё не случилась), а доли — от расходов до сегодняшнего дня
    const rows = Array.from(screen.getByRole('list', { name: 'Расходы по категориям' }).querySelectorAll('li')).map((li) => text(li));
    expect(rows.some((r) => r.includes('Аренда'))).toBe(false);
    expect(text(tid(`share-${document.querySelector<HTMLElement>('a[data-testid^="compare-"]')!.dataset['testid']!.replace('compare-', '')}`))).toBe('97%');
  });

  it('без операций из будущего строки «Из них…» нет', async () => {
    await openPage();
    expect(tid('analytics-planned')).toBeNull();
  });
});

describe('экран «Аналитика»: график по месяцам и порядок блоков', () => {
  it('под графиком — числа выбранного месяца; нажатие на месяц переключает экран на него', async () => {
    await openPage();
    expect(text(tid('monthly-selected'))).toBe(
      `Октябрь 2026: доходы ${fmt(500_000)} · расходы ${fmt(12_450)} · разница ${fmt(487_550, 'always')}`,
    );
    await user.click(screen.getByRole('button', { name: 'Сентябрь 2026' }));
    await waitFor(() => expect(text(tid('analytics-summary'))).toContain('Расходы за сентябрь 2026'));
    expect(text(tid('monthly-selected'))).toContain('Сентябрь 2026: доходы');
    expect(screen.getByRole('button', { name: 'Сентябрь 2026' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('порядок: итог → темп → категории → крупные расходы → по месяцам → дни недели → деньги в кошельках', async () => {
    await openPage();
    await waitFor(() => expect(tid('networth-total')).not.toBeNull());
    const order = [
      tid('analytics-summary'),
      tid('pace-card'),
      document.getElementById('analytics-categories'),
      document.getElementById('analytics-top'),
      document.getElementById('analytics-months'),
      document.getElementById('analytics-weekdays'),
      tid('networth-total'),
    ];
    expect(order.every((el) => el !== null)).toBe(true);
    // в jsdom нет вёрстки: порядок проверяем по положению в документе
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    for (let i = 0; i < order.length - 1; i++) expect(follows(order[i]!, order[i + 1]!), `блок ${i} раньше блока ${i + 1}`).toBe(true);
  });
});

describe('экран «Аналитика»: куда уходят деньги', () => {
  /** Данные октября 2026: «такси» трижды (одно с меткой), «базар» дважды, «кино» один раз; кошельки «Наличные» и «Карта». */
  async function seedWhere(s: Store) {
    const wallets = await s.db.wallets.toArray();
    const cash = wallets.find((w) => w.name === 'Наличные')!.id;
    const card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
    const food = (await s.db.categories.toArray()).find((c) => c.name === 'Еда' && c.kind === 'expense')!.id;
    const add = (walletId: string, amountMinor: number, note: string, occurredOn = '2026-10-12') =>
      s.transactions.create({ kind: 'expense', walletId, amountMinor, categoryId: food, occurredOn, note });
    await add(cash, 3000, 'Такси');
    await add(card, 2000, 'такси');
    await add(card, 5000, 'такси #Самарканд', '2026-10-13');
    await add(cash, 4000, 'базар');
    await add(cash, 6000, 'Базар');
    await add(card, 9000, 'кино #Самарканд', '2026-10-14');
    await add(cash, 1000, 'кофе #работа', '2026-10-14');
  }
  const section = () => document.getElementById('analytics-where')?.parentElement ?? null;
  const rows = (name: string) => Array.from(section()?.querySelectorAll(`ul[aria-label="${name}"] > li`) ?? []).map((li) => text(li));
  const tab = (name: string) => screen.getByRole('radio', { name });

  it('«Заметки» — первая вкладка: одинаковые заметки вместе (без регистра и меток), суммы, число операций и доля', async () => {
    await openPage({ setup: seedWhere });
    expect(tab('Заметки')).toBeChecked();
    const list = rows('Расходы: заметки');
    // базар 40+60 = 100 (2), такси 30+20+50 = 100 (3); при равных суммах — у кого больше операций; «кино» одно — не в списке
    expect(list).toHaveLength(2);
    expect(list[0]).toContain('такси');
    expect(list[0]).toContain('3 операции');
    expect(list[0]).toContain(fmt(10_000));
    expect(list[1]).toContain('2 операции');
    expect(list[1]).toContain(fmt(10_000));
    expect(text(section())).not.toContain('кино');
    // расходы месяца: 100 + 100 + 90 + 10 = 300 → по 33% (100 из 300)
    expect(text(tid('where-share-note'))).toBe('33%');
  });

  it('«Кошельки»: сколько ушло с каждого; строка — ссылка на расходы кошелька за месяц', async () => {
    const td = await openPage({ setup: seedWhere });
    await user.click(tab('Кошельки'));
    const list = rows('Расходы: кошельки');
    // Наличные 30+40+60+10 = 140; Карта 20+50+90 = 160
    expect(list[0]).toContain('Карта');
    expect(list[0]).toContain(fmt(16_000));
    expect(list[1]).toContain('Наличные');
    expect(list[1]).toContain(fmt(14_000));
    const card = (await td.stores[0]!.db.wallets.toArray()).find((w) => w.name === 'Карта')!.id;
    const link = section()?.querySelector<HTMLAnchorElement>('ul[aria-label="Расходы: кошельки"] a');
    expect(link?.getAttribute('href')).toBe(`/transactions?month=2026-10&wallet=${card}&kind=expense`);
    // доли — от всех расходов месяца (300): 160 → 53%
    expect(text(tid('where-share-wallet'))).toBe('53%');
  });

  it('нажатие на кошелёк открывает «Операции» с его расходами за месяц', async () => {
    await openPage({ setup: seedWhere });
    await user.click(tab('Кошельки'));
    await user.click(section()!.querySelector('ul[aria-label="Расходы: кошельки"] a')!);
    await waitFor(() => expect(currentPath()).toBe('/transactions'));
  });

  it('«Метки»: траты разных заметок под одной меткой; пояснение про пересечение меток', async () => {
    await openPage({ setup: seedWhere });
    await user.click(tab('Метки'));
    const list = rows('Расходы: метки');
    expect(list).toHaveLength(2);
    expect(list[0]).toContain('#Самарканд');
    expect(list[0]).toContain('2 операции');
    expect(list[0]).toContain(fmt(14_000)); // такси 50 + кино 90
    expect(list[1]).toContain('#работа');
    expect(text(section())).toContain('Метки могут пересекаться');
  });

  it('одна метка — без пояснения про пересечение', async () => {
    await openPage({
      setup: async (s) => {
        const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 3000, occurredOn: '2026-10-12', note: 'такси #Самарканд' });
      },
    });
    await user.click(tab('Метки'));
    expect(rows('Расходы: метки')).toHaveLength(1);
    expect(text(section())).not.toContain('Метки могут пересекаться');
  });

  it('нет повторяющихся заметок — первой открывается «Кошельки»; на «Заметках» подсказка, что нужно для групп', async () => {
    await openPage(); // seedHistory: все заметки разные
    expect(tab('Кошельки')).toBeChecked();
    expect(rows('Расходы: кошельки').length).toBeGreaterThan(0);
    await user.click(tab('Заметки'));
    expect(text(tid('where-empty'))).toContain('Здесь появятся повторяющиеся траты');
    await user.click(tab('Метки'));
    expect(text(tid('where-empty'))).toContain('Меток пока нет');
  });

  it('выбранная вкладка остаётся, а «Показать ещё» раскрывает остальное: больше восьми строк', async () => {
    await openPage({
      setup: async (s) => {
        const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
        for (let i = 1; i <= 10; i++) {
          for (let k = 0; k < 2; k++) await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 100 * i, occurredOn: '2026-10-12', note: `товар ${i}` });
        }
      },
    });
    expect(rows('Расходы: заметки')).toHaveLength(8);
    const more = screen.getByRole('button', { name: 'Показать ещё 2' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await user.click(more);
    expect(rows('Расходы: заметки')).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(rows('Расходы: заметки')).toHaveLength(8);
  });

  it('другой месяц — его группы; в месяце без расходов блока нет', async () => {
    await openPage({ setup: seedWhere });
    expect(section()).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(section()).toBeNull()); // в сентябре у этих данных расходов нет
  });
});
