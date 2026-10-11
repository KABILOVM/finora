import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { write } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { ValidationError, type RecurringInput, type Store } from '@/db';
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

const TODAY = '2026-10-15';

interface Ids {
  cash: string;
  card: string;
  usd: string;
}

async function openPage(make: (s: Store, ids: Ids) => Promise<void> = async () => undefined): Promise<OpsDeps> {
  const td = opsDeps([table()], {
    setup: async (s) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
      const card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
      const usd = (await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '💲' })).id;
      await make(s, { cash, card, usd });
    },
  });
  await showApp(<RecurringPage />, td, '/recurring');
  await findByRole('heading', { name: 'Регулярные платежи', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const rules = async (td: OpsDeps) => storeOf(td).db.recurring_rules.toArray();
const startInput = () => document.querySelector<HTMLInputElement>('#rule-start') as HTMLInputElement;
const endInput = () => document.querySelector<HTMLInputElement>('#rule-end');
const preview = () => document.querySelector('[data-testid="rule-preview"]')?.textContent ?? '';
const save = () => user.click(screen.getByRole('button', { name: 'Сохранить' }));
const mk = (s: Store, over: Partial<RecurringInput> & Pick<RecurringInput, 'walletId'>) =>
  s.recurring.create({ kind: 'expense', amountMinor: 50_000, frequency: 'monthly', startOn: TODAY, ...over });

async function openNew() {
  await user.click(screen.getByRole('button', { name: 'Добавить платёж' }));
  return findByRole('dialog', { name: 'Новый регулярный платёж' });
}

describe('новый регулярный платёж', () => {
  it('создаётся с суммой, категорией, заметкой, расписанием и «Проводить само»', async () => {
    const td = await openPage();
    await openNew();
    await user.type(screen.getByRole('textbox', { name: /^Сумма/ }), '500');
    await user.click(chip('Категория', 'Жильё'));
    await user.type(screen.getByRole('textbox', { name: 'Название или заметка' }), 'Аренда');
    await user.click(screen.getByRole('switch', { name: 'Проводить само' }));
    expect(screen.getByRole('switch', { name: 'Проводить само' })).toHaveAttribute('aria-checked', 'true');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const [r] = await rules(td);
    expect(r).toMatchObject({
      kind: 'expense',
      amountMinor: 50_000,
      note: 'Аренда',
      frequency: 'monthly',
      intervalN: 1,
      startOn: TODAY,
      endOn: null,
      autoPost: 1,
      toWalletId: null,
      debtId: null,
      archivedAt: null,
    });
    const cash = (await storeOf(td).db.wallets.toArray()).find((w) => w.name === 'Наличные');
    expect(r?.walletId).toBe(cash?.id);
    expect(screen.getByText('Платёж добавлен')).toBeInTheDocument();
  });

  it('без суммы не сохраняется: подсказка у поля, ничего не создано', async () => {
    const td = await openPage();
    await openNew();
    await save();
    await waitFor(() => expect(screen.getByText('Введите сумму')).toBeInTheDocument());
    expect(await rules(td)).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Новый регулярный платёж' })).toBeInTheDocument();
  });

  it('живой предпросмотр: «Ближайшие даты» меняются вместе с расписанием', async () => {
    await openPage();
    await openNew();
    expect(preview()).toBe('Ближайшие даты: Сегодня; вс, 15 ноя; вт, 15 дек; пт, 15 янв 2027');
    await user.click(chip('Периодичность', 'Неделя'));
    expect(preview()).toBe('Ближайшие даты: Сегодня; чт, 22 окт; чт, 29 окт; чт, 5 ноя');
    await user.click(chip('Периодичность', 'День'));
    expect(preview()).toBe('Ближайшие даты: Сегодня; Завтра; сб, 17 окт; вс, 18 окт');
    // «каждые 2 дня»
    const interval = screen.getByRole('textbox', { name: 'Каждые сколько дней' });
    await user.clear(interval);
    await user.type(interval, '2');
    expect(preview()).toBe('Ближайшие даты: Сегодня; сб, 17 окт; пн, 19 окт; ср, 21 окт');
    expect(screen.getByText('Получится: Каждые 2 дня')).toBeInTheDocument();
  });

  it('месячный платёж на 29–31 число: подсказка про последний день месяца; на 28-е — нет', async () => {
    await openPage();
    await openNew();
    setDateInput(startInput(), '2026-01-31');
    await waitFor(() => expect(screen.getByText('В коротких месяцах платёж будет в последний день месяца')).toBeInTheDocument());
    setDateInput(startInput(), '2026-01-28');
    await waitFor(() => expect(screen.queryByText('В коротких месяцах платёж будет в последний день месяца')).toBeNull());
    setDateInput(startInput(), '2026-01-29');
    await waitFor(() => expect(screen.getByText('В коротких месяцах платёж будет в последний день месяца')).toBeInTheDocument());
  });

  it('«каждые N»: ноль и пустое — подсказка у поля; буквы в поле не попадают', async () => {
    const td = await openPage();
    await openNew();
    await user.type(screen.getByRole('textbox', { name: /^Сумма/ }), '10');
    const interval = screen.getByRole('textbox', { name: 'Каждые сколько месяцев' });
    await user.clear(interval);
    await user.type(interval, '0');
    await save();
    await waitFor(() => expect(screen.getByText('Введите целое число от 1 до 1000')).toBeInTheDocument());
    await user.clear(interval);
    await user.type(interval, 'a3б');
    expect((interval as HTMLInputElement).value).toBe('3');
    expect(await rules(td)).toHaveLength(0);
  });

  it('дата окончания раньше начала — подсказка; позже — сохраняется', async () => {
    const td = await openPage();
    await openNew();
    await user.type(screen.getByRole('textbox', { name: /^Сумма/ }), '10');
    await user.click(screen.getByRole('switch', { name: 'Закончить в определённую дату' }));
    const end = endInput();
    expect(end).not.toBeNull();
    setDateInput(end as HTMLInputElement, addDays(TODAY, -1));
    await save();
    await waitFor(() => expect(screen.getByText('Дата окончания не может быть раньше первого платежа')).toBeInTheDocument());
    setDateInput(endInput() as HTMLInputElement, '2027-03-01');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await rules(td))[0]?.endOn).toBe('2027-03-01');
  });

  it('«Проводить само» с датой начала в прошлом — предупреждение, что старые платежи сами не проводятся', async () => {
    await openPage();
    await openNew();
    setDateInput(startInput(), '2026-10-01');
    expect(screen.queryByText(/сами не проводятся/)).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Проводить само' }));
    await waitFor(() => expect(screen.getByText(/Платежи за прошлые даты сами не проводятся/)).toBeInTheDocument());
  });

  it('двойное нажатие «Сохранить» создаёт одно правило', async () => {
    const td = await openPage();
    await openNew();
    await user.type(screen.getByRole('textbox', { name: /^Сумма/ }), '10');
    const button = screen.getByRole('button', { name: 'Сохранить' });
    button.click();
    button.click();
    button.click();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await rules(td)).toHaveLength(1);
  });
});

