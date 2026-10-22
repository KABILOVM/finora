import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, findByRole, fire, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentSearch, LocationProbe, opsDeps, pinToday, setDateInput, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import AnalyticsPage from './AnalyticsPage';

/** «Сегодня» = четверг 15 октября 2026. */
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (el: Element | null | undefined) => norm(el?.textContent);
const fmt = (minor: number) => norm(formatMinor(minor, 'TJS'));
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/**
 * Данные двух лет. Расходы 2026: Еда 120 (10 февраля), Транспорт 30 (5 августа), Продукты 50 (2 октября); доходы: зарплата 3 000 (1 февраля).
 * 2025: Еда 100 (10 марта), Транспорт 20 (5 ноября — позже 15 октября, в сравнение «с теми же днями» не входит); зарплата 2 000 (1 марта).
 */
async function seed(s: Store): Promise<void> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  const cats = await s.db.categories.toArray();
  const cat = (name: string, kind: 'expense' | 'income' = 'expense') => cats.find((c) => c.name === name && c.kind === kind)?.id ?? '';
  const add = (kind: 'expense' | 'income', amountMinor: number, categoryId: string, occurredOn: string) =>
    s.transactions.create({ kind, walletId: cash, amountMinor, categoryId, occurredOn });
  await add('expense', 12_000, cat('Еда'), '2026-02-10');
  await add('expense', 3_000, cat('Транспорт'), '2026-08-05');
  await add('expense', 5_000, cat('Продукты'), '2026-10-02');
  await add('income', 300_000, cat('Зарплата', 'income'), '2026-02-01');
  await add('expense', 10_000, cat('Еда'), '2025-03-10');
  await add('expense', 2_000, cat('Транспорт'), '2025-11-05');
  await add('income', 200_000, cat('Зарплата', 'income'), '2025-03-01');
}

async function openPeriods(search = '', setup: (s: Store) => Promise<unknown> = seed) {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s)) });
  await showApp(
    <>
      <AnalyticsPage />
      <LocationProbe />
    </>,
    td,
    `/analytics?tab=periods${search}`,
  );
  await findByRole('heading', { name: 'Аналитика', level: 1 });
  await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
  return td;
}

/** Выбор пункта в обычном выпадающем списке так, как это сделал бы браузер. */
function choose(select: HTMLElement, value: string): void {
  const el = select as HTMLSelectElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, value);
    fire(el, new Event('change', { bubbles: true }));
  });
}

const compareSelect = () => document.getElementById('period-compare') as HTMLSelectElement;

