import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { write } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { formatMinor } from '@/domain/money';
import type { SyncEngineApi, SyncStatus } from '@/sync/transport';
import { SyncProvider } from '@/sync/syncContext';
import {
  backgroundPath,
  choose,
  currentPath,
  LocationProbe,
  opsDeps,
  pinToday,
  rowTexts,
  seedHistory,
  showApp,
  storeOf,
  table,
  type History,
  unpinToday,
} from './__fixtures__/opsKit';
import { dayTotal, periodRange, shiftMonth, toTxFilter, type ListFilters } from './txFilters';
import TransactionsPage, { PAGE_SIZE } from './TransactionsPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

let hist: History = { cash: '', card: '', usd: '', txs: {} };

async function openList(options: { empty?: boolean; sync?: SyncEngineApi | null } = {}) {
  const td = opsDeps([table()], {
    setup: async (s) => {
      if (!options.empty) hist = await seedHistory(s);
    },
  });
  const page = (
    <>
      <TransactionsPage />
      <LocationProbe />
    </>
  );
  await showApp(options.sync ? <SyncProvider engine={options.sync}>{page}</SyncProvider> : page, td, '/transactions');
  await findByRole('heading', { name: 'Операции', level: 1 });
  // данные прочитаны: есть панель фильтров (или подсказка «Операций пока нет»)
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const has = (needle: string) => rowTexts().some((t) => t.includes(needle));
const days = () => Array.from(document.querySelectorAll('section[aria-label]')).map((s) => s.getAttribute('aria-label'));
const section = (label: string) => document.querySelector(`section[aria-label="${label}"]`);
const period = (name: string) => user.click(screen.getByRole('button', { name }));
const money = (minor: number, currency = 'TJS', sign: 'auto' | 'always' = 'auto') => formatMinor(minor, currency, { sign });

describe('список по дням', () => {
  it('по умолчанию — этот месяц: «Сегодня» и «Вчера», новые дни сверху; прошлые месяцы скрыты', async () => {
    await openList();
    await waitFor(() => expect(days()).toEqual(['Сегодня', 'Вчера']));
    expect(has('обед')).toBe(true);
    expect(has('рынок')).toBe(false);
    expect(has('Работа')).toBe(false);
  });

  it('внутри дня новые операции сверху', async () => {
    await openList();
    await waitFor(() => expect(days()).toEqual(['Сегодня', 'Вчера']));
    const today = Array.from(section('Сегодня')?.querySelectorAll('button') ?? []).map((b) => b.textContent ?? '');
    expect(today).toHaveLength(2);
    expect(today[0]).toContain('Зарплата'); // «аванс» внесён позже «обеда»
    expect(today[1]).toContain('Еда');
  });

  it('итог дня — доходы минус расходы в основной валюте; переводы не считаются; доллары — по снимку курса', async () => {
    await openList();
    await waitFor(() => expect(days()).toEqual(['Сегодня', 'Вчера']));
    // сегодня: +5 000 − 12,50
    expect(section('Сегодня')?.querySelector('header')?.textContent).toContain(money(500_000 - 1250, 'TJS', 'always'));
    // вчера: −3 (такси) − 109 (10 $ по 10,9); перевод 100 с. в итог не входит
    expect(section('Вчера')?.querySelector('header')?.textContent).toContain(money(-(300 + 10_900), 'TJS', 'always'));
  });

  it('строка: значок и название категории, кошелёк, заметка, сумма с цветом; перевод — «A → B» без цвета', async () => {
    await openList();
    await waitFor(() => expect(has('обед')).toBe(true));
    const lunch = rowTexts().find((t) => t.includes('обед')) ?? '';
    expect(lunch).toContain('🍽️');
    expect(lunch).toContain('Еда');
    expect(lunch).toContain('Наличные · обед');
    expect(lunch).toContain(money(-1250));

    const salary = Array.from(document.querySelectorAll('section[aria-label] button')).find((b) => b.textContent?.includes('аванс'));
    expect(salary?.textContent).toContain(money(500_000, 'TJS', 'always'));
    expect(salary?.innerHTML).toContain('text-income');
    expect(Array.from(document.querySelectorAll('section[aria-label] button')).find((b) => b.textContent?.includes('обед'))?.innerHTML).toContain('text-expense');

    const move = Array.from(document.querySelectorAll('section[aria-label] button')).find((b) => b.textContent?.includes('Наличные → Карта'));
    expect(move?.textContent).toContain(money(10_000));
    expect(move?.innerHTML).not.toContain('text-income');
    expect(move?.innerHTML).not.toContain('text-expense');

    // расход в долларах показан в долларах
    expect(rowTexts().find((t) => t.includes('coffee'))).toContain(money(-1000, 'USD'));
  });

  it('нажатие на строку открывает /edit/:id поверх списка', async () => {
    await openList();
    await waitFor(() => expect(has('обед')).toBe(true));
    await user.click(screen.getByText('Наличные · обед'));
    expect(currentPath()).toBe(`/edit/${hist.txs['lunch']}`);
    expect(backgroundPath()).toBe('/transactions');
  });
});

describe('период', () => {
  it('«Прошлый» — сентябрь; «Всё время» — всё; «Другой месяц» листается стрелками', async () => {
    await openList();
    await waitFor(() => expect(has('обед')).toBe(true));

    await period('Прошлый');
    await waitFor(() => expect(has('рынок')).toBe(true));
    expect(has('обед')).toBe(false);
    expect(has('Работа')).toBe(false);
    expect(days()).toEqual(['вс, 20 сен', 'чт, 3 сен']);

    await period('Всё время');
    await waitFor(() => expect(has('Работа')).toBe(true));
    expect(has('обед')).toBe(true);
    expect(days()).toHaveLength(5);

    await period('Другой месяц');
    expect(screen.getByText('Октябрь 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled(); // дальше текущего не листаем
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    // пока читается новый месяц, на экране ещё прежний список — ждём, когда он сменится
    await waitFor(() => expect(has('обед')).toBe(false));
    expect(has('рынок')).toBe(true);
    expect(has('Работа')).toBe(false);
    expect(screen.getByText('Сентябрь 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(has('рынок')).toBe(false));
    expect(has('Работа')).toBe(true);
    expect(screen.getByText('Июль 2026')).toBeInTheDocument();
  });
});

describe('фильтры', () => {
  it('по кошельку: и расходы с него, и переводы НА него', async () => {
    await openList();
    await period('Всё время');
    await waitFor(() => expect(has('Работа')).toBe(true));
    choose('Кошелёк', 'Карта');
    await waitFor(() => expect(has('обед')).toBe(false));
    expect(has('такси')).toBe(true);
    expect(has('Наличные → Карта')).toBe(true);
    expect(has('Работа')).toBe(true);
    expect(has('рынок')).toBe(false);
  });

  it('по категории и «Без категории»', async () => {
    await openList();
    await period('Всё время');
    await waitFor(() => expect(has('Работа')).toBe(true));
    choose('Категория', 'Еда');
    await waitFor(() => expect(rowTexts()).toHaveLength(2));
    expect(has('обед')).toBe(true);
    expect(has('coffee')).toBe(true);
    choose('Категория', 'Без категории');
    await waitFor(() => expect(rowTexts()).toHaveLength(1));
    expect(rowTexts()[0]).toContain('Без категории');
    expect(has('Наличные → Карта')).toBe(false); // перевод — не «пропущенная» категория
  });

  it('по виду; у переводов категории нет — список категорий отключается и сбрасывается', async () => {
    await openList();
    await period('Всё время');
    await waitFor(() => expect(has('Работа')).toBe(true));
    choose('Категория', 'Еда');
    await waitFor(() => expect(rowTexts()).toHaveLength(2));
    choose('Вид операции', 'Доходы'); // «Еда» — категория расходов: не подходит к доходам
    await waitFor(() => expect(has('аванс')).toBe(true));
    expect(rowTexts()).toHaveLength(2);
    expect(has('Работа')).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Категория' }) as HTMLSelectElement).value).toBe('');
    choose('Вид операции', 'Переводы');
    await waitFor(() => expect(rowTexts()).toHaveLength(1));
    expect(has('Наличные → Карта')).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Категория' })).toBeDisabled();
    choose('Вид операции', 'Расходы');
    await waitFor(() => expect(rowTexts()).toHaveLength(5));
  });

  it('фильтры складываются: кошелёк + вид + период', async () => {
    await openList();
    await period('Всё время');
    await waitFor(() => expect(has('Работа')).toBe(true));
    choose('Кошелёк', 'Карта');
    choose('Вид операции', 'Расходы');
    await waitFor(() => expect(rowTexts()).toHaveLength(2));
    expect(has('такси')).toBe(true);
    expect(has('Без категории')).toBe(true);
  });
});

describe('поиск по заметке', () => {
  it('ищет без учёта регистра, после паузы в наборе', async () => {
    await openList();
    await period('Всё время');
    await waitFor(() => expect(has('Работа')).toBe(true));
    const search = screen.getByRole('textbox', { name: 'Поиск по заметке' });
    await user.type(search, 'ТАКСИ');
    // сразу после набора запрос ещё не ушёл
    expect(has('обед')).toBe(true);
    await waitFor(() => expect(has('обед')).toBe(false));
    expect(rowTexts()).toHaveLength(1);
    expect(has('такси')).toBe(true);
  });

  it('ничего не найдено → понятное сообщение; «Показать всё» сбрасывает поиск', async () => {
    await openList();
    const search = screen.getByRole('textbox', { name: 'Поиск по заметке' });
    await user.type(search, 'qqqq');
    expect(await waitFor(() => screen.getByText('Ничего не найдено'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Показать всё' }));
    await waitFor(() => expect(has('Работа')).toBe(true));
    expect((screen.getByRole('textbox', { name: 'Поиск по заметке' }) as HTMLInputElement).value).toBe('');
  });
});

describe('удалённые операции', () => {
  it('удалённая не видна и не входит в итог дня; строка в базе остаётся', async () => {
    const td = await openList();
    await waitFor(() => expect(has('обед')).toBe(true));
    await write(() => storeOf(td).transactions.softDelete(hist.txs['advance'] ?? ''));
    await waitFor(() => expect(has('аванс')).toBe(false));
    expect(section('Сегодня')?.querySelector('header')?.textContent).toContain(money(-1250, 'TJS', 'always'));
    expect(await storeOf(td).db.transactions.count()).toBe(8);
  });

  it('удалили всё — снова «Операций пока нет» с кнопкой добавления', async () => {
    const td = await openList();
    await waitFor(() => expect(has('обед')).toBe(true));
    for (const t of await storeOf(td).db.transactions.toArray()) await write(() => storeOf(td).transactions.softDelete(t.id));
    expect(await waitFor(() => screen.getByText('Операций пока нет'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Добавить операцию' })).toHaveAttribute('href', '/add');
  });
});

describe('пустое состояние', () => {
  it('нет ни одной операции: подсказка и кнопка, фильтров нет', async () => {
    await openList({ empty: true });
    expect(await waitFor(() => screen.getByText('Операций пока нет'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Добавить операцию' })).toHaveAttribute('href', '/add');
    expect(screen.queryByRole('textbox', { name: 'Поиск по заметке' })).toBeNull();
  });
});

describe('длинный список', () => {
  it('сначала ~200 операций (днями целиком), «Показать ещё» добавляет остальные', async () => {
    const td = opsDeps([], {
      setup: async (s) => {
        const w = (await s.db.wallets.toArray())[0];
        // 25 дней по 10 операций = 250
        for (let d = 1; d <= 25; d++) {
          const day = `2024-03-${String(d).padStart(2, '0')}`;
          await Promise.all(
            Array.from({ length: 10 }, (_, i) =>
              s.transactions.create({ kind: 'expense', walletId: w?.id ?? '', amountMinor: 100 + i, occurredOn: day, note: `н${d}-${i}` }),
            ),
          );
        }
      },
    });
    await showApp(<TransactionsPage />, td, '/transactions');
    await findByRole('heading', { name: 'Операции', level: 1 });
    await user.click(await findByRole('button', { name: 'Всё время' }));
    await waitFor(() => expect(rowTexts()).toHaveLength(PAGE_SIZE), 8000);
    expect(screen.getByText('Показано 200 из 250')).toBeInTheDocument();
    expect(days()).toHaveLength(20); // день не режется пополам
    await user.click(screen.getByRole('button', { name: 'Показать ещё' }));
    await waitFor(() => expect(rowTexts()).toHaveLength(250), 8000);
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
    // смена фильтра возвращает к первым 200
    await user.click(screen.getByRole('button', { name: 'Этот месяц' }));
    await user.click(screen.getByRole('button', { name: 'Всё время' }));
    await waitFor(() => expect(rowTexts()).toHaveLength(PAGE_SIZE), 8000);
  }, 60000);
});

describe('метки синхронизации', () => {
  const status: SyncStatus = { phase: 'idle', pending: 0, quarantined: 0, lastSyncedAt: null, lastError: null };
  const engine: SyncEngineApi = {
    subscribe: (l) => {
      l(status);
      return () => undefined;
    },
    getStatus: () => status,
    syncNow: async () => undefined,
    start: () => undefined,
    stop: () => undefined,
  };

  it('локальный режим: «ждёт отправки» не показываем — отправлять нечего', async () => {
    await openList();
    await waitFor(() => expect(has('обед')).toBe(true));
    expect(screen.queryByText('ждёт отправки')).toBeNull();
  });

  it('облако включено: неотправленные помечены, отправленные — нет; отвергнутые сервером — отдельная метка', async () => {
    const td = await openList({ sync: engine });
    await waitFor(() => expect(has('обед')).toBe(true));
    expect(screen.getAllByText('ждёт отправки').length).toBeGreaterThanOrEqual(5);

    // «отправили» обед; сервер отверг такси
    await write(async () => {
      await storeOf(td).db.transactions.update(hist.txs['lunch'] ?? '', { dirty: 0 });
      await storeOf(td).db.transactions.update(hist.txs['taxi'] ?? '', { dirty: 0, syncError: 'нарушено ограничение' });
    });
    await waitFor(() => expect(screen.getByText('не принято сервером')).toBeInTheDocument());
    const lunch = Array.from(document.querySelectorAll('section[aria-label] button')).find((b) => b.textContent?.includes('обед'));
    expect(lunch?.textContent).not.toContain('ждёт отправки');
    const taxi = Array.from(document.querySelectorAll('section[aria-label] button')).find((b) => b.textContent?.includes('такси'));
    expect(taxi?.textContent).toContain('не принято сервером');
  });
});

describe('чистые функции фильтров', () => {
  const f = (over: Partial<ListFilters> = {}): ListFilters => ({
    period: 'this',
    month: '2026-10',
    walletId: '',
    categoryId: '',
    kind: '',
    search: '',
    ...over,
  });

  it('shiftMonth переходит через границу года в обе стороны', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', -10)).toBe('2025-12');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
    expect(() => shiftMonth('2026-1', 1)).toThrow(RangeError);
  });

  it('periodRange: этот, прошлый (в том числе в январе), выбранный месяц и всё время', () => {
    expect(periodRange('this', '', '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('prev', '', '2026-10-15')).toEqual({ from: '2026-09-01', to: '2026-09-31' });
    expect(periodRange('prev', '', '2026-01-02')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange('month', '2024-02', '2026-10-15')).toEqual({ from: '2024-02-01', to: '2024-02-31' });
    expect(periodRange('all', '', '2026-10-15')).toEqual({});
  });

  it('toTxFilter: «без категории» → null, пустые условия не попадают в запрос, пробелы поиска не считаются', () => {
    expect(toTxFilter(f({ period: 'all' }), '', '2026-10-15')).toEqual({});
    expect(toTxFilter(f({ period: 'all', categoryId: '__none__' }), '', '2026-10-15')).toEqual({ categoryId: null });
    expect(toTxFilter(f({ period: 'all', categoryId: 'c1', walletId: 'w1', kind: 'income' }), '  ', '2026-10-15')).toEqual({
      categoryId: 'c1',
      walletId: 'w1',
      kind: 'income',
    });
    expect(toTxFilter(f({ period: 'all' }), 'хлеб', '2026-10-15')).toEqual({ search: 'хлеб' });
  });

  it('dayTotal: чужая базовая валюта не смешивается, переводы не считаются, переполнение → null', () => {
    const t = (kind: 'expense' | 'income' | 'transfer', baseAmountMinor: number, baseCurrency = 'TJS') => ({ kind, baseAmountMinor, baseCurrency });
    expect(dayTotal([t('income', 500), t('expense', 120), t('transfer', 0), t('expense', 9, 'USD')], 'TJS')).toEqual({ netMinor: 380, excluded: 1 });
    expect(dayTotal([], 'TJS')).toEqual({ netMinor: 0, excluded: 0 });
    expect(dayTotal([t('income', 9_000_000_000_000_000), t('income', 9_000_000_000_000_000)], 'TJS')).toBeNull();
  });
});
