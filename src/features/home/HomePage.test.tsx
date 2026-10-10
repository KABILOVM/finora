import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { write } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
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
import { computeHomeTotal, sharePercent, topCategories } from './homeData';
import HomePage from './HomePage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
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
const monthCard = () => document.querySelector('[aria-label="Итоги месяца"]');
/** Значение строки итогов месяца по её названию: «Доходы» → «+5 000 с.». */
const summaryRow = (label: string): string => {
  const dt = Array.from(monthCard()?.querySelectorAll('dt') ?? []).find((x) => norm(x.textContent) === label);
  return text(dt?.nextElementSibling ?? null);
};
const walletCards = () => Array.from(document.querySelectorAll('section[aria-labelledby="home-wallets"] li')).map((li) => text(li));

describe('«Всего» и кошельки', () => {
  it('сумма по кошелькам в основной валюте с пометкой «≈»: доллары пересчитаны по курсу, остатки — в своей валюте', async () => {
    await openHome();
    // наличные 4 842,50 + карта 165 + (−10 $ × 10,9 = −109) = 4 898,50
    expect(text(total())).toContain(`≈ ${fmt(489_850)}`);
    expect(text(total())).toContain('Остатки в других валютах пересчитаны по курсу');
    const cards = walletCards();
    expect(cards).toHaveLength(3);
    expect(cards.find((c) => c.includes('Наличные'))).toContain(fmt(484_250));
    expect(cards.find((c) => c.includes('Карта'))).toContain(fmt(16_500));
    expect(cards.find((c) => c.includes('Доллары'))).toContain(fmt(-1000, 'USD')); // в долларах, не в сомони
  });

  it('отрицательный остаток показан красным', async () => {
    await openHome();
    const usd = Array.from(document.querySelectorAll('section[aria-labelledby="home-wallets"] li')).find((li) => li.textContent?.includes('Доллары'));
    expect(usd?.innerHTML).toContain('text-expense');
  });

  it('нет курса доллара: сумма в долларах НЕ входит в итог, это прямо сказано; «≈» нет, раз ничего не пересчитано', async () => {
    await openHome({ tables: [] });
    expect(text(total())).toContain(fmt(500_750));
    expect(text(total())).not.toContain('≈');
    expect(text(total())).toContain(`Не вошло в итог — нет курса: ${fmt(-1000, 'USD')}`);
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
  });

  it('устаревший курс (старше 3 суток): предупреждение с датой', async () => {
    await openHome({ tables: [table({ asOf: '2026-10-01' })] });
    expect(text(total())).toContain('Курс устарел (USD на 01.10.2026)');
    expect(text(total())).toContain('≈');
  });

  it('свежий курс — без предупреждения об устаревании', async () => {
    await openHome();
    expect(text(total())).not.toContain('устарел');
  });

  it('удалённая операция не видна, а остаток и «Всего» верны', async () => {
    const td = await openHome();
    await write(() => storeOf(td).transactions.softDelete(hist.txs['advance'] ?? ''));
    await waitFor(() => expect(walletCards().find((c) => c.includes('Наличные'))).toContain(fmt(-15_750)));
    expect(text(total())).toContain(fmt(489_850 - 500_000));
    await waitFor(() => expect(summaryRow('Доходы')).toBe(fmt(0, 'TJS', 'always')));
    expect(document.body.textContent).not.toContain('аванс');
    expect(await storeOf(td).db.transactions.count()).toBe(8);
  });
});

