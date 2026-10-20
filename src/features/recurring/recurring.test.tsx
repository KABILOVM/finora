import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, write } from '@/app/testkit';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import { uuidV5, type RecurringInput, type Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { addDays } from '@/lib/dates';
import { chip, opsDeps, pinToday, setDateInput, showApp, storeOf, table, unpinToday, type OpsDeps } from '@/features/transactions/__fixtures__/opsKit';
import { resetAutoPostState } from '@/recurring/autoPostState';
import RecurringPage from './RecurringPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => {
  pinToday();
  resetAutoPostState();
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const TODAY = '2026-10-15'; // pinToday: четверг 15 октября 2026
const day = (n: number) => addDays(TODAY, n);

interface Ids {
  cash: string;
  card: string;
  usd: string;
  rent: string;
  salary: string;
  food: string;
}

/** Кошельки «Наличные» (TJS), «Карта» (TJS), «Доллары» (USD) + категории из затравки. Платежи создаёт тест. */
async function baseSetup(s: Store): Promise<Omit<Ids, 'rent'>> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  const card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
  const usd = (await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '💲' })).id;
  const cats = await s.db.categories.toArray();
  return {
    cash,
    card,
    usd,
    salary: cats.find((c) => c.name === 'Зарплата')?.id ?? '',
    food: cats.find((c) => c.name === 'Жильё')?.id ?? '',
  };
}

type Make = (s: Store, ids: Omit<Ids, 'rent'>) => Promise<void>;