describe('перевод и платёж по долгу', () => {
  it('перевод в другую валюту: без суммы зачисления не сохранится; с ней — сохраняется', async () => {
    const td = await openPage();
    await openNew();
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    await user.click(chip('Куда', 'Доллары · USD'));
    await user.type(screen.getByRole('textbox', { name: /^Сумма списания/ }), '1090');
    // курс есть (10,9), поэтому «Получено» предложено само: 1090 / 10,9 = 100 $
    await waitFor(() => expect((screen.getByRole('textbox', { name: /^Получено/ }) as HTMLInputElement).value.replace(/\s/g, '')).toBe('100'));
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await rules(td))[0]).toMatchObject({ kind: 'transfer', amountMinor: 109_000, toAmountMinor: 10_000, categoryId: null, debtId: null });
  });

  it('перевод: «Откуда» и «Куда» не могут совпасть', async () => {
    await openPage();
    await openNew();
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    const to = screen.getByRole('group', { name: 'Куда' });
    expect(to.textContent).not.toContain('Наличные'); // «Куда» не предлагает кошелёк «Откуда»
  });

  it('платёж по долгу: выбор из открытых долгов; чужая валюта — подсказка до сохранения', async () => {
    const td = await openPage(async (s) => {
      await s.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-09-01' });
      await s.debts.create({ direction: 'lent', counterparty: 'Иван', principalMinor: 5_000, currency: 'USD', openedOn: '2026-09-01' });
      const closed = await s.debts.create({ direction: 'borrowed', counterparty: 'Закрытый', principalMinor: 1_000, currency: 'TJS', openedOn: '2026-09-01' });
      await s.db.debts.update(closed.id, { closedAt: '2026-09-30T00:00:00.000Z' });
    });
    await openNew();
    const group = screen.getByRole('group', { name: 'Платёж по долгу' });
    expect(group.textContent).toContain('Банк · TJS');
    expect(group.textContent).toContain('Иван · USD');
    expect(group.textContent).not.toContain('Закрытый');
    await user.type(screen.getByRole('textbox', { name: /^Сумма/ }), '100');
    await user.click(chip('Платёж по долгу', 'Иван · USD'));
    await save();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Валюта кошелька «Наличные» \(TJS\) не совпадает с валютой долга «Иван» \(USD\)/));
    expect(await rules(td)).toHaveLength(0);
    await user.click(chip('Платёж по долгу', 'Банк · TJS'));
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const debts = await storeOf(td).db.debts.toArray();
    expect((await rules(td))[0]?.debtId).toBe(debts.find((d) => d.counterparty === 'Банк')?.id);
  });

  it('ошибка репозитория показывается у своего поля и не теряет введённое', async () => {
    const td = await openPage();
    await openNew();
    vi.spyOn(storeOf(td).recurring, 'create').mockRejectedValue(new ValidationError('Категория «Жильё» удалена'));
    await user.type(screen.getByRole('textbox', { name: /^Сумма/ }), '10');
    await save();
    await waitFor(() => expect(screen.getByText('Категория «Жильё» удалена')).toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Новый регулярный платёж' })).toBeInTheDocument();
    expect((screen.getByRole('textbox', { name: /^Сумма/ }) as HTMLInputElement).value).toBe('10');
  });
});