describe('вкладка «Периоды»', () => {
  it('открывается из переключателя раздела и записывает себя в адрес', async () => {
    await openPeriods();
    expect(screen.getByRole('radio', { name: 'Периоды', checked: true })).toBeTruthy();
    expect(tid('period-controls')).not.toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Обзор' }));
    await waitFor(() => expect(currentSearch()).toBe(''));
    await user.click(screen.getByRole('radio', { name: 'Периоды' }));
    await waitFor(() => expect(currentSearch()).toBe('?tab=periods'));
  });

  it('по умолчанию — идущий год против тех же дней прошлого: расходы, доходы, норма сбережений', async () => {
    await openPeriods();
    const summary = tid('period-summary')!;
    expect(text(summary)).toContain('Расходы за 2026 год');
    expect(text(summary)).toContain(fmt(20_000)); // 120 + 30 + 50
    // 2025 до 15 октября: расходы 100 (транспорт 5 ноября не входит), доходы 2 000
    expect(text(tid('period-expense-delta'))).toBe(`▲ +100% · за те же дни прошлого года ${fmt(10_000)}`);
    expect(text(tid('period-income-delta'))).toBe(`▲ +50% · за те же дни прошлого года ${fmt(200_000)}`);
    expect(text(tid('period-range'))).toBe('01.01.2026 — 15.10.2026, период ещё идёт. Сравниваем с 01.01.2025 — 15.10.2025.');
    // (3 000 − 200) ÷ 3 000 = 93,3% → 93%; год назад (2 000 − 100) ÷ 2 000 = 95%
    expect(text(tid('savings-rate'))).toContain('93%');
    expect(text(tid('savings-rate'))).toContain('Вы сохранили 93% дохода');
    expect(text(tid('savings-rate-prev'))).toBe('За те же дни прошлого года было 95%');
  });

  it('«Куда ушли деньги»: расходы по категориям и остаток дохода', async () => {
    await openPeriods();
    const flow = tid('income-flow')!;
    const rows = Array.from(flow.querySelectorAll('li')).map((li) => text(li));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('Еда');
    expect(rows[0]).toContain('4%'); // 120 из 3 000
    expect(rows[0]).toContain(fmt(12_000));
    expect(rows[1]).toContain('Продукты');
    expect(rows[2]).toContain('Транспорт');
    expect(rows[3]).toContain('Осталось');
    expect(rows[3]).toContain(fmt(280_000));
    expect(tid('flow-deficit')).toBeNull();
  });

  it('расходы по категориям против прошлого года: рост красным, новая категория помечена; доходы — отдельным списком', async () => {
    await openPeriods();
    const rows = Array.from(screen.getByRole('list', { name: 'Расходы по категориям' }).querySelectorAll('li')).map((li) => text(li));
    expect(rows[0]).toContain('Еда');
    expect(rows[0]).toContain('▲ +20%'); // 120 против 100
    expect(rows[0]).toContain(`За те же дни прошлого года ${fmt(10_000)}`);
    expect(rows[1]).toContain('Продукты');
    expect(rows[1]).toContain('новая');
    expect(rows[2]).toContain('Транспорт');
    expect(rows[2]).toContain('новая'); // ноябрьская покупка 2025 в сравнение не входит
    const income = Array.from(screen.getByRole('list', { name: 'Доходы по категориям' }).querySelectorAll('li')).map((li) => text(li));
    expect(income).toHaveLength(1);
    expect(income[0]).toContain('Зарплата');
    expect(income[0]).toContain('100%');
    expect(income[0]).toContain('▲ +50%');
  });

  it('по месяцам: таблица для скринридера от января до октября; главное — самый затратный месяц и главная статья', async () => {
    await openPeriods();
    const t = Array.from(document.querySelectorAll('table')).find((x) => norm(x.querySelector('caption')?.textContent) === 'Доходы и расходы по месяцам периода')!;
    const rows = Array.from(t.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(10);
    expect(norm(rows[1]!.querySelector('th')?.textContent)).toBe('Февраль 2026');
    expect(norm(rows[1]!.querySelectorAll('td')[1]?.textContent)).toBe(fmt(12_000));
    const main = text(tid('period-highlights'));
    expect(main).toContain('Больше всего потрачено в месяце «февраль 2026»');
    expect(main).toContain('Главная статья расходов — Еда');
    expect(main).toContain('60% всех расходов'); // 120 из 200
    expect(main).toContain('В среднем в месяц уходит'); // три месяца с расходами: 200 ÷ 3 = 66,66
    expect(main).toContain(fmt(6_666));
  });

  it('квартал: стрелки листают кварталы, адрес запоминает выбор; прошлого квартала не было — так и написано', async () => {
    await openPeriods();
    await user.click(screen.getByRole('radio', { name: 'Квартал' }));
    await waitFor(() => expect(currentSearch()).toBe('?tab=periods&kind=quarter'));
    expect(text(tid('period-summary'))).toContain('Расходы за 4-й квартал 2026');
    expect(text(tid('period-summary'))).toContain(fmt(5_000)); // только продукты 2 октября
    await user.click(screen.getByRole('button', { name: 'Предыдущий квартал' }));
    await waitFor(() => expect(text(tid('period-summary'))).toContain('Расходы за 3-й квартал 2026'));
    expect(text(tid('period-summary'))).toContain(fmt(3_000)); // транспорт 5 августа
    expect(currentSearch()).toBe('?tab=periods&kind=quarter&q=3');
    // квартал до него (2-й) пуст
    expect(text(tid('period-expense-delta'))).toBe('В прошлом квартале расходов не было');
    // дальше «Следующий квартал» ведёт обратно, а за нынешний не пускает
    await user.click(screen.getByRole('button', { name: 'Следующий квартал' }));
    await waitFor(() => expect(text(tid('period-summary'))).toContain('4-й квартал 2026'));
    expect(screen.getByRole('button', { name: 'Следующий квартал' }).hasAttribute('disabled')).toBe(true);
  });

  it('год: стрелки листают годы; будущий год не выбрать; полный прошлый год сравнивается с позапрошлым целиком', async () => {
    await openPeriods();
    expect(screen.getByRole('button', { name: 'Следующий год' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Предыдущий год' }));
    await waitFor(() => expect(text(tid('period-summary'))).toContain('Расходы за 2025 год'));
    expect(text(tid('period-summary'))).toContain(fmt(12_000)); // 100 + 20
    expect(currentSearch()).toBe('?tab=periods&year=2025');
    expect(text(tid('period-range'))).toBe('01.01.2025 — 31.12.2025. Сравниваем с 01.01.2024 — 31.12.2024.');
    expect(text(tid('period-expense-delta'))).toBe('В прошлом году расходов не было');
  });

  it('свои даты: период в один месяц — без графика по месяцам; сравнение с предыдущими такими же днями', async () => {
    await openPeriods('&kind=custom&from=2026-02-01&to=2026-02-28');
    expect(text(tid('period-summary'))).toContain('Расходы за 01.02.2026 — 28.02.2026');
    expect(text(tid('period-summary'))).toContain(fmt(12_000));
    expect(text(tid('period-expense-delta'))).toBe('За предыдущие 28 дней расходов не было');
    expect(text(tid('period-range'))).toBe('Сравниваем с 04.01.2026 — 31.01.2026.');
    expect(tid('period-months')).toBeNull();
    expect(tid('period-highlights')).toBeNull();
  });

  it('свои даты: ввод дат в поля меняет адрес и отчёт', async () => {
    await openPeriods('&kind=custom&from=2026-02-01&to=2026-02-28');
    setDateInput(document.querySelectorAll<HTMLInputElement>('input[type="date"]')[1]!, '2026-03-31');
    await waitFor(() => expect(currentSearch()).toContain('to=2026-03-31'));
    await waitFor(() => expect(text(tid('period-summary'))).toContain('Расходы за 01.02.2026 — 31.03.2026'));
    expect(tid('period-months')).not.toBeNull(); // теперь два месяца
  });

  it('свои даты: конец раньше начала — подсказка под полем вместо отчёта', async () => {
    await openPeriods('&kind=custom&from=2026-03-10&to=2026-03-01');
    expect(text(document.body)).toContain('Начало позже конца');
    expect(tid('period-summary')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Выберите правильные даты');
  });

  it('«Не сравнивать» убирает сдвиги и строку «Сравниваем с»', async () => {
    await openPeriods();
    choose(compareSelect(), 'none');
    await waitFor(() => expect(tid('period-expense-delta')).toBeNull());
    expect(currentSearch()).toBe('?tab=periods&cmp=none');
    expect(text(tid('period-range'))).not.toContain('Сравниваем');
    expect(tid('savings-rate-prev')).toBeNull();
    const rows = Array.from(screen.getByRole('list', { name: 'Расходы по категориям' }).querySelectorAll('li')).map((li) => text(li));
    expect(rows[0]).not.toContain('▲');
    expect(rows[1]).not.toContain('новая');
  });

  it('у квартала есть «с тем же периодом год назад»; у года такого пункта нет', async () => {
    await openPeriods('&kind=quarter&year=2026&q=1');
    expect(Array.from(compareSelect().options).map((o) => o.textContent)).toEqual(['С прошлым кварталом', 'Этот квартал год назад', 'Не сравнивать']);
    choose(compareSelect(), 'yoy');
    await waitFor(() => expect(text(tid('period-range'))).toContain('Сравниваем с 01.01.2025 — 31.03.2025.'));
    await user.click(screen.getByRole('radio', { name: 'Год' }));
    await waitFor(() => expect(Array.from(compareSelect().options).map((o) => o.textContent)).toEqual(['С прошлым годом', 'Не сравнивать']));
    expect(compareSelect().value).toBe('prev');
  });

  it('период без операций — понятная заглушка, а не нули', async () => {
    await openPeriods('&year=2024');
    expect(screen.getByRole('heading', { name: 'За этот период нет операций' })).toBeTruthy();
    expect(tid('period-summary')).toBeNull();
    expect(tid('period-controls')).not.toBeNull(); // выбор периода остаётся
  });

  it('мусор в адресе не ломает экран: берутся значения по умолчанию', async () => {
    await openPeriods('&kind=вечность&year=3000&q=9&cmp=x');
    expect(text(tid('period-summary'))).toContain('Расходы за 2026 год');
  });

  it('расходы больше дохода: полоса — все расходы, превышение подписано', async () => {
    await openPeriods('&kind=custom&from=2026-08-01&to=2026-08-31');
    // в августе только расход 30, доходов нет
    expect(text(tid('income-flow'))).toContain('Доходов за период нет');
    expect(text(tid('flow-deficit'))).toBe(`Потрачено: ${fmt(3_000)}`);
    expect(text(tid('savings-rate'))).toContain('Доходов за период нет — считать не с чего.');
    expect(tid('savings-rate')!.querySelector('p:nth-of-type(2)')?.textContent).toBe('—');
  });

  it('категорий больше восьми: остальные раскрываются кнопкой', async () => {
    await openPeriods('', async (s) => {
      await seed(s);
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
      for (let i = 0; i < 9; i++) {
        const c = await s.categories.create({ name: `Своя ${i}`, kind: 'expense', color: '#2563eb', icon: '🧪' });
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 100 + i, categoryId: c.id, occurredOn: '2026-09-09' });
      }
    });
    const list = () => screen.getByRole('list', { name: 'Расходы по категориям' });
    expect(list().querySelectorAll('li')).toHaveLength(8);
    await user.click(screen.getByRole('button', { name: /^Показать ещё \d+ категори/ }));
    expect(list().querySelectorAll('li')).toHaveLength(12);
    await user.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(list().querySelectorAll('li')).toHaveLength(8);
  });
});