async function openPage(make: Make = async () => undefined, tables = [table()]): Promise<{ td: OpsDeps; ids: Omit<Ids, 'rent'> }> {
  let ids = {} as Omit<Ids, 'rent'>;
  const td = opsDeps(tables, {
    setup: async (s) => {
      ids = await baseSetup(s);
      await make(s, ids);
    },
  });
  await showApp(<RecurringPage />, td, '/recurring');
  await findByRole('heading', { name: 'Регулярные платежи', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return { td, ids };
}

const rule = (s: Store, over: Partial<RecurringInput> & Pick<RecurringInput, 'walletId' | 'startOn'>) =>
  s.recurring.create({ kind: 'expense', amountMinor: 50_000, frequency: 'monthly', ...over });

const live = async (td: OpsDeps) => (await storeOf(td).db.transactions.toArray()).filter((t) => t.deletedAt === null);
const headings = () => screen.queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('экран «Регулярные платежи»: разделы', () => {
  it('нет ни одного правила — понятное пустое состояние с кнопкой', async () => {
    await openPage();
    expect(screen.getByText('Платежей по расписанию пока нет')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить первый платёж' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить платёж' })).toBeInTheDocument();
    expect(headings()).not.toContain('Просроченные');
  });

  it('«Просроченные» (красным и словами), «Сегодня», «Скоро» и «Все правила»', async () => {
    await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: day(-3), frequency: 'weekly', intervalN: 8, note: 'Старый долг' });
      await rule(s, { walletId: ids.cash, startOn: TODAY, note: 'Аренда', categoryId: ids.food });
      await rule(s, { walletId: ids.cash, startOn: day(10), note: 'Интернет' });
    });
    expect(headings()).toEqual(['Просроченные', 'Сегодня', 'Скоро', 'Все правила']);
    // красным и словами
    const overdue = screen.getByText('Просрочено на 3 дня');
    expect(overdue.className).toContain('text-danger');
    expect(screen.getByRole('heading', { name: 'Просроченные' }).querySelector('span')?.className).toContain('text-danger');
    expect(screen.getByRole('button', { name: /^Провести: Старый долг/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Провести: Аренда, Сегодня/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Провести: Интернет/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Пропустить: Аренда/ })).toBeInTheDocument();
  });

  it('«Все правила»: расписание по-русски, сумма, кошелёк, категория, «Проводится само» / «Ждёт подтверждения»', async () => {
    await openPage(async (s, ids) => {
      // 2026-10-09 — пятница
      await rule(s, { walletId: ids.cash, startOn: '2026-10-09', frequency: 'weekly', intervalN: 2, note: 'Спортзал', amountMinor: 12_000 });
      await rule(s, { walletId: ids.cash, startOn: '2026-10-05', note: 'Аренда', categoryId: ids.food, autoPost: 1 });
      await rule(s, { walletId: ids.cash, startOn: '2026-03-01', frequency: 'yearly', note: 'Налог' });
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('Каждые 2 недели по пятницам');
    expect(text).toContain('Каждый месяц, 5-го');
    expect(text).toContain('Раз в год 1 марта');
    expect(text).toContain('Проводится само');
    expect(text).toContain('Ждёт подтверждения');
    expect(text).toContain('Жильё · Наличные');
    expect(screen.getAllByText('Ждёт подтверждения').length).toBe(2);
  });

  it('на ближайшие 30 дней платежей нет — об этом сказано словами', async () => {
    await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: day(-20), frequency: 'yearly', note: 'Раз в год' });
    });
    // платёж прошёл 20 дней назад и просрочен, поэтому раздел «Просроченные» есть, а «Скоро» нет
    expect(headings()).toEqual(['Просроченные', 'Все правила']);
  });

  it('все платежи проведены — «На ближайшие 30 дней платежей нет»', async () => {
    const { td } = await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: day(-1), frequency: 'yearly', note: 'Раз в год' });
      const r = (await s.db.recurring_rules.toArray())[0];
      if (r) await s.transactions.createFromRule(r.id, day(-1));
    });
    await waitFor(() => expect(screen.getByText(/На ближайшие 30 дней платежей нет/)).toBeInTheDocument());
    expect(await live(td)).toHaveLength(1);
  });

  it('в архиве: свёрнуто, возвращается кнопкой «Вернуть»', async () => {
    const { td } = await openPage(async (s, ids) => {
      const r = await rule(s, { walletId: ids.cash, startOn: day(5), note: 'Старая подписка' });
      await s.recurring.archive(r.id);
    });
    expect(screen.queryByText('Старая подписка')).toBeNull();
    const toggle = screen.getByRole('button', { name: /В архиве · 1 платёж/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Вернуть из архива: Старая подписка' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /В архиве ·/ })).toBeNull());
    expect((await storeOf(td).db.recurring_rules.toArray())[0]?.archivedAt).toBeNull();
    expect(screen.getAllByText('Старая подписка').length).toBeGreaterThan(0);
  });
});