describe('«Этот месяц»', () => {
  it('доходы, расходы и разница в основной валюте; переводы и сентябрь не считаются', async () => {
    await openHome();
    const card = text(monthCard());
    expect(card).toContain('Октябрь 2026');
    expect(card).toContain('Этот месяц');
    // расходы: 12,50 + 3 + 109 (10 $ по курсу из операции) = 124,50
    expect(summaryRow('Доходы')).toBe(fmt(500_000, 'TJS', 'always'));
    expect(summaryRow('Расходы')).toBe(fmt(-12_450));
    expect(summaryRow('Разница')).toBe(fmt(487_550, 'TJS', 'always'));
  });

  it('стрелки листают месяцы; вперёд дальше текущего не пускают', async () => {
    await openHome();
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(text(monthCard())).toContain('Сентябрь 2026'));
    await waitFor(() => expect(summaryRow('Расходы')).toBe(fmt(-4700)));
    expect(summaryRow('Доходы')).toBe(fmt(0, 'TJS', 'always'));
    expect(summaryRow('Разница')).toBe(fmt(-4700));
    expect(text(monthCard())).not.toContain('Этот месяц');
    await user.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    await waitFor(() => expect(text(monthCard())).toContain('Октябрь 2026'));
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
  });

  it('расходы по категориям: названия, суммы и доли', async () => {
    await openHome();
    const items = Array.from(monthCard()?.querySelectorAll('h3 + ul > li') ?? []).map((li) => text(li));
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Еда');
    expect(items[0]).toContain(fmt(12_150));
    expect(items[0]).toContain('98%');
    expect(items[1]).toContain('Транспорт');
    expect(items[1]).toContain('2%');
  });

  it('расходы «без категории» — отдельной строкой', async () => {
    await openHome();
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(text(monthCard())).toContain('Сентябрь 2026'));
    await waitFor(() => expect(text(monthCard())).toContain('Продукты'));
    expect(text(monthCard())).toContain('Без категории');
  });

  it('топ-5 категорий, остальные — одной строкой «ещё N категорий» с общей суммой', async () => {
    await openHome({
      setup: async (s) => {
        const cash = (await s.db.wallets.toArray())[0];
        const cats = (await s.db.categories.toArray()).filter((c) => c.kind === 'expense');
        // 7 категорий: 700, 600, ... 100 дирам
        for (const [i, c] of cats.slice(0, 7).entries()) {
          await s.transactions.create({ kind: 'expense', walletId: cash?.id ?? '', amountMinor: (7 - i) * 100, categoryId: c.id, occurredOn: '2026-10-10' });
        }
      },
    });
    const items = Array.from(monthCard()?.querySelectorAll('h3 + ul > li') ?? []).map((li) => text(li));
    expect(items).toHaveLength(6); // 5 + «ещё»
    expect(items[5]).toContain('ещё 2 категории');
    expect(items[5]).toContain(fmt(300)); // 200 + 100
  });

  it('операции в другой основной валюте не смешиваются с остальными — это объяснено', async () => {
    const td = await openHome();
    await write(() => storeOf(td).settings.update({ baseCurrency: 'USD' }));
    await waitFor(() => expect(text(monthCard())).toContain('Не учтено'));
    // в октябре 3 расхода и 1 доход (все со снимком в сомони)
    expect(text(monthCard())).toContain('Не учтено 4 операции');
    expect(text(monthCard())).toContain('(USD)');
    // суммы подписаны новой валютой, а не старой
    expect(summaryRow('Расходы')).toBe(fmt(0, 'USD'));
  });

  it('в месяце нет расходов — об этом сказано словами', async () => {
    await openHome({
      setup: async (s) => {
        await seedHistory(s);
      },
    });
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(text(monthCard())).toContain('Июль 2026'));
    await waitFor(() => expect(text(monthCard())).toContain('расходов нет'));
  });
});

describe('последние операции', () => {
  it('пять последних, новые сверху, и ссылка «Все операции»', async () => {
    await openHome();
    const section = document.querySelector('section[aria-labelledby="home-recent"]');
    const rows = Array.from(section?.querySelectorAll('button') ?? []).map((b) => text(b));
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
    expect(screen.getByRole('link', { name: 'Создать кошелёк' })).toHaveAttribute('href', '/wallets');
    expect(total()).toBeNull();
  });

  it('кошелёк есть, операций нет: нули в итогах и кнопка «Добавить операцию»', async () => {
    await openHome({ setup: async () => undefined });
    expect(text(total())).toContain(fmt(0));
    expect(walletCards()).toHaveLength(1);
    expect(summaryRow('Расходы')).toBe(fmt(0));
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
    expect(r).toEqual({ totalMinor: 1001, approximate: true, missing: [], stale: [] });
  });

  it('валюта без курса уходит в missing вместе с остатком; нулевая — молча пропускается', () => {
    const balances = new Map([
      ['a', 1000],
      ['b', 500],
      ['c', 0],
      ['d', 0],
    ]);
    const r = computeHomeTotal(wallets, balances, 'TJS', () => null);
    expect(r).toEqual({ totalMinor: 1000, approximate: false, missing: [{ currency: 'USD', balanceMinor: 500 }], stale: [] });
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

  it('topCategories и sharePercent', () => {
    const rows = [5, 4, 3, 2, 1, 1, 1].map((n, i) => ({ categoryId: `c${i}`, totalMinor: n * 100 }));
    expect(topCategories(rows)).toEqual({ top: rows.slice(0, 5), restCount: 2, restMinor: 200 });
    expect(topCategories(rows.slice(0, 3))).toEqual({ top: rows.slice(0, 3), restCount: 0, restMinor: 0 });
    expect(topCategories([])).toEqual({ top: [], restCount: 0, restMinor: 0 });
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(2, 3)).toBe(67);
    expect(sharePercent(5, 0)).toBe(0);
    expect(sharePercent(0, 10)).toBe(0);
    expect(sharePercent(10, 10)).toBe(100);
  });
});
