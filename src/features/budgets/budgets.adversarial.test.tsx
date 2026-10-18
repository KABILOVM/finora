import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, write } from '@/app/testkit';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import BudgetsPage from './BudgetsPage';
import BudgetsWidget from './BudgetsWidget';

/**
 * Атаки «ломателя» на модуль «Бюджеты и прогноз на день». «Сегодня» = четверг 15 октября 2026 (pinToday),
 * основная валюта TJS, до конца месяца 17 дней (15…31).
 */
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (el: Element | null) => norm(el?.textContent);
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const perDay = () => text(document.querySelector('[data-testid="forecast-per-day"]'));
const widgetPerDay = () => text(document.querySelector('[data-testid="widget-per-day"]'));
const card = () => document.querySelector('[data-testid="forecast-card"]');

interface Ids {
  cash: string;
  cats: Record<string, string>;
}

async function ids(s: Store): Promise<Ids> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  const cats: Record<string, string> = {};
  for (const c of await s.db.categories.toArray()) if (c.kind === 'expense') cats[c.name] = c.id;
  return { cash, cats };
}

/** 3 000 дохода 1 октября, расходы 500: на руках 2 500; до конца месяца 17 дней → 147,05 в день. */
async function baseSetup(s: Store): Promise<Ids> {
  const i = await ids(s);
  const income = (await s.db.categories.toArray()).find((c) => c.kind === 'income' && c.name === 'Зарплата');
  await s.transactions.create({ kind: 'income', walletId: i.cash, amountMinor: 300_000, categoryId: income?.id ?? null, occurredOn: '2026-10-01' });
  await s.transactions.create({ kind: 'expense', walletId: i.cash, amountMinor: 40_000, categoryId: i.cats['Еда'] ?? null, occurredOn: '2026-10-10' });
  await s.transactions.create({ kind: 'expense', walletId: i.cash, amountMinor: 10_000, categoryId: i.cats['Транспорт'] ?? null, occurredOn: '2026-10-12' });
  return i;
}

const savings = (s: Store, openingBalanceMinor = 900_000) =>
  s.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor, color: '#2563eb', icon: '🪙' });

async function openPage(setup: (s: Store) => Promise<unknown>) {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s)) });
  await showApp(<BudgetsPage />, td, '/budgets');
  await findByRole('heading', { name: 'Бюджеты', level: 1 });
  await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
  await waitFor(() => expect(card()).not.toBeNull());
  return td;
}