describe('«Провести»', () => {
  it('открывает окно с суммой и заметкой из правила; подтверждение записывает операцию с id от правила и даты', async () => {
    const { td } = await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: TODAY, note: 'Аренда', categoryId: ids.food, amountMinor: 123_450 });
    });
    await user.click(screen.getByRole('button', { name: /^Провести: Аренда/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    expect(dlg).toHaveTextContent('Дата платежа: 15.10.2026 (сегодня)');
    expect((screen.getByRole('textbox', { name: /^Сумма/ }) as HTMLInputElement).value.replace(/\s/g, ' ')).toBe('1 234,5');
    expect((screen.getByRole('textbox', { name: 'Заметка' }) as HTMLInputElement).value).toBe('Аренда');
    await user.click(within(dlg, 'Провести'));
    // уведомление живёт несколько секунд: проверяем его первым
    await waitFor(() => expect(screen.getByText(/Платёж проведён: Аренда/)).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const txs = await live(td);
    expect(txs).toHaveLength(1);
    const r = (await storeOf(td).db.recurring_rules.toArray())[0];
    expect(txs[0]).toMatchObject({ amountMinor: 123_450, note: 'Аренда', occurredOn: TODAY, recurringRuleId: r?.id, id: await uuidV5(r?.id ?? '', TODAY) });
    // платёж ушёл из списка «Сегодня»
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Провести: Аренда/ })).toBeNull());
  });

  it('сумму и заметку можно изменить до подтверждения; правило не меняется', async () => {
    const { td } = await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: TODAY, note: 'Свет', amountMinor: 20_000 });
    });
    await user.click(screen.getByRole('button', { name: /^Провести: Свет/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    const amount = screen.getByRole('textbox', { name: /^Сумма/ });
    await user.clear(amount);
    await user.type(amount, '187,5');
    const note = screen.getByRole('textbox', { name: 'Заметка' });
    await user.clear(note);
    await user.type(note, 'Свет за сентябрь');
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const txs = await live(td);
    expect(txs[0]).toMatchObject({ amountMinor: 18_750, note: 'Свет за сентябрь' });
    const r = (await storeOf(td).db.recurring_rules.toArray())[0];
    expect(r).toMatchObject({ amountMinor: 20_000, note: 'Свет' });
  });

  it('пустая сумма — подсказка у поля, ничего не записано', async () => {
    const { td } = await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: TODAY, note: 'Свет' });
    });
    await user.click(screen.getByRole('button', { name: /^Провести: Свет/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    await user.clear(screen.getByRole('textbox', { name: /^Сумма/ }));
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.getByText('Введите сумму')).toBeInTheDocument());
    expect(await live(td)).toHaveLength(0);
  });

  it('двойное нажатие «Провести»: кнопка блокируется, операция одна', async () => {
    const { td } = await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: TODAY, note: 'Свет' });
    });
    await user.click(screen.getByRole('button', { name: /^Провести: Свет/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    const button = within(dlg, 'Провести');
    // три нажатия подряд без ожидания
    act(() => {
      button.click();
      button.click();
      button.click();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await storeOf(td).db.transactions.count()).toBe(1);
  });

  it('если платёж за эту дату уже пропустили на другом устройстве, об этом сказано, а не «проведено»', async () => {
    const { td } = await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: TODAY, note: 'Свет' });
    });
    await user.click(screen.getByRole('button', { name: /^Провести: Свет/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    const r = (await storeOf(td).db.recurring_rules.toArray())[0];
    await write(() => storeOf(td).transactions.skipOccurrence(r?.id ?? '', TODAY));
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.getByText(/уже пропущен или удалён/)).toBeInTheDocument());
    expect(await live(td)).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Провести платёж' })).toBeInTheDocument();
  });

  it('кошелёк платежа в архиве — понятная ошибка от репозитория в окне, данные не изменены', async () => {
    const { td } = await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.card, startOn: TODAY, note: 'Свет' });
      await s.wallets.archive(ids.card);
    });
    await user.click(screen.getByRole('button', { name: /^Провести: Свет/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Кошелёк «Карта» в архиве/));
    expect(await storeOf(td).db.transactions.count()).toBe(0);
  });
});

describe('«Провести» при небазовой валюте кошелька', () => {
  it('курс найден: показан в окне, операция записана со снимком', async () => {
    const { td } = await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.usd, startOn: TODAY, note: 'Подписка', amountMinor: 1_000 });
    });
    await user.click(screen.getByRole('button', { name: /^Провести: Подписка/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    expect(dlg).toHaveTextContent(/Курс: 1 \$ = 10,9/);
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await live(td))[0]).toMatchObject({ amountMinor: 1_000, fxRate: 10.9, fxSource: 'nbt', baseAmountMinor: 10_900 });
  });

  it('курса нет совсем — поле «Курс»; без него не провести и не молчим; с ним — «manual»', async () => {
    const { td } = await openPage(
      async (s, ids) => {
        await rule(s, { walletId: ids.usd, startOn: TODAY, note: 'Подписка', amountMinor: 1_000 });
      },
      [],
    );
    await user.click(screen.getByRole('button', { name: /^Провести: Подписка/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    expect(dlg).toHaveTextContent('Курса $ → с. пока нет');
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.getByText(/Курса пока нет — введите его/)).toBeInTheDocument());
    expect(await storeOf(td).db.transactions.count()).toBe(0);

    await user.type(screen.getByRole('textbox', { name: /^Курс:/ }), '11');
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await live(td))[0]).toMatchObject({ fxRate: 11, fxSource: 'manual', baseAmountMinor: 11_000 });
  });
});

