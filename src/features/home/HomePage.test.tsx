import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { write } from '@/app/testkit';
import { findByRole, fire, screen, user, waitFor } from '@/components/testUtils';
import { formatMinor } from '@/domain/money';
import type { RateLookup } from '@/rates/types';
import type { Store } from '@/db';
import {
  backgroundPath,
  currentPath,
  LocationProbe,
  opsDeps,
  pinToday,
  seedHistory,
  showApp,
  storeOf,
  table,
  type History,
  unpinToday,
} from '@/features/transactions/__fixtures__/opsKit';
import { computeHomeTotal } from './homeData';
import HomePage from './HomePage';

const HIDE_KEY = 'finora-hide-balance';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
  // выбор «Скрыть суммы» живёт в localStorage и пережил бы тест
  localStorage.removeItem(HIDE_KEY);
});

let hist: History = { cash: '', card: '', usd: '', txs: {} };

interface OpenOptions {
  tables?: ReturnType<typeof table>[];
  setup?: (s: Store) => Promise<void>;
}

async function openHome(options: OpenOptions = {}) {
  const td = opsDeps(options.tables ?? [table()], {
    setup: async (s) => {
      if (options.setup) await options.setup(s);
      else hist = await seedHistory(s);
    },
  });
  await showApp(
    <>
      <HomePage />
      <LocationProbe />
    </>,
    td,
    '/',
  );
  await findByRole('heading', { name: 'Главная', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (el: Element | null) => norm(el?.textContent);
const fmt = (minor: number, currency = 'TJS', sign: 'auto' | 'always' = 'auto') => norm(formatMinor(minor, currency, { sign }));
const total = () => document.querySelector('[data-testid="home-total"]');
/** Капсулы «приход / расход месяца» в шапке. */
const flow = (kind: 'income' | 'expense') => text(document.querySelector(`[data-testid="home-flow-${kind}"]`));
const net = () => text(document.querySelector('[data-testid="home-flow-net"]'));
const walletCards = () => Array.from(document.querySelectorAll('section[aria-labelledby="home-wallets"] li')).map((li) => text(li));
const recentRows = () => Array.from(document.querySelectorAll('section[aria-labelledby="home-recent"] button')).map((b) => text(b));

const NOTES = 'Как посчитан итог';
const notesButton = () => screen.queryByRole('button', { name: NOTES });
const notesDialog = () => screen.queryByRole('dialog', { name: NOTES });
/** Пояснения к итогу: открывает шит по значку ⓘ, читает предложения по одному и закрывает шит. */
async function readNotes(): Promise<string[]> {
  await user.click(screen.getByRole('button', { name: NOTES }));
  const dialog = screen.getByRole('dialog', { name: NOTES });
  const items = Array.from(dialog.querySelectorAll('li')).map((li) => text(li));
  const close = Array.from(dialog.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Закрыть');
  await user.click(close as Element);
  expect(notesDialog()).toBeNull();
  return items;
}

describe('«Всего» и кошельки', () => {
  it('сумма по кошелькам в основной валюте с пометкой «≈»: доллары пересчитаны по курсу, остатки — в своей валюте', async () => {
    await openHome();
    // наличные 4 842,50 + карта 165 + (−10 $ × 10,9 = −109) = 4 898,50
    expect(text(total())).toContain(`≈ ${fmt(489_850)}`);
    const cards = walletCards();
    expect(cards).toHaveLength(3);
    expect(cards.find((c) => c.includes('Наличные'))).toContain(fmt(484_250));
    expect(cards.find((c) => c.includes('Карта'))).toContain(fmt(16_500));
    expect(cards.find((c) => c.includes('Доллары'))).toContain(fmt(-1000, 'USD')); // в долларах, не в сомони
  });

  it('кошельки — лента чипов под заголовком «Кошельки»; каждый чип ведёт в операции этого кошелька', async () => {
    await openHome();
    expect(screen.getByRole('heading', { name: 'Кошельки', level: 2 })).toBeInTheDocument();
    const links = Array.from(document.querySelectorAll('section[aria-labelledby="home-wallets"] li a'));
    expect(links).toHaveLength(3);
    for (const a of links) expect(a.getAttribute('href')).toMatch(/^\/transactions\?wallet=[0-9A-Za-z_-]+&period=all$/);
    expect(new Set(links.map((a) => a.getAttribute('href'))).size).toBe(3); // у каждого кошелька — свой
    expect(screen.queryByRole('link', { name: 'Все кошельки' })).toBeNull(); // прежней ссылки больше нет
  });

  it('отрицательный остаток показан красным', async () => {
    await openHome();
    const chip = (name: string) => Array.from(document.querySelectorAll('section[aria-labelledby="home-wallets"] li')).find((li) => li.textContent?.includes(name));
    expect(chip('Доллары')?.innerHTML).toContain('text-expense');
    expect(chip('Наличные')?.innerHTML).not.toContain('text-expense');
  });

  it('нет курса доллара: сумма в долларах НЕ входит в итог, это прямо сказано; «≈» нет, раз ничего не пересчитано', async () => {
    await openHome({ tables: [] });
    expect(text(total())).toContain(fmt(500_750));
    expect(text(total())).not.toContain('≈');
    // снаружи — короткая жёлтая строка, подробности (с суммой) — в пояснении
    expect(text(total())).toContain('Не вошло в итог: нет курса (USD)');
    expect(await readNotes()).toEqual([`Не вошло в итог — нет курса: ${fmt(-1000, 'USD')}.`]);
  });

  it('пустой кошелёк в валюте без курса ничего не добавляет и не пугает предупреждением', async () => {
    await openHome({
      tables: [],
      setup: async (s) => {
        await s.wallets.create({ name: 'Евро', currency: 'EUR', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: '💶' });
      },
    });
    expect(text(total())).toContain(fmt(0));
    expect(text(total())).not.toContain('Не вошло в итог');
    expect(notesButton()).toBeNull();
  });

  it('устаревший курс (старше 3 суток): предупреждение с датой', async () => {
    await openHome({ tables: [table({ asOf: '2026-10-01' })] });
    expect(text(total())).toContain('≈');
    expect(await readNotes()).toContain('Курс устарел (USD на 01.10.2026) — итог может быть неточным.');
  });

  it('свежий курс — без предупреждения об устаревании', async () => {
    await openHome();
    expect(text(total())).not.toContain('устарел');
    expect((await readNotes()).join(' ')).not.toContain('устарел');
  });

  it('удалённая операция не видна, а остаток и «Всего» верны', async () => {
    const td = await openHome();
    await write(() => storeOf(td).transactions.softDelete(hist.txs['advance'] ?? ''));
    await waitFor(() => expect(walletCards().find((c) => c.includes('Наличные'))).toContain(fmt(-15_750)));
    expect(text(total())).toContain(fmt(489_850 - 500_000));
    await waitFor(() => expect(flow('income')).toBe(fmt(0, 'TJS', 'always')));
    expect(document.body.textContent).not.toContain('аванс');
    expect(await storeOf(td).db.transactions.count()).toBe(8);
  });
});

describe('приход и расход месяца в шапке', () => {
  it('две капсулы: приход со знаком «+» и расход с «−»; переводы и сентябрь не считаются', async () => {
    await openHome();
    // расходы октября: 12,50 + 3 + 109 (10 $ по курсу из операции) = 124,50; доход — аванс 5 000
    await waitFor(() => expect(flow('income')).toBe(fmt(500_000, 'TJS', 'always')));
    expect(flow('income')).toBe('+5 000 с.');
    expect(flow('expense')).toBe(fmt(-12_450));
  });

  it('в правом верхнем углу — «За месяц»: разница прихода и расхода со знаком (5 000 − 124,50 = +4 875,50)', async () => {
    await openHome();
    await waitFor(() => expect(net()).toContain(fmt(487_550, 'TJS', 'always')));
    expect(net()).toContain('За месяц');
  });

  it('операция этого месяца с датой позже сегодняшней тоже входит в «За месяц» (как в бюджетах)', async () => {
    await openHome({
      setup: async (s) => {
        hist = await seedHistory(s);
        const cats = await s.db.categories.toArray();
        const food = cats.find((c) => c.name === 'Еда' && c.kind === 'expense')?.id ?? null;
        await s.transactions.create({ kind: 'expense', walletId: hist.cash, amountMinor: 10_000, categoryId: food, occurredOn: '2026-10-25', note: 'заранее' });
      },
    });
    // 5 000 − 124,50 − 100 (запись на 25 октября) = +4 775,50
    await waitFor(() => expect(net()).toContain(fmt(477_550, 'TJS', 'always')));
    expect(flow('expense')).toBe(fmt(-22_450));
  });

  it('за полночь в новый месяц «За месяц» переключается сам, без перезапуска', async () => {
    await openHome();
    await waitFor(() => expect(net()).toContain(fmt(487_550, 'TJS', 'always')));
    // 1 ноября, 00:00:05: в ноябре операций нет. Экран узнаёт о смене даты по таймеру, возврату на вкладку или фокусу.
    vi.setSystemTime(new Date(2026, 10, 1, 0, 0, 5));
    fire(window, new Event('focus'));
    // суммы в капсулах «набегают» к новому значению — ждём, пока доедут
    await waitFor(() => expect(flow('expense')).toBe(fmt(0)));
    await waitFor(() => expect(flow('income')).toBe(fmt(0, 'TJS', 'always')));
    expect(net()).toContain(fmt(0, 'TJS', 'always'));
  });

  it('в месяце нет операций — в капсулах нули, а не пустое место', async () => {
    await openHome({ setup: async () => undefined });
    await waitFor(() => expect(flow('expense')).toBe(fmt(0)));
    expect(flow('income')).toBe(fmt(0, 'TJS', 'always'));
    expect(net()).toContain(fmt(0, 'TJS', 'always'));
  });

  it('операции в другой основной валюте не смешиваются с остальными: в капсулах нули в новой валюте', async () => {
    const td = await openHome();
    await waitFor(() => expect(flow('expense')).toBe(fmt(-12_450)));
    await write(() => storeOf(td).settings.update({ baseCurrency: 'USD' }));
    // все операции октября записаны со снимком в сомони — к долларовому итогу они не относятся
    await waitFor(() => expect(flow('expense')).toBe(fmt(0, 'USD')));
    expect(flow('income')).toBe(fmt(0, 'USD', 'always'));
  });

  it('прежних блоков на главной нет: итогов месяца, быстрых кнопок «Расход / Доход / Перевод», «В среднем в день»', async () => {
    await openHome();
    await waitFor(() => expect(flow('income')).not.toBe(''));
    expect(document.querySelector('[aria-label="Итоги месяца"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Предыдущий месяц' })).toBeNull();
    expect(document.querySelector('[data-testid="home-avg-per-day"]')).toBeNull();
    expect(text(total())).not.toContain('В среднем в день');
    expect(text(total())).not.toContain('14 дней');
    for (const name of ['Расход', 'Доход', 'Перевод']) expect(screen.queryByRole('link', { name })).toBeNull();
  });
});

describe('«Как посчитан итог» (значок ⓘ)', () => {
  it('нечего пояснять (одна валюта, ничего не пересчитано) — значка нет', async () => {
    await openHome({ tables: [], setup: async () => undefined });
    expect(text(total())).toContain(fmt(0));
    expect(notesButton()).toBeNull();
    expect(notesDialog()).toBeNull();
  });

  it('есть пересчёт по курсу — значок есть; пояснение прячется в шит и не лежит в шапке', async () => {
    await openHome();
    expect(notesButton()).not.toBeNull();
    expect(notesDialog()).toBeNull();
    expect(text(total())).not.toContain('пересчитаны по курсу'); // раньше стояло строкой под суммой
    await user.click(screen.getByRole('button', { name: NOTES }));
    const dialog = notesDialog();
    expect(dialog).not.toBeNull();
    expect(Array.from(dialog?.querySelectorAll('li') ?? []).map((li) => text(li))).toEqual(['Остатки в других валютах пересчитаны по курсу.']);
  });

  it('шит закрывается кнопкой «Закрыть» и клавишей Esc', async () => {
    await openHome();
    await user.click(screen.getByRole('button', { name: NOTES }));
    expect(notesDialog()).not.toBeNull();
    await user.click(
      Array.from(notesDialog()?.querySelectorAll('button') ?? []).find((b) => b.getAttribute('aria-label') === 'Закрыть') as Element,
    );
    expect(notesDialog()).toBeNull();
    await user.click(screen.getByRole('button', { name: NOTES }));
    expect(notesDialog()).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(notesDialog()).toBeNull();
  });

  it('нет курса: в шапке короткая жёлтая строка, нажатие на неё открывает тот же шит с подробностями', async () => {
    await openHome({ tables: [] });
    const amber = screen.getByRole('button', { name: 'Не вошло в итог: нет курса (USD)' });
    expect(text(total())).not.toContain('Не вошло в итог — нет курса'); // длинной фразы снаружи шита нет
    expect(notesDialog()).toBeNull();
    await user.click(amber);
    const items = Array.from(notesDialog()?.querySelectorAll('li') ?? []).map((li) => text(li));
    expect(items).toEqual([`Не вошло в итог — нет курса: ${fmt(-1000, 'USD')}.`]);
  });

  it('жёлтой строки нет, пока все валюты с курсом', async () => {
    await openHome();
    expect(text(total())).not.toContain('Не вошло в итог');
  });

  it('несколько причин сразу: все предложения в шите, по одному на строку', async () => {
    await openHome({
      tables: [table({ asOf: '2026-10-01' })],
      setup: async (s) => {
        await seedHistory(s);
        await s.wallets.create({ name: 'Рубли', currency: 'RUB', kind: 'cash', openingBalanceMinor: 25_000, color: '#dc2626', icon: '₽' });
      },
    });
    // рубля в таблице нет — не вошёл; доллар по устаревшему курсу
    expect(text(total())).toContain('Не вошло в итог: нет курса (RUB)');
    expect(await readNotes()).toEqual([
      `Не вошло в итог — нет курса: ${fmt(25_000, 'RUB')}.`,
      'Курс устарел (USD на 01.10.2026) — итог может быть неточным.',
    ]);
  });
});

describe('«Скрыть суммы»', () => {
  it('глаз прячет суммы в шапке, на чипах кошельков, в «Можно тратить в день» и в последних операциях — и возвращает их', async () => {
    await openHome();
    await waitFor(() => expect(flow('expense')).toBe(fmt(-12_450)));
    await waitFor(() => expect(document.querySelector('[data-testid="widget-per-day"]')).not.toBeNull());
    const perDay = () => text(document.querySelector('[data-testid="widget-per-day"]'));
    const shownTotal = text(total());
    const shownPerDay = perDay();
    const shownRecent = recentRows().join('|');
    expect(screen.getByRole('button', { name: 'Скрыть суммы' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelectorAll('[aria-label="Сумма скрыта"]')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Скрыть суммы' }));
    expect(screen.getByRole('button', { name: 'Показать суммы' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(HIDE_KEY)).toBe('1');
    // шапка: итог и обе капсулы
    expect(text(total())).toContain('••••');
    expect(text(total())).not.toMatch(/\d/);
    expect(flow('income')).toBe('••••');
    expect(flow('expense')).toBe('••••');
    expect(net()).toBe('За месяц••••');
    // чипы кошельков: названия на месте, остатков нет
    for (const card of walletCards()) {
      expect(card).toContain('••••');
      expect(card).not.toMatch(/\d/);
    }
    for (const name of ['Наличные', 'Карта', 'Доллары']) expect(walletCards().some((c) => c.includes(name))).toBe(true);
    // «Можно тратить в день»
    expect(perDay()).toContain('••••'); // «≈» перед суммой остаётся, цифр нет
    expect(perDay()).not.toMatch(/\d/);
    expect(shownPerDay).toMatch(/\d/);
    // последние операции: описание видно, суммы — точками
    const hiddenRecent = recentRows();
    expect(hiddenRecent).toHaveLength(5);
    expect(hiddenRecent[0]).toContain('аванс');
    for (const row of hiddenRecent) expect(row).toContain('••••');
    expect(hiddenRecent.join('|')).not.toBe(shownRecent);
    expect(hiddenRecent.join('|')).not.toContain('5 000');
    expect(document.querySelectorAll('[aria-label="Сумма скрыта"]').length).toBeGreaterThanOrEqual(2 + 1 + 3 + 1 + 5);

    await user.click(screen.getByRole('button', { name: 'Показать суммы' }));
    expect(screen.getByRole('button', { name: 'Скрыть суммы' })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem(HIDE_KEY)).toBe('0');
    expect(document.querySelectorAll('[aria-label="Сумма скрыта"]')).toHaveLength(0);
    expect(text(total())).toBe(shownTotal);
    expect(flow('income')).toBe(fmt(500_000, 'TJS', 'always'));
    expect(flow('expense')).toBe(fmt(-12_450));
    expect(walletCards().find((c) => c.includes('Наличные'))).toContain(fmt(484_250));
    expect(perDay()).toBe(shownPerDay);
    expect(recentRows().join('|')).toBe(shownRecent);
  });

  it('выбор запоминается на устройстве: при следующем открытии суммы уже спрятаны', async () => {
    localStorage.setItem(HIDE_KEY, '1');
    await openHome();
    expect(screen.getByRole('button', { name: 'Показать суммы' })).toHaveAttribute('aria-pressed', 'true');
    expect(text(total())).toContain('••••');
    expect(text(total())).not.toMatch(/\d/);
    expect(recentRows().every((r) => r.includes('••••'))).toBe(true);
  });

  it('жёлтая строка «нет курса» остаётся и при спрятанных суммах: в ней только коды валют, без сумм', async () => {
    localStorage.setItem(HIDE_KEY, '1');
    await openHome({ tables: [] });
    expect(text(total())).toContain('Не вошло в итог: нет курса (USD)');
    expect(text(total())).not.toMatch(/\d/);
  });

  it('пояснение по ⓘ тоже не выдаёт сумму, пока она спрятана: называет только валюту', async () => {
    localStorage.setItem(HIDE_KEY, '1');
    await openHome({ tables: [] });
    expect(await readNotes()).toEqual(['Не вошло в итог — нет курса: USD.']);
  });
});

describe('«Требует внимания»', () => {
  it('ничего не просрочено — строки нет вовсе', async () => {
    await openHome();
    // строка появляется после чтения долгов, платежей, лимитов и целей — ждём, пока виджеты ниже дочитались
    await waitFor(() => expect(document.querySelector('[data-testid="widget-per-day"]')).not.toBeNull());
    await waitFor(() => expect(flow('income')).not.toBe(''));
    expect(document.querySelector('[data-testid="attention-row"]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Требует внимания' })).toBeNull();
  });

  it('просроченный долг — тонкая строка со ссылкой на этот долг', async () => {
    let debtId = '';
    await openHome({
      setup: async (s) => {
        hist = await seedHistory(s);
        debtId = (await s.debts.create({ direction: 'borrowed', counterparty: 'Рустам', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-09-01', dueOn: '2026-10-01' })).id;
      },
    });
    await waitFor(() => expect(document.querySelector('[data-testid="attention-row"]')).not.toBeNull());
    const row = document.querySelector('[data-testid="attention-row"]');
    expect(text(row)).toContain('Долг просрочен: Рустам');
    expect(row?.querySelector('a')).toHaveAttribute('href', `/debts/${debtId}`);
  });
});

describe('последние операции', () => {
  it('пять последних, новые сверху, и ссылка «Все операции»', async () => {
    await openHome();
    const rows = recentRows();
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('аванс');
    expect(rows[1]).toContain('обед');
    expect(rows.join('|')).toContain('coffee');
    expect(rows.join('|')).toContain('Наличные → Карта');
    expect(rows.join('|')).toContain('такси');
    expect(rows.join('|')).not.toContain('рынок');
    expect(screen.getByRole('link', { name: 'Все операции' })).toHaveAttribute('href', '/transactions');
  });

  it('нажатие на строку открывает правку поверх главной', async () => {
    await openHome();
    await user.click(screen.getByText('Наличные · обед'));
    expect(currentPath()).toBe(`/edit/${hist.txs['lunch']}`);
    expect(backgroundPath()).toBe('/');
  });
});

describe('пустые состояния', () => {
  it('нет кошельков: объяснение и кнопка «Создать кошелёк»', async () => {
    await openHome({
      setup: async (s) => {
        for (const w of await s.db.wallets.toArray()) await s.db.wallets.update(w.id, { deletedAt: new Date().toISOString() });
      },
    });
    expect(screen.getByText('Начните с кошелька')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Создать кошелёк' })).toHaveAttribute('href', '/wallets?new=1');
    expect(total()).toBeNull();
  });

  it('кошелёк есть, операций нет: нули в итогах и кнопка «Добавить операцию»', async () => {
    await openHome({ setup: async () => undefined });
    expect(text(total())).toContain(fmt(0));
    expect(walletCards()).toHaveLength(1);
    await waitFor(() => expect(flow('expense')).toBe(fmt(0)));
    expect(flow('income')).toBe(fmt(0, 'TJS', 'always'));
    expect(screen.getByText('Операций пока нет')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Добавить операцию' })).toHaveAttribute('href', '/add');
    expect(screen.queryByRole('link', { name: 'Все операции' })).toBeNull();
  });

  it('все кошельки в архиве — это тоже «нет кошельков» для итогов', async () => {
    await openHome({
      setup: async (s) => {
        for (const w of await s.db.wallets.toArray()) await s.wallets.archive(w.id);
      },
    });
    expect(screen.getByText('Начните с кошелька')).toBeInTheDocument();
  });
});

describe('расчёты главной (чистые функции)', () => {
  const lookup = (rate: number, over: Partial<RateLookup> = {}): RateLookup => ({
    rate,
    source: 'nbt',
    asOf: '2026-10-10',
    stale: false,
    manual: false,
    ...over,
  });
  const wallets = [
    { id: 'a', currency: 'TJS' },
    { id: 'b', currency: 'USD' },
    { id: 'c', currency: 'USD' },
    { id: 'd', currency: 'EUR' },
  ];

  it('остатки одной валюты складываются точно, и только потом переводятся по курсу', () => {
    const balances = new Map([
      ['a', 1000],
      ['b', 1],
      ['c', 1],
      ['d', 0],
    ]);
    const r = computeHomeTotal(wallets, balances, 'TJS', (from) => (from === 'USD' ? lookup(0.5) : null));
    // 2 цента × 0,5 = 1 дирам (а не 0 + 0 из двух округлений 0,5 вниз)
    expect(r).toEqual({ totalMinor: 1001, approximate: true, missing: [], stale: [], entered: [], viaOtherRates: true });
  });

  it('валюта без курса уходит в missing вместе с остатком; нулевая — молча пропускается', () => {
    const balances = new Map([
      ['a', 1000],
      ['b', 500],
      ['c', 0],
      ['d', 0],
    ]);
    const r = computeHomeTotal(wallets, balances, 'TJS', () => null);
    expect(r).toEqual({ totalMinor: 1000, approximate: false, missing: [{ currency: 'USD', balanceMinor: 500 }], stale: [], entered: [], viaOtherRates: false });
  });

  it('устаревший курс попадает в stale с датой', () => {
    const balances = new Map([['b', 500]]);
    const r = computeHomeTotal(wallets, balances, 'TJS', () => lookup(10, { stale: true, asOf: '2026-09-01' }));
    expect(r?.stale).toEqual([{ currency: 'USD', asOf: '2026-09-01' }]);
    expect(r?.approximate).toBe(true);
  });

  it('сумма, не помещающаяся в безопасное целое, — null (экран покажет прочерк), а не падение', () => {
    const balances = new Map([
      ['a', 9_000_000_000_000_000],
      ['b', 0],
      ['c', 0],
      ['d', 0],
    ]);
    const two = [...wallets, { id: 'e', currency: 'TJS' }];
    balances.set('e', 9_000_000_000_000_000);
    expect(computeHomeTotal(two, balances, 'TJS', () => null)).toBeNull();
  });
});

describe('«Всего» по курсу, введённому в операции', () => {
  it('курса из сети нет: доллары пересчитаны по введённому курсу, «≈» и пояснение с датой, «нет курса» нет', async () => {
    const td = await openHome({ tables: [] });
    expect(text(total())).toContain('Не вошло в итог: нет курса (USD)'); // пока курс не вводили
    expect((await readNotes()).join(' ')).toContain('Не вошло в итог — нет курса');
    await write(async () => td.rates.rememberEnteredRate('USD', 'TJS', 11));
    // 500 750 − 10 $ × 11 = 500 750 − 11 000 = 489 750
    await waitFor(() => expect(text(total())).toContain(`≈ ${fmt(489_750)}`));
    expect(text(total())).not.toContain('нет курса');
    expect(await readNotes()).toEqual(['Остаток в USD пересчитан по введённому вами курсу от 10.10.']);
  });

  it('свежий курс Нацбанка сильнее введённого: итог по Нацбанку, пояснения про введённый курс нет', async () => {
    const td = await openHome();
    await write(async () => td.rates.rememberEnteredRate('USD', 'TJS', 99));
    expect(text(total())).toContain(`≈ ${fmt(489_850)}`);
    const notes = await readNotes();
    expect(notes).toEqual(['Остатки в других валютах пересчитаны по курсу.']);
    expect(notes.join(' ')).not.toContain('введённому');
  });

  it('курс Нацбанка устарел: введённый его заменяет, и вместо «Курс устарел» сказано, откуда курс', async () => {
    const td = await openHome({ tables: [table({ asOf: '2026-10-01' })] });
    expect(await readNotes()).toContain('Курс устарел (USD на 01.10.2026) — итог может быть неточным.');
    await write(async () => td.rates.rememberEnteredRate('USD', 'TJS', 11));
    await waitFor(() => expect(text(total())).toContain(`≈ ${fmt(489_750)}`));
    const notes = (await readNotes()).join(' ');
    expect(notes).toContain('по введённому вами курсу от 10.10');
    expect(notes).not.toContain('Курс устарел');
  });

  it('«Сбросить» в Настройках (forget) возвращает «нет курса»', async () => {
    const td = await openHome({ tables: [] });
    await write(async () => td.rates.rememberEnteredRate('USD', 'TJS', 11));
    await waitFor(() => expect(text(total())).toContain('≈'));
    expect((await readNotes()).join(' ')).toContain('введённому');
    await write(async () => td.rates.forgetEnteredRate('USD', 'TJS'));
    await waitFor(() => expect(text(total())).toContain('Не вошло в итог: нет курса (USD)'));
    expect(text(total())).not.toContain('≈');
    expect((await readNotes()).join(' ')).toContain('Не вошло в итог — нет курса');
  });

  it('основная валюта — доллар: «Не вошло в итог» не кончается двойной точкой («4 842,50 с..»)', async () => {
    await openHome({
      tables: [],
      setup: async (s) => {
        await seedHistory(s);
        await s.settings.update({ baseCurrency: 'USD' });
      },
    });
    await waitFor(() => expect(text(total())).toContain('Не вошло в итог: нет курса (TJS)'));
    const notes = await readNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Не вошло в итог — нет курса');
    expect(notes[0]).not.toContain('..');
    expect(notes[0]).toMatch(/нет курса: .*с\.$/);
  });
});

describe('расчёты главной: откуда курс', () => {
  const lookup = (entered: boolean) => (from: string): RateLookup | null =>
    from === 'USD'
      ? { rate: 11, source: entered ? 'manual' : 'nbt', asOf: '2026-10-10', stale: false, manual: false, ...(entered ? { entered: true } : {}) }
      : null;
  const wallets = [{ id: 'a', currency: 'TJS' }, { id: 'b', currency: 'USD' }];
  const balances = new Map([['a', 1000], ['b', 100]]);

  it('введённый курс попадает в entered с датой; viaOtherRates — только если был и обычный', () => {
    const r = computeHomeTotal(wallets, balances, 'TJS', lookup(true));
    expect(r).toMatchObject({ totalMinor: 2100, approximate: true, entered: [{ currency: 'USD', asOf: '2026-10-10' }], viaOtherRates: false });
    const n = computeHomeTotal(wallets, balances, 'TJS', lookup(false));
    expect(n).toMatchObject({ entered: [], viaOtherRates: true });
  });
});
