import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, write } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import {
  choose,
  currentPath,
  LocationProbe,
  opsDeps,
  pinToday,
  showApp,
  storeOf,
  table,
  tapAmount,
  unpinToday,
} from '@/features/transactions/__fixtures__/opsKit';
import BudgetsPage from './BudgetsPage';
import BudgetsWidget from './BudgetsWidget';

/** «Сегодня» = четверг 15 октября 2026 (pinToday): до конца месяца 17 дней (15…31), основная валюта TJS. */
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (el: Element | null) => norm(el?.textContent);
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));

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

/** 3 000 дохода 1 октября, расходы: Еда 400 и Транспорт 100 — на руках 2 500, до конца месяца 17 дней: 147,05 в день. */
async function baseSetup(s: Store): Promise<Ids> {
  const i = await ids(s);
  const income = (await s.db.categories.toArray()).find((c) => c.kind === 'income' && c.name === 'Зарплата');
  await s.transactions.create({ kind: 'income', walletId: i.cash, amountMinor: 300_000, categoryId: income?.id ?? null, occurredOn: '2026-10-01' });
  await s.transactions.create({ kind: 'expense', walletId: i.cash, amountMinor: 40_000, categoryId: i.cats['Еда'] ?? null, occurredOn: '2026-10-10' });
  await s.transactions.create({ kind: 'expense', walletId: i.cash, amountMinor: 10_000, categoryId: i.cats['Транспорт'] ?? null, occurredOn: '2026-10-12' });
  return i;
}

type Setup = (s: Store) => Promise<unknown>;
const quiet = (setup?: Setup) => (setup ? async (s: Store) => void (await setup(s)) : undefined);

async function openPage(setup?: Setup, path = '/budgets') {
  const td = opsDeps([table()], { setup: quiet(setup) });
  await showApp(
    <>
      <BudgetsPage />
      <LocationProbe />
    </>,
    td,
    path,
  );
  await findByRole('heading', { name: 'Бюджеты', level: 1 });
  await waitFor(() => expect(screen.queryByText('Считаем…')).toBeNull());
  // Прогноз читается отдельным запросом: ждём и его (серый каркас карточки уходит), иначе под нагрузкой тест видит ещё пустую карточку.
  await waitFor(() => expect(document.querySelector('[aria-busy="true"][aria-label="Сколько можно тратить в день"]')).toBeNull());
  return td;
}

async function openWidget(setup?: Setup) {
  const td = opsDeps([table()], { setup: quiet(setup) });
  await showApp(<BudgetsWidget />, td, '/');
  return td;
}

const rowButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^Лимит «${name}»`) });
const card = () => document.querySelector('[data-testid="forecast-card"]');
/** Значение строки «Деньги на руках» и т. п. в карточке прогноза (по началу названия). */
const detail = (label: string): string => {
  const dt = Array.from(card()?.querySelectorAll('dt') ?? []).find((x) => norm(x.textContent).startsWith(label));
  return text(dt?.nextElementSibling ?? null);
};
const perDay = () => text(document.querySelector('[data-testid="forecast-per-day"]'));

describe('экран «Бюджеты»: пустые состояния', () => {
  it('нет лимитов: понятный призыв, а не пустота', async () => {
    await openPage();
    expect(screen.getByRole('heading', { name: 'Лимитов пока нет' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Поставить первый лимит' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Добавить лимит' })).toBeTruthy();
    // прогноз есть даже без лимитов: денег 0 → 0 в день, без тревожных слов
    expect(perDay()).toBe(fmt(0));
    expect(text(card())).not.toContain('не хватает');
  });

  it('нет кошельков: вместо цифр — объяснение и ссылка, а не «0 в день»', async () => {
    await openPage(async (s) => {
      const w = (await s.db.wallets.toArray())[0];
      if (w) await s.wallets.archive(w.id);
    });
    expect(document.querySelector('[data-testid="forecast-card"]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Пока нечего считать' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Открыть кошельки' })).toBeTruthy();
  });
});

describe('экран «Бюджеты»: прогноз', () => {
  it('«Осталось на день»: деньги ÷ дни до конца месяца с округлением вниз, из чего сложилось — видно', async () => {
    await openPage(baseSetup);
    expect(perDay()).toBe(fmt(14_705)); // 250 000 ÷ 17 = 14 705,88
    const c = text(card());
    expect(c).toContain('До 31 октября · 17 дней');
    expect(detail('Деньги на руках')).toBe(fmt(250_000));
    expect(detail('Платежи и долги до 31 октября')).toBe(fmt(0));
    expect(detail('Сегодня потрачено')).toBe(`${fmt(0)} из ${fmt(14_705)}`);
    expect(detail('Обычно вы тратите')).toBe(`${fmt(3_571)} в день`); // 500 ÷ 14 дней с первой операции
        expect(c).not.toContain('≈');
  });

  it('«Как это считается» раскрывается и объясняет простыми словами', async () => {
    await openPage(baseSetup);
    const toggle = screen.getByRole('button', { name: 'Как это считается' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(text(card())).not.toContain('Накопления не считаем');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(text(card())).toContain('Накопления не считаем');
    expect(text(card())).toContain('округляем вниз');
  });

  it('регулярный платёж и долг к сроку вычитаются; проведённый платёж второй раз не вычитается', async () => {
    let ruleId = '';
    const td = await openPage(async (s) => {
      const i = await baseSetup(s);
      const rule = await s.recurring.create({ kind: 'expense', walletId: i.cash, amountMinor: 30_000, categoryId: i.cats['Жильё'] ?? null, frequency: 'monthly', startOn: '2026-10-20' });
      ruleId = rule.id;
      await s.debts.create({ direction: 'borrowed', counterparty: 'Сосед', principalMinor: 20_000, currency: 'TJS', openedOn: '2026-09-01', dueOn: '2026-10-25' });
    });
    // (250 000 − 30 000 − 20 000) ÷ 17 = 11 764,7
    expect(perDay()).toBe(fmt(11_764));
    expect(detail('Платежи и долги до 31 октября')).toBe(`−${fmt(50_000)}`);

    // платёж проведён: деньги ушли с кошелька, а в обязательных его больше нет — итог тот же
    await write(() => storeOf(td).transactions.createFromRule(ruleId, '2026-10-20'));
    await eventually(() => expect(detail('Деньги на руках')).toBe(fmt(220_000)));
    expect(detail('Платежи и долги до 31 октября')).toBe(`−${fmt(20_000)}`);
    expect(perDay()).toBe(fmt(11_764));
  });

  it('доход по регулярному правилу обрывает горизонт: считаем до дня перед ним', async () => {
    await openPage(async (s) => {
      const i = await baseSetup(s);
      const salary = (await s.db.categories.toArray()).find((c) => c.kind === 'income' && c.name === 'Зарплата');
      await s.recurring.create({ kind: 'income', walletId: i.cash, amountMinor: 100_000, categoryId: salary?.id ?? null, frequency: 'monthly', startOn: '2026-10-20' });
    });
    const c = text(card());
    expect(c).toContain('До 19 октября · 5 дней');
    expect(c).toContain('20 октября ждём доход');
    expect(perDay()).toBe(fmt(50_000)); // 250 000 ÷ 5
  });

  it('денег не хватает: 0 в день и честная сумма нехватки', async () => {
    await openPage(async (s) => {
      await baseSetup(s);
      await s.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 400_000, currency: 'TJS', openedOn: '2026-09-01', dueOn: '2026-10-30' });
    });
    expect(perDay()).toBe(fmt(0));
    expect(text(card())).toContain(`Денег не хватает до 31 октября: нужно ещё ${fmt(150_000)}`);
  });

  it('валюта без курса: кошелёк не входит в расчёт, число помечено «≈», это сказано словами', async () => {
    const td = opsDeps([], {
      setup: async (s) => {
        await baseSetup(s);
        await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 10_000, color: '#2563eb', icon: '💲' });
      },
    });
    await showApp(<BudgetsPage />, td, '/budgets');
    await findByRole('heading', { name: 'Бюджеты', level: 1 });
    await waitFor(() => expect(document.querySelector('[data-testid="forecast-card"]')).not.toBeNull());
    expect(perDay()).toBe(`≈ ${fmt(14_705)}`);
    expect(text(card())).toContain(`Не вошло в расчёт — нет курса: ${fmt(10_000, 'USD')} (в кошельках)`);
  });

  it('накопления в расчёт не входят', async () => {
    await openPage(async (s) => {
      await baseSetup(s);
      await s.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 9_000_000, color: '#2563eb', icon: '🪙' });
    });
    expect(perDay()).toBe(fmt(14_705));
  });

  it('сегодня потрачено больше, чем можно на день — об этом сказано', async () => {
    await openPage(async (s) => {
      const i = await baseSetup(s);
      await s.transactions.create({ kind: 'expense', walletId: i.cash, amountMinor: 120_000, categoryId: i.cats['Покупки'] ?? null, occurredOn: '2026-10-15' });
    });
    expect(text(card())).toContain('Сегодня потрачено больше нормы');
  });

  it('по общему бюджету — вторая цифра «в день»', async () => {
    await openPage(async (s) => {
      await baseSetup(s);
      await s.budgets.create({ categoryId: null, amountMinor: 200_000 });
    });
    // лимит 2 000 − потрачено 500 = 1 500 на 17 дней = 88,23
    expect(detail('По бюджету на месяц')).toBe(`${fmt(8_823)} в день`);
  });
});

describe('экран «Бюджеты»: лимиты и предупреждения', () => {
  const withLimits = async (s: Store) => {
    const i = await baseSetup(s);
    await s.budgets.create({ categoryId: null, amountMinor: 200_000 });
    await s.budgets.create({ categoryId: i.cats['Еда'] ?? null, amountMinor: 50_000 });
    return i;
  };

  it('полоса, «Потрачено N%», остаток и слово уровня; «Без лимита» — отдельной строкой', async () => {
    await openPage(withLimits);
    const food = text(rowButton('Еда'));
    expect(food).toContain('Потрачено 80%');
    expect(food).toContain(`Осталось ${fmt(10_000)}`);
    expect(food).toContain('Внимание: больше 70%');
    expect(text(rowButton('Все расходы'))).toContain('Потрачено 25%');
    expect(text(rowButton('Все расходы'))).not.toContain('Внимание');

    const bars = screen.getAllByRole('progressbar');
    expect(bars.map((b) => b.getAttribute('aria-valuenow'))).toEqual(['25', '80']);
    expect(bars[1]?.getAttribute('aria-label')).toBe('Еда: Потрачено 80%');

    // «Транспорт» не охвачен лимитами по категориям
    const list = document.querySelector('ul.divide-y');
    expect(text(list)).toContain('Без лимита');
    expect(text(list)).toContain(fmt(10_000));
  });

  it('уровни по порогам: 90% — «Почти исчерпан», ровно 100% — «Лимит исчерпан», больше — «Превышен на …»', async () => {
    const td = await openPage(withLimits);
    const i = await ids(storeOf(td));
    const food = i.cats['Еда'] ?? '';
    const spend = (amount: number) => write(() => storeOf(td).transactions.create({ kind: 'expense', walletId: i.cash, amountMinor: amount, categoryId: food, occurredOn: '2026-10-14' }));

    await spend(5_000); // 45 000 из 50 000
    await eventually(() => expect(text(rowButton('Еда'))).toContain('Потрачено 90%'));
    expect(text(rowButton('Еда'))).toContain('Почти исчерпан');

    await spend(5_000); // ровно 50 000
    await eventually(() => expect(text(rowButton('Еда'))).toContain('Потрачено 100%'));
    expect(text(rowButton('Еда'))).toContain('Лимит исчерпан');
    expect(text(rowButton('Еда'))).toContain(`Осталось ${fmt(0)}`);

    await spend(2_500); // превышение на 2 500
    await eventually(() => expect(text(rowButton('Еда'))).toContain('Потрачено 105%'));
    expect(text(rowButton('Еда'))).toContain('Лимит превышен');
    expect(text(rowButton('Еда'))).toContain(`Превышен на ${fmt(2_500)}`);
  });

  it('месяцы листаются: за сентябрь расходов нет — 0%, это настоящий ноль, а не «не посчитано»', async () => {
    await openPage(withLimits);
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(text(document.body)).toContain('Сентябрь 2026'));
    await waitFor(() => expect(text(rowButton('Еда'))).toContain('Потрачено 0%'));
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeTruthy();
  });

  it('основная валюта сменилась: лимиты в прежней валюте без процентов, а траты в сомони — с предупреждением', async () => {
    const td = await openPage(withLimits);
    await write(() => storeOf(td).settings.update({ baseCurrency: 'USD' }));
    await waitFor(() => expect(text(rowButton('Еда'))).toContain('Лимит задан в TJS, а основная валюта сейчас USD'));
    expect(text(rowButton('Еда'))).not.toContain('Потрачено');
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    expect(text(document.body)).toContain('Часть операций не учтена');
  });
});

describe('добавление, правка и архив лимита', () => {
  it('новый общий лимит: шит, сумма на клавиатуре, «Сохранить»; в базе одна запись в основной валюте', async () => {
    const td = await openPage(baseSetup);
    await user.click(screen.getByRole('button', { name: 'Добавить лимит' }));
    await findByRole('dialog', { name: 'Новый лимит' });
    // общий лимит выбран сам (его ещё нет)
    expect((screen.getByRole('combobox', { name: 'На что лимит' }) as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Все расходы');
    await tapAmount('1500');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const rows = await storeOf(td).db.budgets.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ categoryId: null, amountMinor: 150_000, currency: 'TJS', archivedAt: null });
    await eventually(() => expect(text(rowButton('Все расходы'))).toContain('Потрачено 33%'));
  });

  it('лимит на категорию; повторное добавление на ту же категорию меняет сумму и честно говорит об этом', async () => {
    const td = await openPage(baseSetup);
    await user.click(screen.getByRole('button', { name: 'Добавить лимит' }));
    await findByRole('dialog', { name: 'Новый лимит' });
    choose('На что лимит', 'Еда');
    expect(screen.queryByText('Лимит на эту категорию уже есть — изменим сумму.')).toBeNull();
    await tapAmount('500');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await storeOf(td).db.budgets.count()).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Добавить лимит' }));
    await findByRole('dialog', { name: 'Новый лимит' });
    choose('На что лимит', 'Еда');
    expect(screen.getByText('Лимит на эту категорию уже есть — изменим сумму.')).toBeTruthy();
    // сумма подставлена: меняют её, а не вводят с нуля
    expect((screen.getByRole('textbox', { name: /^Сумма лимита/ }) as HTMLInputElement).value).toBe('500');
    for (let n = 0; n < 3; n++) await user.click(screen.getByRole('button', { name: 'Стереть' }));
    await tapAmount('800');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const rows = await storeOf(td).db.budgets.toArray();
    expect(rows).toHaveLength(1); // не два лимита на одну категорию
    expect(rows[0]?.amountMinor).toBe(80_000);
    await eventually(() => expect(text(rowButton('Еда'))).toContain('Потрачено 50%'));
  });

  it('пустая сумма и «ничего не выбрано» не сохраняются, ошибка сказана словами', async () => {
    const td = await openPage(async (s) => {
      await s.budgets.create({ categoryId: null, amountMinor: 100_000 });
    });
    await user.click(screen.getByRole('button', { name: 'Добавить лимит' }));
    await findByRole('dialog', { name: 'Новый лимит' });
    // общий лимит уже есть → ничего не выбрано
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByText('Выберите, на что поставить лимит')).toBeTruthy();
    choose('На что лимит', 'Еда');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByText('Введите сумму лимита больше нуля')).toBeTruthy();
    await tapAmount('0');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByText('Введите сумму лимита больше нуля')).toBeTruthy();
    expect(await storeOf(td).db.budgets.count()).toBe(1);
  });

  it('правка суммы, потом в архив (с «Вернуть» в сообщении), потом возврат из архива', async () => {
    const td = await openPage(async (s) => {
      const i = await ids(s);
      await s.budgets.create({ categoryId: i.cats['Еда'] ?? null, amountMinor: 50_000 });
    });
    await user.click(rowButton('Еда'));
    await findByRole('dialog', { name: 'Лимит: Еда' });
    for (let n = 0; n < 3; n++) await user.click(screen.getByRole('button', { name: 'Стереть' }));
    await tapAmount('1000');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await storeOf(td).db.budgets.toArray())[0]?.amountMinor).toBe(100_000);

    await user.click(rowButton('Еда'));
    await findByRole('dialog', { name: 'Лимит: Еда' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Лимитов пока нет' })).toBeTruthy());
    const archivedToggle = await findByRole('button', { name: /^Архив · 1 лимит/ });
    await user.click(archivedToggle);
    await user.click(screen.getByRole('button', { name: 'Вернуть: Еда' }));
    await waitFor(() => expect(text(rowButton('Еда'))).toContain('Потрачено'));
    expect((await storeOf(td).db.budgets.toArray())[0]?.archivedAt).toBeNull();
  });

  it('лимит в прежней валюте: при правке поле пустое и сказано, в какой валюте вводить', async () => {
    const td = await openPage(async (s) => {
      await s.budgets.create({ categoryId: null, amountMinor: 100_000 });
    });
    await write(() => storeOf(td).settings.update({ baseCurrency: 'USD' }));
    await user.click(await waitFor(() => rowButton('Все расходы')));
    await findByRole('dialog', { name: 'Лимит: Все расходы' });
    expect(screen.getByText(/Раньше лимит был в TJS\. Укажите сумму в USD/)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: /^Сумма лимита/ }) as HTMLInputElement).value).toBe('');
    await tapAmount('50');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await storeOf(td).db.budgets.toArray())[0]).toMatchObject({ amountMinor: 5_000, currency: 'USD' });
  });
});

describe('виджет «Можно тратить в день» на «Главной»', () => {
  it('прогноз и ссылка на экран бюджетов; нет лимитов — зовёт поставить', async () => {
    await openWidget(baseSetup);
    await findByRole('heading', { name: 'Можно тратить в день' });
    await waitFor(() => expect(text(document.querySelector('[data-testid="widget-per-day"]'))).toBe(fmt(14_705)));
    expect(screen.getByRole('link', { name: 'Все бюджеты' }).getAttribute('href')).toBe('/budgets');
    expect(screen.getByRole('link', { name: 'Поставить лимит' })).toBeTruthy();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('пояснительных строк в виджете нет («До … — N дней», «Обычно вы тратите»): они остались на экране бюджетов', async () => {
    await openWidget(baseSetup);
    await waitFor(() => expect(text(document.querySelector('[data-testid="widget-per-day"]'))).toBe(fmt(14_705)));
    const widget = text(document.querySelector('[data-testid="budgets-widget"]'));
    expect(widget).toContain('до 31 октября'); // горизонт — одной короткой подписью в заголовке
    expect(widget).not.toContain('Обычно вы тратите');
    expect(widget).not.toMatch(/\d+ (день|дня|дней)/);
    expect(document.querySelector('[data-testid="widget-usual-per-day"]')).toBeNull();
  });

  it('есть общий лимит: показан он; категории — только если уже не «в пределах»', async () => {
    await openWidget(async (s) => {
      const i = await baseSetup(s);
      await s.budgets.create({ categoryId: null, amountMinor: 200_000 });
      await s.budgets.create({ categoryId: i.cats['Еда'] ?? null, amountMinor: 50_000 }); // 80%
      await s.budgets.create({ categoryId: i.cats['Транспорт'] ?? null, amountMinor: 100_000 }); // 10%
    });
    const list = await waitFor(() => screen.getByRole('list', { name: 'Лимиты на месяц' }));
    const rows = Array.from(list.querySelectorAll('li')).map((li) => text(li));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Все расходы');
    expect(rows[0]).toContain('25%');
    expect(rows[1]).toContain('Еда');
    expect(rows[1]).toContain('80%');
    // слова уровня остались в доступных именах полосок (в строке — только процент и цвет)
    expect(Array.from(list.querySelectorAll('[role="progressbar"]')).map((b) => b.getAttribute('aria-label'))).toEqual(['Все расходы: Потрачено 25%', 'Еда: Потрачено 80%']);
  });

  it('нет общего лимита: самые «горячие» по категориям, не больше двух', async () => {
    await openWidget(async (s) => {
      const i = await baseSetup(s);
      for (const [name, limit] of [['Еда', 50_000], ['Транспорт', 100_000], ['Жильё', 100_000], ['Покупки', 100_000]] as const) {
        await s.budgets.create({ categoryId: i.cats[name] ?? null, amountMinor: limit });
      }
    });
    const list = await waitFor(() => screen.getByRole('list', { name: 'Лимиты на месяц' }));
    const rows = Array.from(list.querySelectorAll('li')).map((li) => text(li));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Еда'); // 80% — самый горячий
    expect(rows[1]).toContain('Транспорт'); // 10%
  });

  it('нет кошельков (все в архиве) — виджет ничего не рисует', async () => {
    await openWidget(async (s) => {
      for (const w of await s.db.wallets.toArray()) await s.wallets.archive(w.id);
    });
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(document.querySelector('[data-testid="budgets-widget"]')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Можно тратить в день' })).toBeNull();
  });

  it('пока данные читаются — серый каркас без цифр (не нули)', async () => {
    const td = opsDeps([table()], {});
    await showApp(<BudgetsWidget />, td, '/');
    // первый кадр после открытия базы: либо каркас, либо уже готовая карточка — но «0%» и нулей в каркасе не бывает
    const busy = document.querySelector('[aria-busy="true"]');
    if (busy) expect(text(busy)).toBe('');
    await findByRole('heading', { name: 'Можно тратить в день' });
  });

  it('открыт без перехода на другой экран: ссылка ведёт на /budgets', async () => {
    const td = opsDeps([table()], { setup: quiet(baseSetup) });
    await showApp(
      <>
        <BudgetsWidget />
        <LocationProbe />
      </>,
      td,
      '/',
    );
    await user.click(await findByRole('link', { name: 'Все бюджеты' }));
    await waitFor(() => expect(currentPath()).toBe('/budgets'));
  });
});

describe('подсказка о темпе «лимит закончится около …»', () => {
  /** baseSetup: «Еда» 400 с. за 15 дней из 31; при лимите 500 с. темп даёт 826,66 к концу месяца, и лимит кончится на ceil(500 × 15 ÷ 400) = 19-й день. */
  const withFoodLimit = (limit: number) => async (s: Store) => {
    const i = await baseSetup(s);
    await s.budgets.create({ categoryId: i.cats['Еда'] ?? null, amountMinor: limit });
  };
  const paceNotes = () => Array.from(document.querySelectorAll('[data-testid="budget-pace"]')).map((n) => text(n));

  it('на странице «Бюджеты»: лимит не дотянет — сказано, когда закончится', async () => {
    await openPage(withFoodLimit(50_000));
    expect(paceNotes()).toEqual(['При таком темпе лимит закончится около 19 октября']);
  });

  it('лимит с запасом — подсказки нет', async () => {
    await openPage(withFoodLimit(1_000_000));
    expect(paceNotes()).toEqual([]);
  });

  it('лимит уже исчерпан — подсказки нет (это видно по уровню «Лимит превышен»)', async () => {
    await openPage(withFoodLimit(30_000));
    expect(paceNotes()).toEqual([]);
    expect(text(rowButton('Еда'))).toContain('Лимит превышен');
  });

  it('в виджете «Главной» подсказки нет', async () => {
    await openWidget(withFoodLimit(50_000));
    await waitFor(() => expect(document.querySelector('[data-testid="budgets-widget"]')).not.toBeNull());
    await waitFor(() => expect(screen.getByRole('list', { name: 'Лимиты на месяц' })).toBeTruthy());
    expect(paceNotes()).toEqual([]);
  });

  it('в прошедшем месяце подсказки нет', async () => {
    await openPage(withFoodLimit(50_000));
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(text(document.body)).toContain('Сентябрь 2026'));
    expect(paceNotes()).toEqual([]);
  });
});