describe('«Провести» перевода', () => {
  it('между валютами: «Получено» предложено по курсу и идёт за суммой; записывается пара «списано / получено»', async () => {
    const { td } = await openPage(async (s, ids) => {
      await s.recurring.create({ kind: 'transfer', walletId: ids.cash, toWalletId: ids.usd, amountMinor: 109_000, toAmountMinor: 10_000, frequency: 'monthly', startOn: TODAY, note: 'Обмен' });
    });
    await user.click(screen.getByRole('button', { name: /^Провести: Обмен/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    const num = (el: HTMLElement) => (el as HTMLInputElement).value.replace(/\s/g, '');
    expect(num(screen.getByRole('textbox', { name: /^Сумма списания/ }))).toBe('1090');
    expect(num(screen.getByRole('textbox', { name: /^Получено/ }))).toBe('100');
    const amount = screen.getByRole('textbox', { name: /^Сумма списания/ });
    await user.clear(amount);
    await user.type(amount, '2180');
    await waitFor(() => expect(num(screen.getByRole('textbox', { name: /^Получено/ }))).toBe('200'));
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await live(td))[0]).toMatchObject({ kind: 'transfer', amountMinor: 218_000, toAmountMinor: 20_000, baseAmountMinor: 0 });
  });

  it('в одной валюте с комиссией: без правок записывается ровно как в правиле (списано 10, получено 9,90)', async () => {
    const { td } = await openPage(async (s, ids) => {
      await s.recurring.create({ kind: 'transfer', walletId: ids.cash, toWalletId: ids.card, amountMinor: 1_000, toAmountMinor: 990, frequency: 'monthly', startOn: TODAY, note: 'Копилка' });
    });
    await user.click(screen.getByRole('button', { name: /^Провести: Копилка/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    expect(dlg).toHaveTextContent('Комиссия: 0,10 с.');
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await live(td))[0]).toMatchObject({ amountMinor: 1_000, toAmountMinor: 990, baseAmountMinor: 10 });
  });

  it('между валютами без курса: «Получено» вводится руками, пока его нет — не провести', async () => {
    const { td } = await openPage(
      async (s, ids) => {
        await s.recurring.create({ kind: 'transfer', walletId: ids.cash, toWalletId: ids.usd, amountMinor: 109_000, toAmountMinor: 10_000, frequency: 'monthly', startOn: TODAY, note: 'Обмен' });
      },
      [],
    );
    await user.click(screen.getByRole('button', { name: /^Провести: Обмен/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    const amount = screen.getByRole('textbox', { name: /^Сумма списания/ });
    await user.clear(amount);
    await user.type(amount, '2180');
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.getByText(/Курса нет — введите, сколько денег пришло/)).toBeInTheDocument());
    expect(await live(td)).toHaveLength(0);
    await user.type(screen.getByRole('textbox', { name: /^Получено/ }), '200');
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await live(td))[0]).toMatchObject({ amountMinor: 218_000, toAmountMinor: 20_000 });
  });
});

describe('«Пропустить»', () => {
  it('с подтверждением: операции нет, платёж не возвращается в «Предстоящие», раздел «Пропущенные» его хранит', async () => {
    const { td } = await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: TODAY, note: 'Аренда' });
    });
    await user.click(screen.getByRole('button', { name: /^Пропустить: Аренда/ }));
    const confirm = await findByRole('alertdialog', { name: 'Пропустить платёж?' });
    expect(confirm).toHaveTextContent('Пропущенные');
    // «Отмена» ничего не делает
    await user.click(within(confirm, 'Отмена'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(await storeOf(td).db.transactions.count()).toBe(0);

    await user.click(screen.getByRole('button', { name: /^Пропустить: Аренда/ }));
    const again = await findByRole('alertdialog', { name: 'Пропустить платёж?' });
    await user.click(within(again, 'Пропустить'));
    await waitFor(() => expect(screen.getByText(/Платёж пропущен: Аренда/)).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    expect(await live(td)).toHaveLength(0);
    expect(await storeOf(td).db.transactions.count()).toBe(1); // пропуск = удалённая строка с тем же id
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Провести: Аренда/ })).toBeNull());
    expect(headings()).toContain('Все правила');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Пропущенные · 1' })).toBeInTheDocument());
  });

  it('тост «Вернуть» оживляет ту же операцию: платёж записан в операции', async () => {
    const { td } = await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: TODAY, note: 'Аренда', amountMinor: 30_000 });
    });
    await user.click(screen.getByRole('button', { name: /^Пропустить: Аренда/ }));
    const confirm = await findByRole('alertdialog');
    await user.click(within(confirm, 'Пропустить'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    const skippedId = (await storeOf(td).db.transactions.toArray())[0]?.id;

    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Вернуть' })));
    await eventually(async () => expect(await live(td)).toHaveLength(1));
    const txs = await live(td);
    expect(txs[0]).toMatchObject({ id: skippedId, amountMinor: 30_000, occurredOn: TODAY });
    expect(await storeOf(td).db.transactions.count()).toBe(1);
  });

  it('раздел «Пропущенные»: «Вернуть» записывает платёж; подпись различает пропуск и удаление после проведения', async () => {
    const { td } = await openPage(async (s, ids) => {
      const r = await rule(s, { walletId: ids.cash, startOn: day(-2), frequency: 'daily', note: 'Кофе', amountMinor: 1_500 });
      await s.transactions.skipOccurrence(r.id, day(-2));
      const posted = await s.transactions.createFromRule(r.id, day(-1));
      await s.transactions.softDelete(posted.id);
    });
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Пропущенные · 2' })));
    expect(screen.getByText(/Пропущен · /)).toBeInTheDocument();
    expect(screen.getByText(/Удалён из операций · Вчера/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Вернуть платёж: Кофе, Вчера' }));
    await eventually(async () => expect(await live(td)).toHaveLength(1));
    expect((await live(td))[0]?.occurredOn).toBe(day(-1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Пропущенные · 1' })).toBeInTheDocument());
  });

  it('кошелёк в чужой валюте и курса нет — для пропуска тоже просим курс (как для обычной операции)', async () => {
    const { td } = await openPage(
      async (s, ids) => {
        await rule(s, { walletId: ids.usd, startOn: TODAY, note: 'Подписка', amountMinor: 1_000 });
      },
      [],
    );
    await user.click(screen.getByRole('button', { name: /^Пропустить: Подписка/ }));
    const confirm = await findByRole('alertdialog');
    await user.click(within(confirm, 'Пропустить'));
    await waitFor(() => expect(screen.getByText(/Курса пока нет — введите его/)).toBeInTheDocument());
    expect(await storeOf(td).db.transactions.count()).toBe(0);
    await user.type(screen.getByRole('textbox', { name: /^Курс:/ }), '11');
    await user.click(within(confirm, 'Пропустить'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(await storeOf(td).db.transactions.count()).toBe(1);
    expect(await live(td)).toHaveLength(0);
  });
});

/** Кнопка внутри окна по названию (в окне «Провести» есть и заголовок, и кнопка с этим словом). */
function within(root: HTMLElement, name: string): HTMLElement {
  const hit = Array.from(root.querySelectorAll<HTMLElement>('button')).find((b) => (b.textContent ?? '').trim() === name);
  if (!hit) throw new Error(`В окне нет кнопки «${name}»`);
  return hit;
}

describe('«Провести» просроченный платёж: дата оплаты', () => {
  const overdueRule = (s: Store, ids: { cash: string }) =>
    rule(s, { walletId: ids.cash, startOn: day(-3), frequency: 'weekly', intervalN: 8, note: 'Старый долг', amountMinor: 20_000 });
  const openPosting = async () => {
    await user.click(screen.getByRole('button', { name: /^Провести: Старый долг/ }));
    return findByRole('dialog', { name: 'Провести платёж' });
  };

  it('по умолчанию платёж записывается на сегодня (когда оплатили), а id остаётся от даты по расписанию', async () => {
    const { td } = await openPage(async (s, ids) => void (await overdueRule(s, ids)));
    const dlg = await openPosting();
    expect(dlg).toHaveTextContent(`Дата платежа: 12.10.2026`); // по расписанию
    expect(chip('Дата оплаты', 'Сегодня').getAttribute('aria-pressed')).toBe('true');
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.getByText(/Платёж проведён: Старый долг/)).toBeInTheDocument());
    const [tx] = await live(td);
    const r = (await storeOf(td).db.recurring_rules.toArray())[0];
    expect(tx).toMatchObject({ occurredOn: TODAY, recurringRuleId: r?.id, id: await uuidV5(r?.id ?? '', day(-3)) });
    // этот платёж больше не просрочен и не предлагается заново
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Провести: Старый долг/ })).toBeNull());
  });

  it('«Вчера» — операция на вчера', async () => {
    const { td } = await openPage(async (s, ids) => void (await overdueRule(s, ids)));
    const dlg = await openPosting();
    await user.click(chip('Дата оплаты', 'Вчера'));
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await live(td))[0]?.occurredOn).toBe(day(-1));
  });

  it('платёж по долгу нельзя записать раньше даты долга; пустую дату оплаты окно не пропускает', async () => {
    const { td } = await openPage(async (s, ids) => {
      const debt = await s.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 500_000, currency: 'TJS', openedOn: day(-10) });
      await rule(s, { walletId: ids.cash, startOn: day(-3), frequency: 'weekly', intervalN: 8, note: 'Платёж банку', amountMinor: 25_000, debtId: debt.id });
    });
    await user.click(screen.getByRole('button', { name: /^Провести: Платёж банку/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    await user.click(chip('Дата оплаты', 'Другая дата'));
    const input = dlg.querySelector('input[type="date"]') as HTMLInputElement;
    setDateInput(input, day(-20));
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(dlg).toHaveTextContent('Платёж не может быть раньше даты долга'));
    setDateInput(input, '');
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(dlg).toHaveTextContent('Укажите дату оплаты'));
    expect(await live(td)).toHaveLength(0);
    // правильная дата — платёж проходит
    setDateInput(input, day(-2));
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await live(td))[0]?.occurredOn).toBe(day(-2));
  });

  it('платёж в срок или впереди: поля «Дата оплаты» нет, операция на дату по расписанию', async () => {
    const { td } = await openPage(async (s, ids) => void (await rule(s, { walletId: ids.cash, startOn: day(2), note: 'Интернет' })));
    await user.click(screen.getByRole('button', { name: /^Провести: Интернет/ }));
    const dlg = await findByRole('dialog', { name: 'Провести платёж' });
    expect(screen.queryByRole('group', { name: 'Дата оплаты' })).toBeNull();
    await user.click(within(dlg, 'Провести'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await live(td))[0]?.occurredOn).toBe(day(2));
  });
});