describe('правка и архив', () => {
  it('касание правила открывает правку; меняется только изменённое', async () => {
    const td = await openPage(async (s, ids) => {
      await mk(s, { walletId: ids.cash, note: 'Аренда', amountMinor: 50_000 });
    });
    await user.click(screen.getByRole('button', { name: /^Аренда/ }));
    await findByRole('dialog', { name: 'Правка платежа' });
    expect((screen.getByRole('textbox', { name: /^Сумма/ }) as HTMLInputElement).value).toBe('500');
    const before = (await rules(td))[0];
    const amount = screen.getByRole('textbox', { name: /^Сумма/ });
    await user.clear(amount);
    await user.type(amount, '650,5');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const after = (await rules(td))[0];
    expect(after).toMatchObject({ amountMinor: 65_050, note: 'Аренда', frequency: 'monthly', startOn: TODAY });
    expect(after?.createdAt).toBe(before?.createdAt);
  });

  it('сохранение без изменений ничего не пишет', async () => {
    const td = await openPage(async (s, ids) => {
      await mk(s, { walletId: ids.cash, note: 'Аренда' });
    });
    const before = (await rules(td))[0];
    await user.click(screen.getByRole('button', { name: /^Аренда/ }));
    await findByRole('dialog', { name: 'Правка платежа' });
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await rules(td))[0]).toEqual(before);
  });

  it('«Убрать в архив» — с подтверждением; платёж пропадает из списка и «Предстоящих», тост даёт «Вернуть»', async () => {
    const td = await openPage(async (s, ids) => {
      await mk(s, { walletId: ids.cash, note: 'Аренда' });
    });
    await user.click(screen.getByRole('button', { name: /^Аренда/ }));
    await findByRole('dialog', { name: 'Правка платежа' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    const confirm = await findByRole('alertdialog', { name: 'Убрать платёж в архив?' });
    expect(confirm).toHaveTextContent('Уже записанные операции останутся');
    await user.click(screen.getByRole('button', { name: 'В архив' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await rules(td))[0]?.archivedAt).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Провести: Аренда/ })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Вернуть' }));
    await waitFor(async () => expect((await rules(td))[0]?.archivedAt).toBeNull());
  });

  it('вид платежа можно сменить: расход → перевод; категория и долг исчезают, зачисление = списанию', async () => {
    const td = await openPage(async (s, ids) => {
      const cat = (await s.db.categories.toArray()).find((c) => c.name === 'Жильё');
      await mk(s, { walletId: ids.cash, note: 'Аренда', categoryId: cat?.id ?? null });
    });
    await user.click(screen.getByRole('button', { name: /^Аренда/ }));
    await findByRole('dialog', { name: 'Правка платежа' });
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    await user.click(chip('Куда', 'Карта · TJS'));
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [r] = await rules(td);
    const card = (await storeOf(td).db.wallets.toArray()).find((w) => w.name === 'Карта');
    expect(r).toMatchObject({ kind: 'transfer', toWalletId: card?.id, toAmountMinor: 50_000, amountMinor: 50_000, categoryId: null, debtId: null });
  });

  it('кошелёк правила отправили в архив: правка открывается, кошелёк остаётся выбранным и объяснён', async () => {
    await openPage(async (s, ids) => {
      await mk(s, { walletId: ids.card, note: 'Аренда' });
      await s.wallets.archive(ids.card);
    });
    await user.click(screen.getByRole('button', { name: /^Аренда/ }));
    await findByRole('dialog', { name: 'Правка платежа' });
    expect(chip('Кошелёк', 'Карта · TJS').getAttribute('aria-pressed')).toBe('true');
  });

  it('правка с другого устройства не откатывается: в базу уходят только поля, которые менял человек', async () => {
    const td = await openPage(async (s, ids) => {
      await mk(s, { walletId: ids.cash, note: 'Аренда', amountMinor: 50_000 });
    });
    await user.click(screen.getByRole('button', { name: /^Аренда/ }));
    await findByRole('dialog', { name: 'Правка платежа' });
    const s = storeOf(td);
    const r = (await rules(td))[0];
    // «другое устройство» поменяло заметку, пока окно было открыто
    await write(() => s.recurring.update(r?.id ?? '', { note: 'Аренда квартиры' }));
    const amount = screen.getByRole('textbox', { name: /^Сумма/ });
    await user.clear(amount);
    await user.type(amount, '700');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await rules(td))[0]).toMatchObject({ amountMinor: 70_000, note: 'Аренда квартиры' });
  });
});