describe('атака: приложение простояло через полночь', () => {
  /** Телефон лёг в 23:50 с открытой «Главной», утром приложение развернули из фона: событий в базе не было, окно получило focus. */
  const wakeUpAt = async (when: Date) => {
    vi.setSystemTime(when);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };

  it('виджет «Можно тратить в день» на следующий день пересчитывается сам (а не показывает вчерашние 17 дней)', async () => {
    const td = opsDeps([table()], { setup: async (s) => void (await baseSetup(s)) });
    await showApp(<BudgetsWidget />, td, '/');
    await waitFor(() => expect(widgetPerDay()).toBe(fmt(14_705))); // 250 000 ÷ 17
    expect(text(document.querySelector('[data-testid="budgets-widget"]'))).toContain('до 31 октября');

    await wakeUpAt(new Date(2026, 9, 16, 8, 0, 0)); // уже пятница, 16 октября: до конца месяца 16 дней

    await eventually(() => expect(widgetPerDay()).toBe(fmt(15_625)), 3000); // 250 000 ÷ 16
  });

  it('экран «Бюджеты» в первое число нового месяца не считает «до конца октября»', async () => {
    vi.setSystemTime(new Date(2026, 9, 31, 23, 50, 0));
    const td = opsDeps([table()], { setup: async (s) => void (await baseSetup(s)) });
    await showApp(<BudgetsPage />, td, '/budgets');
    await findByRole('heading', { name: 'Бюджеты', level: 1 });
    await waitFor(() => expect(card()).not.toBeNull());
    // 31-е: не «тратьте всё сегодня», а не меньше недели
    expect(text(card())).toContain('До 6 ноября · 7 дней');

    await wakeUpAt(new Date(2026, 10, 1, 7, 30, 0)); // 1 ноября, 07:30

    await eventually(() => expect(text(card())).toContain('До 30 ноября · 30 дней'), 3000);
  });

  it('31 октября видна аренда 1 ноября; проведённая заранее, она не вычитается второй раз — ни вечером, ни утром 1-го', async () => {
    vi.setSystemTime(new Date(2026, 9, 31, 23, 50, 0));
    let ruleId = '';
    const td = opsDeps([table()], {
      setup: async (s) => {
        const i = await baseSetup(s);
        ruleId = (await s.recurring.create({ kind: 'expense', walletId: i.cash, amountMinor: 70_000, categoryId: i.cats['Жильё'] ?? null, frequency: 'monthly', startOn: '2026-11-01' })).id;
      },
    });
    await showApp(<BudgetsPage />, td, '/budgets');
    await findByRole('heading', { name: 'Бюджеты', level: 1 });
    await waitFor(() => expect(card()).not.toBeNull());
    expect(detail('Платежи и долги до 6 ноября')).toBe(fmt(-70_000));
    expect(perDay()).toBe(fmt(25_714)); // (250 000 − 70 000) ÷ 7

    // аренду за 1 ноября провели заранее, вечером 31-го
    await write(() => storeOf(td).transactions.createFromRule(ruleId, '2026-11-01'));
    await eventually(() => expect(detail('Деньги на руках')).toBe(fmt(180_000)), 3000);
    expect(detail('Платежи и долги до 6 ноября')).toBe(fmt(0));
    expect(perDay()).toBe(fmt(25_714));

    await wakeUpAt(new Date(2026, 10, 1, 7, 30, 0));
    await eventually(() => expect(text(card())).toContain('До 30 ноября · 30 дней'), 3000);
    expect(detail('Платежи и долги до 30 ноября')).toBe(fmt(0));
    expect(perDay()).toBe(fmt(6_000)); // 180 000 ÷ 30
  });

  it('экран «Бюджеты»: «текущий» месяц переезжает на новый сам, а вручную выбранный прошлый остаётся на месте', async () => {
    vi.setSystemTime(new Date(2026, 9, 31, 23, 50, 0));
    const td = opsDeps([table()], { setup: async (s) => void (await baseSetup(s)) });
    await showApp(<BudgetsPage />, td, '/budgets');
    await findByRole('heading', { name: 'Бюджеты', level: 1 });
    await waitFor(() => expect(text(document.body)).toContain('Октябрь 2026'));

    await wakeUpAt(new Date(2026, 10, 1, 7, 30, 0));
    await eventually(() => expect(text(document.body)).toContain('Ноябрь 2026'), 3000);
    expect(text(document.body)).not.toContain('Октябрь 2026');

    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(text(document.body)).toContain('Октябрь 2026'));
    await wakeUpAt(new Date(2026, 10, 2, 7, 30, 0)); // следующий день: выбранный вручную месяц не сбрасывается
    await act(async () => {});
    expect(text(document.body)).toContain('Октябрь 2026');
    expect(text(document.body)).not.toContain('Ноябрь 2026');
  });
});

