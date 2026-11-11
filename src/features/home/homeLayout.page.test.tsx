import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { parseHome, stringifyHome, type HomeItem } from '@/domain/homeLayout';
import { formatMinor } from '@/domain/money';
import { parseForecast } from '@/features/weather/api';
import { DEFAULT_CITIES, saveCache } from '@/features/weather/store';
import { currentPath, currentSearch, LocationProbe, opsDeps, pinToday, seedHistory, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import HomePage from './HomePage';
import { HOME_BLOCKS } from './layout/blocks';
import { defaultHome, presetHome, setShown, setSize } from './layout/layout';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => {
  pinToday();
  // погода в сеть не ходит: город не выбран, ячейка просто предлагает его выбрать
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  unpinToday();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (el: Element | null | undefined) => norm(el?.textContent);
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const byTest = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** Обёртки блоков главной по порядку (в том числе пустые: блоку сейчас нечего показать). */
const wrappers = () => Array.from(document.querySelectorAll<HTMLElement>('[data-home-grid] > [data-home-block]'));
/** Блоки по порядку; место под строку-совет погоды — не блок раскладки, оно проверяется отдельно. */
const blockIds = () => wrappers().map((el) => el.dataset['homeBlock']).filter((id) => id !== 'weather-advice');
const allIds = () => wrappers().map((el) => el.dataset['homeBlock']);
const wrapper = (id: string) => wrappers().find((el) => el.dataset['homeBlock'] === id);

interface OpenOptions {
  home?: readonly HomeItem[] | string;
  setup?: (s: Store) => Promise<void>;
  path?: string;
}

async function open(options: OpenOptions = {}) {
  const td = opsDeps([table()], {
    setup: async (s) => {
      await seedHistory(s);
      if (options.setup) await options.setup(s);
      if (typeof options.home === 'string') await s.db.settings.update(s.userId, { home: options.home });
      else if (options.home) await s.settings.update({ home: stringifyHome(options.home) });
    },
  });
  await showApp(
    <>
      <HomePage />
      <LocationProbe />
    </>,
    td,
    options.path ?? '/',
  );
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const openHome = async (options: OpenOptions = {}) => {
  const td = await open(options);
  await findByRole('heading', { name: 'Главная', level: 1 });
  return td;
};

const openEditor = async (options: OpenOptions = {}) => {
  const td = await open({ ...options, path: '/?edit=1' });
  await findByRole('heading', { name: 'Настройка главной', level: 1 });
  return td;
};

const savedHome = async (td: Awaited<ReturnType<typeof open>>) => (await storeOf(td).settings.get())?.home ?? null;
const savedShown = async (td: Awaited<ReturnType<typeof open>>) =>
  (parseHome(await savedHome(td)) ?? []).filter((i) => i.off !== true).map((i) => i.id);

describe('главная по раскладке', () => {
  it('раскладка не задана — стандартная главная: блоки в прежнем порядке, «первая трата» сразу под итогом, курсы и погода — половинами', async () => {
    await openHome();
    const standard = HOME_BLOCKS.filter((b) => b.on).map((b) => b.id as string);
    expect(blockIds()).toEqual([standard[0], 'first', ...standard.slice(1)]);
    expect(wrapper('rates')?.dataset['size']).toBe('half');
    expect(wrapper('weather')?.dataset['size']).toBe('half');
    // компактные карточки ширину не выбирали: парами их ставит только «Бенто»
    expect(wrapper('budgets')?.dataset['bento']).toBe('half');
    expect(wrapper('budgets')?.dataset['size']).toBeUndefined();
    expect(wrapper('hero')?.dataset['size']).toBeUndefined();
    expect(byTest('home-rates')).not.toBeNull();
    expect(byTest('home-weather')).not.toBeNull();
    // блоки, которых на стандартной главной нет, не рисуются и не загружаются
    for (const id of ['debts-card', 'goals-card', 'shopping-card', 'spending-card', 'home-shortcuts']) expect(byTest(id), id).toBeNull();
  });

  it('своя раскладка: порядок из настроек, скрытые блоки не рисуются, выбранная ширина сильнее задуманной', async () => {
    const items = setSize(setShown(setShown(defaultHome(), 'weather', false), 'templates', false), 'rates', 'full');
    const order = ['hero', 'recent', 'wallets'];
    const custom = [...order.map((id) => items.find((i) => i.id === id)!), ...items.filter((i) => !order.includes(i.id))];
    await openHome({ home: custom });
    expect(blockIds().slice(0, 4)).toEqual(['hero', 'first', 'recent', 'wallets']);
    expect(blockIds()).not.toContain('weather');
    expect(blockIds()).not.toContain('templates');
    expect(byTest('home-weather')).toBeNull();
    expect(wrapper('rates')?.dataset['size']).toBeUndefined(); // курсы растянуты во всю ширину
    // сами блоки на месте и с данными
    expect(document.querySelector('section[aria-labelledby="home-recent"]')).not.toBeNull();
    expect(text(byTest('home-total'))).toContain('Всего');
  });

  it('итог скрыт — «первая трата» встаёт первой; ссылка «Настроить главную» ведёт в настройку', async () => {
    await openHome({ home: setShown(defaultHome(), 'hero', false) });
    expect(blockIds()[0]).toBe('first');
    expect(byTest('home-total')).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Настроить главную' }));
    expect(currentPath()).toBe('/');
    expect(currentSearch()).toBe('?edit=1');
    await findByRole('heading', { name: 'Настройка главной', level: 1 });
  });

  it('все блоки скрыты — подсказка вместо пустоты', async () => {
    await openHome({ home: defaultHome().map((i) => ({ id: i.id, off: true as const })) });
    expect(blockIds()).toEqual(['first']);
    expect(screen.getByRole('heading', { name: 'На главной пусто', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Настроить главную' })).toBeInTheDocument();
  });

  it('непонятная запись (её оставило более новое приложение) — главная стандартная, а не пустая', async () => {
    await openHome({ home: '{"v":2,"что-то":"новое"}' });
    expect(blockIds()).toContain('recent');
    expect(blockIds()).toContain('weather');
  });

  it('незнакомый блок в записи пропускается, остальные идут своим порядком', async () => {
    await openHome({ home: [{ id: 'recent' }, { id: 'future-block' }, { id: 'hero' }] });
    // «первая трата» держится за итог, где бы он ни стоял
    expect(blockIds().slice(0, 3)).toEqual(['recent', 'hero', 'first']);
    expect(blockIds()).not.toContain('future-block');
  });
});

describe('строка-совет погоды', () => {
  const KHUJAND = DEFAULT_CITIES[1]!;
  /** Город выбран, в памяти — прогноз с дождём на «сейчас» (15.10.2026, 14:00 по Душанбе). */
  function rainNow(): void {
    const hours = [63, 63, 0, 0, 0, 0];
    localStorage.setItem('finora:weather:cities:v1', JSON.stringify([...DEFAULT_CITIES]));
    localStorage.setItem('finora:weather:selected:v1', JSON.stringify(KHUJAND.id));
    const json = {
      current: { time: '2026-10-15T14:00', temperature_2m: 18, apparent_temperature: 18, relative_humidity_2m: 30, weather_code: 63, is_day: 1, wind_speed_10m: 2, surface_pressure: 920 },
      hourly: {
        time: hours.map((_, i) => `2026-10-15T${14 + i}:00`),
        temperature_2m: hours.map(() => 18),
        weather_code: hours,
        is_day: hours.map(() => 1),
        precipitation_probability: hours.map(() => 0),
      },
      daily: { time: ['2026-10-15'], weather_code: [63], temperature_2m_max: [21], temperature_2m_min: [13], precipitation_probability_max: [0], sunrise: ['2026-10-15T06:20'], sunset: ['2026-10-15T17:30'] },
    };
    saveCache(KHUJAND.id, { ...parseForecast(json), fetchedAt: new Date(Date.now() - 60_000).toISOString() });
  }
  const advice = () => byTest('weather-advice');

  it('погода в половину ширины: совет — отдельной строкой во всю ширину под парой «курсы + погода», а не внутри узкой плитки', async () => {
    rainNow();
    await openHome();
    await waitFor(() => expect(advice()).not.toBeNull());
    expect(text(advice())).toBe('Сейчас дождь — возьмите зонт');
    const at = allIds().indexOf('weather-advice');
    expect(allIds().slice(at - 2, at)).toEqual(['rates', 'weather']);
    expect(wrapper('weather-advice')?.contains(advice())).toBe(true);
    expect(wrapper('weather-advice')?.dataset['size']).toBeUndefined(); // во всю ширину
    expect(byTest('home-weather')?.contains(advice())).toBe(false);
    await user.click(advice()!);
    expect(currentPath()).toBe('/weather');
  });

  it('без осадков место под совет пустое (и на главной не видно)', async () => {
    await openHome();
    await waitFor(() => expect(byTest('weather-widget')?.hasAttribute('aria-busy')).toBe(false));
    expect(wrapper('weather-advice')?.childElementCount).toBe(0);
    expect(advice()).toBeNull();
  });

  it('погода во всю ширину: совет — нижней строкой её карточки, отдельного места нет', async () => {
    rainNow();
    await openHome({ home: setSize(defaultHome(), 'weather', 'full') });
    await waitFor(() => expect(advice()).not.toBeNull());
    expect(byTest('home-weather')?.contains(advice())).toBe(true);
    expect(allIds()).not.toContain('weather-advice');
  });

  it('погода скрыта — ни совета, ни места под него', async () => {
    rainNow();
    await openHome({ home: setShown(defaultHome(), 'weather', false) });
    expect(allIds()).not.toContain('weather-advice');
    expect(advice()).toBeNull();
  });
});

describe('блоки, которые выносят на главную', () => {
  const withBlocks = (...ids: string[]) => ids.reduce<HomeItem[]>((acc, id) => setShown(acc, id, true), defaultHome());

  it('«Долги»: сколько должны мне и сколько должен я, отдельно по валютам; ближайший срок; ссылки на свои вкладки', async () => {
    await openHome({
      home: withBlocks('debts'),
      setup: async (s) => {
        await s.debts.create({ direction: 'lent', counterparty: 'Рустам', principalMinor: 30_000, currency: 'TJS', openedOn: '2026-10-01', dueOn: '2026-10-20' });
        await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 5_000, currency: 'USD', openedOn: '2026-10-02', dueOn: null });
        await s.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 120_000, currency: 'TJS', openedOn: '2026-09-01', dueOn: '2026-12-01' });
      },
    });
    await waitFor(() => expect(byTest('home-debts-lent')).not.toBeNull());
    const lent = byTest('home-debts-lent');
    const borrowed = byTest('home-debts-borrowed');
    expect(text(lent)).toBe(`Мне должны${fmt(30_000)}${fmt(5_000, 'USD')}`);
    expect(text(borrowed)).toBe(`Я должен${fmt(120_000)}`);
    expect(lent).toHaveAttribute('href', '/debts?dir=lent');
    expect(borrowed).toHaveAttribute('href', '/debts?dir=borrowed');
    expect(text(byTest('home-debts-note'))).toBe('Ближайший срок: Рустам, через 5 дней');
    expect(screen.getByRole('link', { name: 'Долги: открыть раздел' })).toHaveAttribute('href', '/debts');
  });

  it('«Долги»: просрочка важнее ближайшего срока; закрытые долги не считаются', async () => {
    await openHome({
      home: withBlocks('debts'),
      setup: async (s) => {
        await s.debts.create({ direction: 'borrowed', counterparty: 'Сосед', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-09-01', dueOn: '2026-10-01' });
        const closed = await s.debts.create({ direction: 'lent', counterparty: 'Закрытый', principalMinor: 99_000, currency: 'TJS', openedOn: '2026-09-01', dueOn: null });
        await s.debts.close(closed.id);
      },
    });
    await waitFor(() => expect(byTest('home-debts-note')).not.toBeNull());
    expect(text(byTest('home-debts-note'))).toBe('1 долг просрочен');
    expect(text(byTest('home-debts-lent'))).toBe('Мне должны—');
    expect(text(byTest('home-debts-borrowed'))).toBe(`Я должен${fmt(10_000)}`);
  });

  it('«Долги»: долгов нет — одна строка со ссылкой, а не пустота', async () => {
    await openHome({ home: withBlocks('debts') });
    await waitFor(() => expect(text(byTest('debts-card'))).toContain('Открытых долгов нет.'));
    expect(screen.getByRole('link', { name: 'Записать долг' })).toHaveAttribute('href', '/debts');
  });

  it('«Расходы за месяц»: сумма месяца и сегодняшняя, главные статьи с долей', async () => {
    await openHome({ home: withBlocks('spending') });
    await waitFor(() => expect(byTest('spending-month')).not.toBeNull());
    // октябрь: обед 12,50 (сегодня) + такси 3 + кофе 10 $ = 109 с. → 124,50
    expect(text(byTest('spending-month'))).toBe(fmt(12_450));
    expect(text(byTest('spending-today'))).toBe(`сегодня ${fmt(1_250)}`);
    const rows = Array.from(document.querySelectorAll('[data-testid="spending-row"]')).map((li) => text(li));
    expect(rows).toEqual([`Еда97%${fmt(12_150)}`, `Транспорт2%${fmt(300)}`]);
    expect(screen.getByRole('link', { name: 'Расходы за месяц: открыть аналитику' })).toHaveAttribute('href', '/analytics');
  });

  it('«Расходы за месяц» в половину ширины: одна главная статья и короткий заголовок', async () => {
    await openHome({ home: setSize(withBlocks('spending'), 'spending', 'half') });
    await waitFor(() => expect(byTest('spending-month')).not.toBeNull());
    expect(wrapper('spending')?.dataset['size']).toBe('half');
    expect(document.querySelectorAll('[data-testid="spending-row"]')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Расходы', level: 2 })).toBeInTheDocument();
  });

  it('«Цели накопления»: цель из «Бюджетов» и цель кошелька-накопления; привязанный кошелёк второй раз не показан', async () => {
    await openHome({
      home: withBlocks('goals'),
      setup: async (s) => {
        const trip = await s.wallets.create({ name: 'На отпуск', currency: 'TJS', kind: 'savings', openingBalanceMinor: 60_000, color: '#16a34a', icon: '🏖', goalMinor: 100_000, goalOn: null });
        await s.wallets.create({ name: 'Подушка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 25_000, color: '#16a34a', icon: '🏦', goalMinor: 100_000, goalOn: null });
        await s.savingsGoals.create({ name: 'Отпуск в Стамбуле', targetMinor: 300_000, dueOn: '2027-06-01', walletId: trip.id });
      },
    });
    await waitFor(() => expect(document.querySelectorAll('[data-testid="home-goal-row"]').length).toBeGreaterThan(0));
    const rows = Array.from(document.querySelectorAll('[data-testid="home-goal-row"]')).map((li) => text(li));
    // цель со сроком — первой; кошелёк «На отпуск» привязан к ней и отдельной строкой не идёт
    expect(rows).toEqual([`Отпуск в Стамбуле20%${fmt(60_000)} из ${fmt(300_000)}`, `Подушка25%${fmt(25_000)} из ${fmt(100_000)}`]);
    expect(screen.getByRole('link', { name: 'Цели накопления: открыть бюджеты' })).toHaveAttribute('href', '/budgets');
  });

  it('«Цели накопления»: целей нет — строка со ссылкой', async () => {
    await openHome({ home: withBlocks('goals') });
    await waitFor(() => expect(text(byTest('goals-card'))).toContain('Целей пока нет.'));
    expect(screen.getByRole('link', { name: 'Поставить цель' })).toHaveAttribute('href', '/budgets');
  });

  it('«Покупки»: сколько осталось купить и первые позиции; то, что уже в корзине, — в конце и зачёркнуто', async () => {
    await openHome({
      home: withBlocks('shopping'),
      setup: async (s) => {
        const milk = await s.shopping.add({ name: 'Молоко', qtyMilli: 2000, unit: 'l' });
        await s.shopping.add({ name: 'Хлеб', qtyMilli: 1000, unit: 'pcs' });
        await s.shopping.add({ name: 'Яблоки', qtyMilli: 1500, unit: 'kg' });
        await s.shopping.check(milk.id, 2400);
      },
    });
    await waitFor(() => expect(byTest('home-shopping-count')).not.toBeNull());
    expect(text(byTest('home-shopping-count'))).toBe('Осталось купить: 2 позиции');
    const rows = Array.from(document.querySelectorAll('[data-testid="home-shopping-row"]'));
    expect(rows.map((li) => text(li))).toEqual(['Хлеб', 'Яблоки 1,5 кг', 'Молоко 2 л']);
    expect(rows[2]?.innerHTML).toContain('line-through');
    expect(screen.getByRole('link', { name: 'Покупки: открыть список' })).toHaveAttribute('href', '/shopping');
  });

  it('«Покупки»: список пуст — строка со ссылкой', async () => {
    await openHome({ home: withBlocks('shopping') });
    await waitFor(() => expect(text(byTest('shopping-card'))).toContain('Список пуст.'));
    expect(screen.getByRole('link', { name: 'Добавить покупки' })).toHaveAttribute('href', '/shopping');
  });

  it('«Разделы»: ссылки на разделы из «Ещё»', async () => {
    await openHome({ home: withBlocks('shortcuts') });
    await waitFor(() => expect(byTest('home-shortcuts')).not.toBeNull());
    const links = Array.from(byTest('home-shortcuts')!.querySelectorAll('li a')).map((a) => [text(a), a.getAttribute('href')]);
    expect(links).toContainEqual(['Долги', '/debts']);
    expect(links).toContainEqual(['Бюджеты', '/budgets']);
    expect(links).toContainEqual(['Покупки', '/shopping']);
    expect(links.map(([name]) => name)).not.toContain('Операции'); // разделы нижней панели не повторяются
    expect(screen.getByRole('link', { name: 'Все' })).toHaveAttribute('href', '/more');
  });

  it('«Скрыть суммы» прячет суммы и в вынесенных блоках', async () => {
    localStorage.setItem('finora-hide-balance', '1');
    await openHome({
      home: withBlocks('debts', 'spending'),
      setup: async (s) => {
        await s.debts.create({ direction: 'lent', counterparty: 'Рустам', principalMinor: 30_000, currency: 'TJS', openedOn: '2026-10-01', dueOn: null });
      },
    });
    await waitFor(() => expect(byTest('home-debts-lent')).not.toBeNull());
    await waitFor(() => expect(byTest('spending-month')).not.toBeNull());
    expect(text(byTest('home-debts-lent'))).not.toContain(fmt(30_000));
    expect(text(byTest('spending-month'))).not.toContain(fmt(12_450));
    expect(byTest('home-debts-lent')?.querySelector('[aria-label="Сумма скрыта"]')).not.toBeNull();
  });
});

describe('настройка главной', () => {
  const shownRows = () => Array.from(byTest('home-edit-shown')?.querySelectorAll(':scope > li') ?? []).map((li) => (li.getAttribute('data-testid') ?? '').replace('home-edit-row-', ''));
  const hiddenRows = () => Array.from(byTest('home-edit-hidden')?.querySelectorAll(':scope > li') ?? []).map((li) => (li.getAttribute('data-testid') ?? '').replace('home-edit-row-', ''));
  const toggle = (title: string) => screen.getByRole('switch', { name: `Показывать на главной: ${title}` });
  const handle = (title: string) => screen.getByRole('button', { name: `Переместить: ${title}` });
  const presetButton = (title: string, pressed?: boolean) => screen.getByRole('button', pressed === undefined ? { name: new RegExp(`^${title}`) } : { name: new RegExp(`^${title}`), pressed });

  it('список повторяет главную: показанные блоки по порядку и «Можно добавить»; раскладка ещё не записана', async () => {
    const td = await openEditor();
    expect(shownRows()).toEqual(HOME_BLOCKS.filter((b) => b.on).map((b) => b.id));
    expect(hiddenRows()).toEqual(HOME_BLOCKS.filter((b) => !b.on).map((b) => b.id));
    expect(presetButton('Стандартная', true)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull(); // сбрасывать нечего
    expect(await savedHome(td)).toBeNull();
    // у каждого блока — что в нём и когда он появляется
    expect(text(byTest('home-edit-row-weekly'))).toContain('Появляется в начале недели');
  });

  it('выключатель убирает блок с главной и возвращает его на прежнее место; запись идёт в настройки сразу', async () => {
    const td = await openEditor();
    await user.click(toggle('Погода'));
    await waitFor(() => expect(hiddenRows()).toContain('weather'));
    expect(shownRows()).not.toContain('weather');
    await waitFor(async () => expect(await savedShown(td)).not.toContain('weather'));
    expect(toggle('Погода')).toHaveAttribute('aria-checked', 'false');

    await user.click(toggle('Погода'));
    await waitFor(() => expect(shownRows()).toContain('weather'));
    expect(shownRows().indexOf('weather')).toBe(shownRows().indexOf('rates') + 1); // вернулась туда же — за курсы
    await waitFor(async () => expect(await savedShown(td)).toContain('weather'));
  });

  it('блок из «Можно добавить» выносится на главную', async () => {
    const td = await openEditor();
    await user.click(toggle('Долги'));
    await waitFor(() => expect(shownRows()).toContain('debts'));
    expect(hiddenRows()).not.toContain('debts');
    await waitFor(async () => expect(await savedShown(td)).toContain('debts'));
  });

  it('стрелки ↑ и ↓ на ручке двигают блок; фокус остаётся на ручке, у края ничего не происходит', async () => {
    const td = await openEditor();
    const last = shownRows().length - 1;
    expect(shownRows()[last]).toBe('recent');
    handle('Последние операции').focus();
    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(shownRows()[last - 1]).toBe('recent'));
    expect(document.activeElement).toBe(handle('Последние операции'));
    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(shownRows()[last - 2]).toBe('recent'));
    await waitFor(async () => expect((await savedShown(td)).indexOf('recent')).toBe(last - 2));
    // место объявляется для скринридера
    expect(text(document.querySelector('[aria-live="polite"]'))).toBe(`«Последние операции»: место ${last - 1} из ${last + 1}`);

    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(shownRows()[last - 1]).toBe('recent'));

    // первый блок вверх не уходит
    const before = shownRows();
    handle('Всего').focus();
    await user.keyboard('{ArrowUp}');
    expect(shownRows()).toEqual(before);
  });

  it('ширина: у блоков с узким видом выбор «Вся ширина / Половина»; у остальных его нет', async () => {
    const td = await openEditor();
    const rates = screen.getByRole('radiogroup', { name: 'Ширина: Курсы валют' });
    const radios = () => Array.from(rates.querySelectorAll('[role="radio"]')).map((r) => [text(r), r.getAttribute('aria-checked')]);
    expect(radios()).toEqual([['Вся ширина', 'false'], ['Половина', 'true']]);
    await user.click(rates.querySelectorAll('[role="radio"]')[0]!);
    await waitFor(() => expect(radios()).toEqual([['Вся ширина', 'true'], ['Половина', 'false']]));
    await waitFor(async () => expect(parseHome(await savedHome(td))?.find((i) => i.id === 'rates')).toEqual({ id: 'rates', size: 'full' }));
    expect(screen.queryByRole('radiogroup', { name: 'Ширина: Всего' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Ширина: Последние операции' })).toBeNull();
    // компактным карточкам половина доступна только на широком экране — об этом сказано
    await user.click(screen.getByRole('radiogroup', { name: 'Ширина: Можно тратить в день' }).querySelectorAll('[role="radio"]')[1]!);
    await waitFor(() => expect(text(byTest('home-edit-row-budgets'))).toContain('На телефоне блок остаётся во всю ширину.'));
  });

  it('готовый набор применяется сразу и отмечается выбранным; «Отменить» возвращает прежнюю раскладку', async () => {
    const custom = setShown(defaultHome(), 'weather', false);
    const td = await openEditor({ home: custom });
    expect(screen.getByRole('button', { name: 'Сбросить' })).toBeInTheDocument();
    await user.click(presetButton('Минимум'));
    await waitFor(() => expect(shownRows()).toEqual(['hero', 'attention', 'wallets', 'recent']));
    expect(presetButton('Минимум', true)).toBeInTheDocument();
    await waitFor(async () => expect(await savedShown(td)).toEqual(['hero', 'attention', 'wallets', 'recent']));

    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(shownRows()).not.toContain('weather'));
    await waitFor(() => expect(shownRows()).toContain('rates'));
    await waitFor(async () => expect(await savedHome(td)).toBe(stringifyHome(custom)));
  });

  it('«Операции сверху» и «Всё»', async () => {
    const td = await openEditor();
    await user.click(presetButton('Операции сверху'));
    await waitFor(() => expect(shownRows().slice(0, 3)).toEqual(['hero', 'recent', 'wallets']));
    await user.click(presetButton('Всё'));
    await waitFor(() => expect(shownRows()).toEqual(HOME_BLOCKS.map((b) => b.id)));
    expect(byTest('home-edit-hidden')).toBeNull();
    await waitFor(async () => expect(await savedHome(td)).toBe(stringifyHome(presetHome('all')!)));
  });

  it('«Сбросить» очищает запись: главная снова стандартная', async () => {
    const td = await openEditor({ home: presetHome('minimal')! });
    await user.click(screen.getByRole('button', { name: 'Сбросить' }));
    await waitFor(() => expect(shownRows()).toEqual(HOME_BLOCKS.filter((b) => b.on).map((b) => b.id)));
    await waitFor(async () => expect(await savedHome(td)).toBeNull());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Сбросить' })).toBeNull());
    expect(presetButton('Стандартная', true)).toBeInTheDocument();
  });

  it('все блоки выключены — подсказка в списке', async () => {
    await openEditor({ home: defaultHome().map((i) => ({ id: i.id, off: true as const })) });
    expect(byTest('home-edit-shown')).toBeNull();
    expect(screen.getByText('Все блоки скрыты. Включите нужные ниже или выберите готовый набор.')).toBeInTheDocument();
  });

  it('незнакомый блок из записи в списке не показан, но при правке не теряется', async () => {
    const td = await openEditor({ home: [{ id: 'hero' }, { id: 'future-block', size: 'half' }, { id: 'recent' }] });
    expect(shownRows()).not.toContain('future-block');
    await user.click(toggle('Погода'));
    await waitFor(async () => expect(await savedShown(td)).not.toContain('weather'));
    expect(parseHome(await savedHome(td))).toContainEqual({ id: 'future-block', size: 'half' });
  });

  it('«Готово» возвращает на главную с новой раскладкой', async () => {
    await openEditor();
    await user.click(toggle('Погода'));
    await waitFor(() => expect(hiddenRows()).toContain('weather'));
    await user.click(byTest('home-edit-done')!);
    await findByRole('heading', { name: 'Главная', level: 1 });
    expect(currentSearch()).toBe('');
    await waitFor(() => expect(blockIds()).not.toContain('weather'));
    expect(blockIds()).toContain('rates');
  });
});