describe('экран «Регулярные платежи»: сводка «в месяц» и порядок блоков', () => {
  const fmtMoney = (minor: number, currency = 'TJS') => (formatMinor(minor, currency) ?? '').replace(/[\s  ]+/g, ' ').trim();
  const summary = () => document.querySelector<HTMLElement>('[data-testid="recurring-monthly"]');
  const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();

  it('платежи и поступления в месяц по валютам; недельный пересчитан, перевод, архив и закончившийся не входят', async () => {
    await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: day(10), note: 'Аренда', amountMinor: 50_000 });
      await rule(s, { walletId: ids.cash, startOn: day(10), note: 'Спортзал', amountMinor: 12_000, frequency: 'weekly', intervalN: 2 }); // 12 000 × 52 / 24 = 26 000
      await rule(s, { walletId: ids.cash, startOn: day(10), note: 'Зарплата', kind: 'income', categoryId: ids.salary, amountMinor: 200_000 });
      await rule(s, { walletId: ids.usd, startOn: day(10), note: 'Облако', amountMinor: 1_000 });
      await rule(s, { walletId: ids.cash, toWalletId: ids.card, startOn: day(10), note: 'Перевод', kind: 'transfer', amountMinor: 99_999 });
      const old = await rule(s, { walletId: ids.cash, startOn: day(10), note: 'Старый', amountMinor: 11_111 });
      await s.recurring.archive(old.id);
      await rule(s, { walletId: ids.cash, startOn: day(-60), endOn: day(-30), note: 'Закончился', amountMinor: 22_222 });
    });
    const text = norm(summary()?.textContent);
    expect(text).toContain(fmtMoney(76_000)); // 500 + 260
    expect(text).toContain(fmtMoney(200_000));
    expect(text).toContain(fmtMoney(1_000, 'USD'));
    for (const absent of [99_999, 11_111, 22_222]) expect(text).not.toContain(fmtMoney(absent));
    // базовая валюта первой
    expect(text.indexOf(fmtMoney(76_000))).toBeLessThan(text.indexOf(fmtMoney(1_000, 'USD')));
  });

  it('план по закрытому долгу остановлен — в «В месяц» его нет', async () => {
    await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: day(10), note: 'Аренда', amountMinor: 10_000 });
      const debt = await s.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 500_000, currency: 'TJS', openedOn: '2026-10-01' });
      await rule(s, { walletId: ids.cash, startOn: day(10), note: 'Платёж банку', amountMinor: 25_000, debtId: debt.id });
      await s.debts.close(debt.id);
    });
    await waitFor(() => expect(summary()).not.toBeNull());
    const text = norm(summary()?.textContent);
    expect(text).toContain(fmtMoney(10_000));
    expect(text).not.toContain(fmtMoney(35_000));
  });

  it('нет платежей, которые можно посчитать, — карточки нет', async () => {
    await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, toWalletId: ids.card, startOn: day(10), kind: 'transfer', amountMinor: 1_000 });
    });
    expect(summary()).toBeNull();
  });

  it('порядок: сводка → Просроченные → Сегодня → Скоро → «Похоже на подписки» → Все правила', async () => {
    await openPage(async (s, ids) => {
      await rule(s, { walletId: ids.cash, startOn: day(-3), frequency: 'weekly', intervalN: 8, note: 'Старый долг' });
      await rule(s, { walletId: ids.cash, startOn: TODAY, note: 'Аренда' });
      await rule(s, { walletId: ids.cash, startOn: day(10), note: 'Интернет' });
      for (const d of ['2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03']) {
        await s.transactions.create({ kind: 'expense', walletId: ids.cash, amountMinor: 4_900, occurredOn: d, note: 'Netflix' });
      }
    });
    await waitFor(() => expect(document.querySelector('[data-testid="subscriptions-card"]')).not.toBeNull());
    const el = (sel: string) => document.querySelector(sel) as HTMLElement;
    const before = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const h = (name: string) => screen.getByRole('heading', { name: new RegExp(`^${name}`) });
    expect(before(summary()!, h('Просроченные'))).toBe(true);
    expect(before(h('Просроченные'), h('Сегодня'))).toBe(true);
    expect(before(h('Сегодня'), h('Скоро'))).toBe(true);
    expect(before(h('Скоро'), el('[data-testid="subscriptions-card"]'))).toBe(true);
    expect(before(el('[data-testid="subscriptions-card"]'), h('Все правила'))).toBe(true);
  });
});