describe('атака: деньги уходят из тех, что «на руках», не как расход', () => {
  it('регулярный перевод в копилку (накопления не считаются) уменьшает то, что можно тратить: его надо вычесть', async () => {
    await openPage(async (s) => {
      const i = await baseSetup(s);
      const box = await savings(s);
      // каждый месяц 20-го 1 000 с. уходит с «Наличных» в копилку, а копилку прогноз не считает
      await s.recurring.create({ kind: 'transfer', walletId: i.cash, toWalletId: box.id, amountMinor: 100_000, frequency: 'monthly', startOn: '2026-10-20' });
    });
    // (250 000 − 100 000) ÷ 17 = 8 823,5 → 88,23 с. в день. Без вычитания показывает 147,05 и деньги кончатся раньше срока
    expect(perDay()).toBe(fmt(8_823));
    expect(detail('Платежи и долги')).toBe(fmt(-100_000));
  });

  it('проведённый перевод в копилку второй раз не вычитается (деньги с «Наличных» уже ушли)', async () => {
    await openPage(async (s) => {
      const i = await baseSetup(s);
      const box = await savings(s);
      const rule = await s.recurring.create({ kind: 'transfer', walletId: i.cash, toWalletId: box.id, amountMinor: 100_000, frequency: 'monthly', startOn: '2026-10-20' });
      await s.transactions.createFromRule(rule.id, '2026-10-20'); // на руках стало 1 500
    });
    expect(detail('Платежи и долги')).toBe(fmt(0));
    expect(perDay()).toBe(fmt(8_823)); // 150 000 ÷ 17, а не (150 000 − 100 000) ÷ 17
  });

  it('пропущенный перевод в копилку не вычитается', async () => {
    await openPage(async (s) => {
      const i = await baseSetup(s);
      const box = await savings(s);
      const rule = await s.recurring.create({ kind: 'transfer', walletId: i.cash, toWalletId: box.id, amountMinor: 100_000, frequency: 'monthly', startOn: '2026-10-20' });
      await s.transactions.skipOccurrence(rule.id, '2026-10-20');
    });
    expect(detail('Платежи и долги')).toBe(fmt(0));
    expect(perDay()).toBe(fmt(14_705));
  });

  it('регулярный перевод между обычными кошельками (наличные → карта) деньги на руках не уменьшает', async () => {
    await openPage(async (s) => {
      const i = await baseSetup(s);
      const card = await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' });
      await s.recurring.create({ kind: 'transfer', walletId: i.cash, toWalletId: card.id, amountMinor: 100_000, frequency: 'monthly', startOn: '2026-10-20' });
    });
    expect(detail('Платежи и долги')).toBe(fmt(0));
    expect(perDay()).toBe(fmt(14_705));
  });

  it('регулярный ДОХОД в копилку не пополняет деньги на руках и не должен обрывать горизонт', async () => {
    await openPage(async (s) => {
      await baseSetup(s);
      const box = await savings(s, 0);
      // проценты по вкладу: 20-го +50 с. в копилку; на руках они не окажутся
      await s.recurring.create({ kind: 'income', walletId: box.id, amountMinor: 5_000, frequency: 'monthly', startOn: '2026-10-20' });
    });
    expect(text(card())).toContain('До 31 октября · 17 дней');
    expect(text(card())).not.toContain('ждём доход');
    expect(perDay()).toBe(fmt(14_705)); // а не 250 000 ÷ 5 = 500 с. в день
  });
});

/** Значение строки «Деньги на руках» и т. п. в карточке прогноза (по началу названия). */
const detail = (label: string): string => {
  const dt = Array.from(card()?.querySelectorAll('dt') ?? []).find((x) => norm(x.textContent).startsWith(label));
  return text(dt?.nextElementSibling ?? null);
};

