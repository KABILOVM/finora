import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { choose, LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { useLocation } from 'react-router-dom';
import AnalyticsPage from './AnalyticsPage';

function SearchProbe() {
  return <p data-testid="search">{useLocation().search}</p>;
}

/** «Сегодня» = четверг 15 октября 2026. */
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** Октябрь: Еда 12,50 + 50, Транспорт 3, Покупки 80; сентябрь: Еда 45. Подкатегория «Кафе» внутри «Еды». */
async function setup(s: Store) {
  const cash = (await s.db.wallets.toArray())[0]!.id;
  const cat = async (name: string) => (await s.db.categories.toArray()).find((c) => c.name === name && c.kind === 'expense')!;
  const food = await cat('Еда');
  const cafe = await s.categories.create({ name: 'Кафе', kind: 'expense', parentId: food.id, color: '#f97316', icon: '☕' });
  const spend = (categoryId: string, amountMinor: number, occurredOn: string, note = '') =>
    s.transactions.create({ kind: 'expense', walletId: cash, amountMinor, categoryId, occurredOn, note });
  await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 500_000, categoryId: null, occurredOn: '2026-10-01' });
  await spend(food.id, 1_250, '2026-10-05', 'Обед');
  await spend(cafe.id, 5_000, '2026-10-08', 'Ужин в кафе');
  await spend((await cat('Транспорт')).id, 300, '2026-10-09', 'Такси');
  await spend((await cat('Покупки')).id, 8_000, '2026-10-10', 'Куртка');
  await spend(food.id, 4_500, '2026-09-10', 'Сентябрьская еда');
}

async function openPage(path = '/analytics') {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s)) });
  await showApp(
    <>
      <AnalyticsPage />
      <LocationProbe />
      <SearchProbe />
    </>,
    td,
    path,
  );
  await findByRole('heading', { name: 'Аналитика', level: 1 });
  await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
  return td;
}

const topNotes = () => Array.from(document.querySelectorAll('ol[aria-label="Самые крупные расходы"] li')).map((li) => norm(li.textContent));
const compareRows = () => Array.from(document.querySelectorAll('ul[aria-label="Расходы по категориям"] li')).map((li) => norm(li.textContent));
const summaryText = () => norm(tid('analytics-summary')?.textContent);

describe('«Аналитика»: фильтр по категории', () => {
  it('«Еда» охватывает и подкатегорию «Кафе»: сужаются крупные расходы и сравнение категорий, сводка остаётся общей', async () => {
    await openPage();
    expect(topNotes()).toHaveLength(4);
    const before = summaryText();
    expect(before).toContain(norm(formatMinor(14_550, 'TJS')));

    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    choose('Категория', 'Еда');
    await user.click(screen.getByRole('button', { name: 'Применить' }));

    await waitFor(() => expect(topNotes()).toHaveLength(2));
    expect(topNotes().join(' ')).toContain('Ужин в кафе');
    expect(topNotes().join(' ')).toContain('Обед');
    expect(topNotes().join(' ')).not.toContain('Куртка');
    // в сравнении — строки «Еда» и «Кафе», остальных нет
    expect(compareRows().join(' ')).toContain('Еда');
    expect(compareRows().join(' ')).not.toContain('Покупки');
    expect(compareRows().join(' ')).not.toContain('Транспорт');
    // итоги месяца не изменились, и на экране сказано, что показано
    expect(summaryText()).toBe(before);
    expect(document.querySelectorAll('[data-testid="analytics-filter-note"]')).toHaveLength(2);
    expect(document.querySelector('[data-testid="analytics-filter-note"]')?.textContent).toContain('Только «Еда». Доли — от всех расходов месяца.');
    expect(tid('search')?.textContent).toMatch(/^\?cat=/);
  });

  it('фильтр лежит в адресе: ссылка с ?cat= открывает уже отфильтрованный обзор, «Сбросить» чистит адрес', async () => {
    const td = await openPage();
    const food = (await td.stores[0]!.db.categories.toArray()).find((c) => c.name === 'Транспорт' && c.kind === 'expense')!;
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    choose('Категория', 'Транспорт');
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(topNotes()).toHaveLength(1));
    expect(tid('search')?.textContent).toBe(`?cat=${food.id}`);

    await user.click(screen.getByRole('button', { name: 'Сбросить' }));
    await waitFor(() => expect(topNotes()).toHaveLength(4));
    expect(tid('search')?.textContent).toBe('');
  });

  it('неизвестная категория в адресе игнорируется: показан обычный обзор', async () => {
    await openPage('/analytics?cat=nonexistent');
    expect(topNotes()).toHaveLength(4);
    expect(document.querySelector('[data-testid="analytics-filter-note"]')).toBeNull();
  });

  it('выбранная категория без расходов в другом месяце: остаётся выбранной, и вместо пустоты — понятное сообщение', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    choose('Категория', 'Транспорт');
    await user.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(topNotes()).toHaveLength(1));

    // в сентябре и августе такси не было
    await user.click(screen.getByRole('button', { name: /Предыдущий месяц/ }));
    await waitFor(() => expect(document.body.textContent).toContain('По категории «Транспорт» расходов в этом и прошлом месяце нет.'));
    expect(document.body.textContent).toContain('По категории «Транспорт» расходов в этом месяце нет.');
    expect(tid('search')?.textContent).toMatch(/month=2026-09/);
    expect(tid('search')?.textContent).toMatch(/cat=/);
  });
});