describe('атака: трата не из «денег на руках»', () => {
  it('трата сегодня из копилки не раздувает «можно потратить сегодня» (в знаменателе её нет — и в числителе быть не должно)', async () => {
    await openPage(async (s) => {
      await baseSetup(s);
      const box = await savings(s);
      // 1 700 с. сегодня потрачено с копилки: деньги на руках (2 500) не изменились
      const food = (await s.db.categories.toArray()).find((c) => c.kind === 'expense' && c.name === 'Еда');
      await s.transactions.create({ kind: 'expense', walletId: box.id, amountMinor: 170_000, categoryId: food?.id ?? null, occurredOn: '2026-10-15' });
    });
    expect(perDay()).toBe(fmt(14_705)); // 250 000 ÷ 17: деньги на руках не менялись
    // «можно было сегодня» = то же 147,05, а не (2 500 + 1 700) ÷ 17 = 247,05
    expect(detail('Сегодня потрачено')).toMatch(new RegExp(`из ${fmt(14_705).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    // деньги на руках не менялись, поэтому и ложного «потрачено больше, чем можно» быть не должно
    expect(detail('Сегодня потрачено')).toMatch(new RegExp(`^${fmt(0).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} из `));
    expect(text(card())).not.toContain('Сегодня потрачено больше');
  });

  it('трата сегодня с обычного кошелька по-прежнему учитывается: 500 с. из 147,05 с.', async () => {
    await openPage(async (s) => {
      const i = await baseSetup(s);
      await s.transactions.create({ kind: 'expense', walletId: i.cash, amountMinor: 50_000, categoryId: i.cats['Еда'] ?? null, occurredOn: '2026-10-15' });
    });
    // деньги на руках после траты: 2 000, до конца месяца 17 дней → 117,64 в день; утром можно было (2 000 + 500) ÷ 17 = 147,05
    expect(perDay()).toBe(fmt(11_764));
    expect(detail('Сегодня потрачено')).toBe(`${fmt(50_000)} из ${fmt(14_705)}`);
  });
});

describe('держится: платежи и правила в связке с настоящей базой', () => {
  it('пропущенный платёж не вычитается; архивное правило не вычитается', async () => {
    await openPage(async (s) => {
      const i = await baseSetup(s);
      const skipped = await s.recurring.create({ kind: 'expense', walletId: i.cash, amountMinor: 30_000, frequency: 'monthly', startOn: '2026-10-20' });
      await s.transactions.skipOccurrence(skipped.id, '2026-10-20');
      const old = await s.recurring.create({ kind: 'expense', walletId: i.cash, amountMinor: 50_000, frequency: 'monthly', startOn: '2026-10-25' });
      await s.recurring.archive(old.id);
    });
    expect(detail('Платежи и долги')).toBe(fmt(0));
    expect(perDay()).toBe(fmt(14_705));
  });

  it('долг «мне должны» и закрытый долг «я должен» не вычитаются', async () => {
    await openPage(async (s) => {
      await baseSetup(s);
      await s.debts.create({ direction: 'lent', counterparty: 'Друг', principalMinor: 90_000, currency: 'TJS', openedOn: '2026-09-01', dueOn: '2026-10-20' });
      const paid = await s.debts.create({ direction: 'borrowed', counterparty: 'Сосед', principalMinor: 20_000, currency: 'TJS', openedOn: '2026-09-01', dueOn: '2026-10-25' });
      await s.debts.close(paid.id);
    });
    expect(detail('Платежи и долги')).toBe(fmt(0));
    expect(perDay()).toBe(fmt(14_705));
  });
});

/** Доступное имя элемента: aria-label, aria-labelledby, <label for>, оболочка <label>, текст. */
function nameOf(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return norm(aria);
  const by = el.getAttribute('aria-labelledby');
  if (by) return norm(by.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
  const id = el.getAttribute('id');
  const label = id ? document.querySelector(`label[for="${id}"]`) : null;
  if (label) return norm(label.textContent);
  const wrap = el.closest('label');
  if (wrap) return norm(wrap.textContent);
  return norm(el.textContent);
}

describe('держится: доступность — у каждой кнопки, ссылки и поля есть имя', () => {
  const unnamed = () =>
    Array.from(document.querySelectorAll('button, a[href], select, input, [role="progressbar"]'))
      .filter((el) => !el.closest('[aria-hidden="true"]') && nameOf(el) === '')
      .map((el) => el.outerHTML.slice(0, 120));

  it('экран с лимитами, архивом и предупреждениями; шит нового и существующего лимита', async () => {
    await openPage(async (s) => {
      const i = await baseSetup(s);
      await s.budgets.create({ categoryId: null, amountMinor: 200_000 });
      await s.budgets.create({ categoryId: i.cats['Еда'] ?? null, amountMinor: 50_000 });
      const old = await s.budgets.create({ categoryId: i.cats['Транспорт'] ?? null, amountMinor: 50_000 });
      await s.budgets.archive(old.id);
      await s.debts.create({ direction: 'borrowed', counterparty: 'Сосед', principalMinor: 20_000, currency: 'TJS', openedOn: '2026-09-01', dueOn: '2026-10-25' });
    });
    expect(unnamed()).toEqual([]);
    const { user } = await import('@/components/testUtils');
    await user.click(screen.getByRole('button', { name: /^Архив · 1 лимит/ }));
    expect(unnamed()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Добавить лимит' }));
    await findByRole('dialog', { name: 'Новый лимит' });
    expect(unnamed()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await user.click(screen.getByRole('button', { name: /^Лимит «Еда»/ }));
    await findByRole('dialog', { name: 'Лимит: Еда' });
    expect(unnamed()).toEqual([]);
  });
});

describe('держится: суммы, которые не помещаются в безопасное целое', () => {
  const huge = async (s: Store) => {
    const i = await ids(s);
    await s.budgets.create({ categoryId: null, amountMinor: 1_000_000_000_000_000 });
    for (let n = 0; n < 10; n++) {
      await s.transactions.create({ kind: 'expense', walletId: i.cash, amountMinor: 1_000_000_000_000_000, categoryId: i.cats['Еда'] ?? null, occurredOn: '2026-10-1' + String(n % 9) });
    }
  };

  it('экран «Бюджеты»: не падает, говорит словами, «Добавить лимит» не нажимается', async () => {
    const td = opsDeps([table()], { setup: async (s) => void (await huge(s)) });
    await showApp(<BudgetsPage />, td, '/budgets');
    await findByRole('heading', { name: 'Бюджеты', level: 1 });
    await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
    expect(screen.getAllByText('Не удалось посчитать').length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Добавить лимит' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('виджет «Главной»: не падает', async () => {
    const td = opsDeps([table()], { setup: async (s) => void (await huge(s)) });
    await showApp(<BudgetsWidget />, td, '/');
    await findByRole('heading', { name: 'Можно тратить в день' });
    expect(text(document.body)).toContain('Суммы слишком большие');
  });
});

describe('держится: подкатегории любой глубины, архивные и «без категории»', () => {
  it('трата в «Бар» (внук «Еды») входит в лимиты «Еды» и «Кафе», даже если «Кафе» уже в архиве; «Без лимита» её не показывает', async () => {
    await openPage(async (s) => {
      const i = await baseSetup(s);
      const cafe = await s.categories.create({ name: 'Кафе', kind: 'expense', parentId: i.cats['Еда'] ?? null, color: '#f97316', icon: '☕' });
      const bar = await s.categories.create({ name: 'Бар', kind: 'expense', parentId: cafe.id, color: '#f97316', icon: '🍺' });
      await s.transactions.create({ kind: 'expense', walletId: i.cash, amountMinor: 20_000, categoryId: bar.id, occurredOn: '2026-10-14' });
      await s.budgets.create({ categoryId: i.cats['Еда'] ?? null, amountMinor: 100_000 });
      await s.budgets.create({ categoryId: cafe.id, amountMinor: 40_000 });
      await s.categories.archive(cafe.id); // промежуточная категория ушла в архив: цепочка «Бар → Кафе → Еда» не рвётся
    });
    const food = screen.getByRole('button', { name: /^Лимит «Еда»/ });
    expect(text(food)).toContain(`${fmt(60_000)} из ${fmt(100_000)}`); // 400 (Еда) + 200 (Бар)
    expect(text(screen.getByRole('button', { name: /^Лимит «Кафе»/ }))).toContain(`${fmt(20_000)} из ${fmt(40_000)}`);
    // «Транспорт» (100) не охвачен: только он и остаётся «без лимита»
    const unlimited = Array.from(document.querySelectorAll('li')).find((li) => text(li).startsWith('➖ Без лимита') || text(li).includes('Без лимита'));
    expect(text(unlimited ?? null)).toContain(fmt(10_000));
  });
});

describe('держится: двойное нажатие', () => {
  it('«Сохранить» дважды подряд пишет один лимит и одно сообщение', async () => {
    const td = await openPage(baseSetup);
    const { user } = await import('@/components/testUtils');
    await user.click(screen.getByRole('button', { name: 'Добавить лимит' }));
    await findByRole('dialog', { name: 'Новый лимит' });
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '0' }));
    await user.click(screen.getByRole('button', { name: '0' }));
    const save = screen.getByRole('button', { name: 'Сохранить' });
    await Promise.all([user.click(save), user.click(save)]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const rows = await td.stores[0]!.db.budgets.toArray();
    expect(rows).toHaveLength(1);
    expect(screen.getAllByText('Лимит добавлен')).toHaveLength(1);
  });
});
