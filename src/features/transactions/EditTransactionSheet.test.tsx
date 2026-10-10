import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventually, write } from '@/app/testkit';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { addDays, todayLocal } from '@/lib/dates';
import {
  allTxs,
  balancesOf,
  chip,
  chipLabels,
  contextChip,
  dateInput,
  fxNotice,
  opsDeps,
  pickDate,
  pickWallet,
  setDateInput,
  showApp,
  storeOf,
  table,
  tapAmount,
  type OpsDeps,
} from './__fixtures__/opsKit';
import EditTransactionSheet from './EditTransactionSheet';

afterEach(() => vi.restoreAllMocks());

interface Ids {
  tx: string;
  cash: string;
  usd: string;
  card: string;
  food: string;
  transport: string;
}

/** Кошельки «Наличные» (из затравки), «Карта» (TJS), «Доллары» (USD). Возвращает их номера. */
async function baseSetup(s: Store, ids: Ids): Promise<void> {
  const wallets = await s.db.wallets.toArray();
  ids.cash = wallets.find((w) => w.name === 'Наличные')?.id ?? '';
  ids.card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
  ids.usd = (await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 100_000, color: '#2563eb', icon: '💲' })).id;
  const cats = await s.db.categories.toArray();
  ids.food = cats.find((c) => c.name === 'Еда' && c.kind === 'expense')?.id ?? '';
  ids.transport = cats.find((c) => c.name === 'Транспорт' && c.kind === 'expense')?.id ?? '';
}

type Maker = (s: Store, ids: Ids) => Promise<string>;

/** Открывает шит правки для операции, созданной функцией make. */
async function openEdit(make: Maker, tables = [table()], extra?: (td: OpsDeps) => void) {
  const ids: Ids = { tx: '', cash: '', usd: '', card: '', food: '', transport: '' };
  const td = opsDeps(tables, {
    setup: async (s) => {
      await baseSetup(s, ids);
      ids.tx = await make(s, ids);
    },
  });
  extra?.(td);
  const onClose = vi.fn();
  function Edit() {
    return <EditTransactionSheet id={ids.tx} onClose={onClose} />;
  }
  await showApp(<Edit />, td, '/edit/x');
  await findByRole('dialog', { name: 'Правка операции' });
  return { td, ids, onClose };
}

const food12 =
  (over: Record<string, unknown> = {}): Maker =>
  async (s, ids) =>
    (
      await s.transactions.create({
        kind: 'expense',
        walletId: ids.cash,
        amountMinor: 1250,
        categoryId: ids.food,
        occurredOn: addDays(todayLocal(), -1),
        note: 'обед',
        ...over,
      })
    ).id;

const usdExpense: Maker = async (s, ids) =>
  (
    await s.transactions.create({
      kind: 'expense',
      walletId: ids.usd,
      amountMinor: 1000,
      categoryId: ids.food,
      occurredOn: todayLocal(),
      fx: { rate: 10.9, source: 'nbt' },
    })
  ).id;

const save = () => user.click(screen.getByRole('button', { name: 'Сохранить' }));
const amountField = () => screen.getByRole('textbox', { name: /^Сумма/ }) as HTMLInputElement;
const row = async (td: OpsDeps, id: string) => storeOf(td).db.transactions.get(id);

describe('шит правки: поля заполнены', () => {
  it('сумма, категория, кошелёк, дата и заметка — как в операции', async () => {
    await openEdit(food12());
    expect(amountField().value).toBe('12,5');
    expect(screen.getByRole('button', { name: 'Еда' })).toHaveAttribute('aria-pressed', 'true');
    expect(contextChip('Кошелёк').getAttribute('aria-label')).toBe('Кошелёк: Наличные · TJS');
    expect(contextChip('Дата').getAttribute('aria-label')).toBe('Дата: Вчера');
    expect((screen.getByRole('textbox', { name: /^Заметка/ }) as HTMLInputElement).value).toBe('обед');
  });

  it('перевод: показаны «Откуда», «Куда» и «Получено»', async () => {
    await openEdit(async (s, ids) =>
      (
        await s.transactions.create({
          kind: 'transfer',
          walletId: ids.cash,
          toWalletId: ids.usd,
          amountMinor: 10_900,
          toAmountMinor: 1000,
          occurredOn: todayLocal(),
        })
      ).id,
    );
    expect(screen.getByRole('radio', { name: 'Перевод' })).toHaveAttribute('aria-checked', 'true');
    expect(amountField().value).toBe('109');
    expect((screen.getByRole('textbox', { name: /^Получено/ }) as HTMLInputElement).value).toBe('10');
    expect(contextChip('Откуда').getAttribute('aria-label')).toBe('Откуда: Наличные · TJS');
    expect(contextChip('Куда').getAttribute('aria-label')).toBe('Куда: Доллары · USD');
    await user.click(contextChip('Куда'));
    expect(chipLabels('Куда')).toEqual(['Карта · TJS', 'Доллары · USD']);
    expect(chip('Куда', 'Доллары · USD')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('сохранение правки', () => {
  it('меняет сумму: id и дата создания те же, помечено «ждёт отправки», остаток пересчитан', async () => {
    const { td, ids, onClose } = await openEdit(food12());
    const before = await row(td, ids.tx);
    await user.clear(amountField());
    await tapAmount('20');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const after = await row(td, ids.tx);
    expect(after).toMatchObject({ id: ids.tx, createdAt: before?.createdAt, amountMinor: 2000, baseAmountMinor: 2000, dirty: 1 });
    expect((after?.clientUpdatedAt ?? '') > (before?.clientUpdatedAt ?? '')).toBe(true);
    expect(await allTxs(td)).toHaveLength(1);
    expect((await balancesOf(td)).get(ids.cash)).toBe(-2000);
    expect(screen.getByText('Сохранено')).toBeInTheDocument();
  });

  it('меняет категорию, заметку, кошелёк и дату', async () => {
    const { td, ids, onClose } = await openEdit(food12());
    await user.click(screen.getByRole('button', { name: 'Транспорт' }));
    await pickWallet('Карта · TJS');
    const note = screen.getByRole('textbox', { name: /^Заметка/ });
    await user.clear(note);
    await user.type(note, 'такси');
    await pickDate('Сегодня');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.tx)).toMatchObject({
      categoryId: ids.transport,
      walletId: ids.card,
      note: 'такси',
      occurredOn: todayLocal(),
      amountMinor: 1250,
    });
  });

  it('«Сохранить» без изменений ничего не пишет (метка правки та же)', async () => {
    const { td, ids, onClose } = await openEdit(food12());
    const before = await row(td, ids.tx);
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.tx)).toEqual(before);
  });

  it('двойное нажатие «Сохранить» — одна правка', async () => {
    const { td, onClose } = await openEdit(food12());
    const spy = vi.spyOn(storeOf(td).transactions, 'update');
    await user.clear(amountField());
    await tapAmount('3');
    const button = screen.getByRole('button', { name: 'Сохранить' });
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('пустая сумма и дата вне 2000–2100 не сохраняются', async () => {
    const { td, ids, onClose } = await openEdit(food12());
    await user.clear(amountField());
    await save();
    expect(await waitFor(() => screen.getByText('Введите сумму'))).toBeInTheDocument();
    await tapAmount('4');
    await pickDate('Другая дата');
    setDateInput(dateInput(), '1999-01-01');
    await save();
    expect(await waitFor(() => screen.getByText('Дата должна быть между 2000 и 2100 годом'))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect((await row(td, ids.tx))?.amountMinor).toBe(1250);
  });

  it('вид можно сменить: расход → доход, категория сбрасывается и выбирается заново', async () => {
    const { td, ids, onClose } = await openEdit(food12());
    await user.click(screen.getByRole('radio', { name: 'Доход' }));
    await user.click(screen.getByRole('button', { name: 'Зарплата' }));
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const salary = (await storeOf(td).db.categories.toArray()).find((c) => c.name === 'Зарплата');
    expect(await row(td, ids.tx)).toMatchObject({ kind: 'income', categoryId: salary?.id, amountMinor: 1250 });
    expect((await balancesOf(td)).get(ids.cash)).toBe(1250);
  });

  it('расход → перевод: категория пропадает, нужен «Куда»', async () => {
    const { td, ids, onClose } = await openEdit(food12());
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    expect(screen.queryByRole('group', { name: 'Категория' })).toBeNull();
    await pickWallet('Карта · TJS', 'Куда');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.tx)).toMatchObject({
      kind: 'transfer',
      walletId: ids.cash,
      toWalletId: ids.card,
      amountMinor: 1250,
      toAmountMinor: 1250,
      categoryId: null,
      baseAmountMinor: 0,
      fxRate: null,
    });
  });

  it('ошибка репозитория не закрывает окно и показывается внизу формы', async () => {
    const { td, ids, onClose } = await openEdit(food12());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await write(() => storeOf(td).db.transactions.update(ids.tx, { occurredOn: '2026-10-09' }));
    vi.spyOn(storeOf(td).transactions, 'update').mockRejectedValueOnce(new Error('диск полон'));
    await user.clear(amountField());
    await tapAmount('8');
    await save();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить'));
    expect(onClose).not.toHaveBeenCalled();
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await row(td, ids.tx))?.amountMinor).toBe(800);
  });
});

describe('правка не переоценивает курс', () => {
  it('сумма в долларах меняется — пересчёт по курсу ИЗ ОПЕРАЦИИ (10,9), а не по сегодняшнему (11,5)', async () => {
    const newer = table({ perUnit: { TJS: 1, USD: 11.5 } });
    const { td, ids, onClose } = await openEdit(usdExpense, [newer]);
    expect(td.rates.getRate('USD', 'TJS')?.rate).toBe(11.5);
    expect(fxNotice()).toHaveTextContent('Курс при внесении: 1 $ = 10,9 с.');
    await user.clear(amountField());
    await tapAmount('20');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.tx)).toMatchObject({ amountMinor: 2000, baseAmountMinor: 21_800, fxRate: 10.9, fxSource: 'nbt', baseCurrency: 'TJS' });
  });

  it('правится только заметка — снимок суммы в сомони не меняется', async () => {
    const newer = table({ perUnit: { TJS: 1, USD: 11.5 } });
    const { td, ids, onClose } = await openEdit(usdExpense, [newer]);
    const before = await row(td, ids.tx);
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'кофе');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const after = await row(td, ids.tx);
    expect(after).toMatchObject({ note: 'кофе', baseAmountMinor: before?.baseAmountMinor, fxRate: 10.9, fxSource: 'nbt' });
  });

  it('если курсов нет совсем, старая операция всё равно правится (курс не нужен)', async () => {
    const { td, ids, onClose } = await openEdit(usdExpense, []);
    expect(screen.queryByRole('textbox', { name: /^Курс/ })).toBeNull();
    await user.clear(amountField());
    await tapAmount('5');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.tx)).toMatchObject({ amountMinor: 500, baseAmountMinor: 5450, fxRate: 10.9 });
  });

  it('перенос в кошелёк другой валюты — курс берётся текущий; нет курса — просят ввести', async () => {
    const { td, ids, onClose } = await openEdit(food12(), []);
    await pickWallet('Доллары · USD');
    await save();
    expect(await waitFor(() => screen.getByText(/Курса пока нет — введите его/))).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /^Курс/ }), '10,8');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.tx)).toMatchObject({ walletId: ids.usd, amountMinor: 1250, baseAmountMinor: 13_500, fxRate: 10.8, fxSource: 'manual' });
    // курс записан только в операцию: общим курсом пары он не становится
    expect(td.rates.getRate('USD', 'TJS')).toBeNull();
  });
});

describe('удаление', () => {
  it('с подтверждением: «Отмена» ничего не удаляет, «Удалить» удаляет мягко; тост возвращает операцию', async () => {
    const { td, ids, onClose } = await openEdit(food12());
    await user.click(screen.getByRole('button', { name: 'Удалить операцию' }));
    const dialog = await findByRole('alertdialog', { name: 'Удалить операцию?' });
    expect(dialog).toHaveTextContent('Расход 12,50 с.');
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((await row(td, ids.tx))?.deletedAt).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Удалить операцию' }));
    await findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect((await row(td, ids.tx))?.deletedAt).not.toBeNull();
    expect(await allTxs(td)).toHaveLength(1); // мягкое удаление: строка на месте
    expect((await balancesOf(td)).get(ids.cash)).toBe(0);
    expect(screen.getByText('Операция удалена')).toBeInTheDocument();
    // окно «не найдена» при этом не мелькает
    expect(screen.queryByText('Операция не найдена')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await eventually(async () => expect((await row(td, ids.tx))?.deletedAt).toBeNull());
    expect((await balancesOf(td)).get(ids.cash)).toBe(-1250);
    expect(screen.getByText('Операция возвращена')).toBeInTheDocument();
  });
});

describe('операции нет', () => {
  it('несуществующий номер: понятное сообщение и закрытие', async () => {
    const td = opsDeps();
    const onClose = vi.fn();
    await showApp(<EditTransactionSheet id="00000000-0000-4000-8000-000000000000" onClose={onClose} />, td, '/edit/x');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Операция не найдена: возможно, её уже удалили.')).toBeInTheDocument();
  });

  it('мусор вместо номера не ломает окно', async () => {
    const td = opsDeps();
    const onClose = vi.fn();
    await showApp(<EditTransactionSheet id="<script>" onClose={onClose} />, td, '/edit/x');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('уже удалённая операция открыться не может', async () => {
    let id = '';
    const td = opsDeps([], {
      setup: async (s) => {
        const w = (await s.db.wallets.toArray())[0];
        const t = await s.transactions.create({ kind: 'expense', walletId: w?.id ?? '', amountMinor: 100, occurredOn: todayLocal() });
        await s.transactions.softDelete(t.id);
        id = t.id;
      },
    });
    const onClose = vi.fn();
    function Edit() {
      return <EditTransactionSheet id={id} onClose={onClose} />;
    }
    await showApp(<Edit />, td, '/edit/x');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Операция не найдена: возможно, её уже удалили.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
  });

  it('операцию удалили на другом устройстве, пока окно открыто: сообщение и закрытие', async () => {
    const { td, ids, onClose } = await openEdit(food12());
    expect(onClose).not.toHaveBeenCalled();
    await write(() => storeOf(td).transactions.softDelete(ids.tx));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Операция не найдена: возможно, её уже удалили.')).toBeInTheDocument();
  });
});

describe('архивный кошелёк и категория', () => {
  it('операция в архивном кошельке правится; кошелёк остаётся выбранным, а другие архивные не предлагаются', async () => {
    const { td, ids, onClose } = await openEdit(
      async (s, ids) => {
        const t = await s.transactions.create({ kind: 'expense', walletId: ids.card, amountMinor: 700, categoryId: ids.food, occurredOn: todayLocal() });
        await s.wallets.archive(ids.card);
        await s.wallets.archive(ids.usd);
        await s.categories.archive(ids.food);
        return t.id;
      },
      [],
    );
    expect(contextChip('Кошелёк').getAttribute('aria-label')).toBe('Кошелёк: Карта');
    // в списке кошельков — только он и неархивные; архивные «Доллары» не предлагаются
    await user.click(contextChip('Кошелёк'));
    expect(chipLabels('Кошелёк')).toEqual(['Наличные', 'Карта']);
    await user.click(contextChip('Кошелёк'));
    expect(screen.getByRole('button', { name: 'Еда (в архиве)' })).toHaveAttribute('aria-pressed', 'true');
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'ок');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.tx)).toMatchObject({ walletId: ids.card, note: 'ок', categoryId: ids.food });
  });
});

describe('перевод: правка суммы зачисления', () => {
  const crossTransfer: Maker = async (s, ids) =>
    (
      await s.transactions.create({
        kind: 'transfer',
        walletId: ids.cash,
        toWalletId: ids.usd,
        amountMinor: 10_900,
        toAmountMinor: 1000,
        occurredOn: todayLocal(),
      })
    ).id;
  const received = () => (screen.getByRole('textbox', { name: /^Получено/ }) as HTMLInputElement).value;

  it('сумма списания изменилась, «Получено» человек не трогал — оно пересчитывается по курсу само', async () => {
    const { td, ids, onClose } = await openEdit(crossTransfer);
    expect(received()).toBe('10');
    await user.clear(amountField());
    await tapAmount('218');
    await waitFor(() => expect(received()).toBe('20'));
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.tx)).toMatchObject({ amountMinor: 21_800, toAmountMinor: 2000 });
  });

  it('вернули прежнюю сумму списания — вернулось и прежнее «Получено»; сохранение ничего не пишет', async () => {
    const { td, ids, onClose } = await openEdit(crossTransfer);
    const before = await row(td, ids.tx);
    await user.clear(amountField());
    await tapAmount('218');
    await waitFor(() => expect(received()).toBe('20'));
    await user.clear(amountField());
    await tapAmount('109');
    await waitFor(() => expect(received()).toBe('10'));
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.tx)).toEqual(before);
  });

  it('«Получено», набранное самим человеком, не затирается сменой суммы списания', async () => {
    const { td, ids, onClose } = await openEdit(crossTransfer);
    await user.clear(screen.getByRole('textbox', { name: /^Получено/ }));
    await user.type(screen.getByRole('textbox', { name: /^Получено/ }), '15');
    await user.clear(amountField());
    await tapAmount('218');
    expect(received()).toBe('15');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.tx)).toMatchObject({ amountMinor: 21_800, toAmountMinor: 1500 });
  });

  it('курса нет: после смены суммы списания просят ввести «Получено», старое молча не остаётся', async () => {
    const { td, ids, onClose } = await openEdit(crossTransfer, []);
    await user.clear(amountField());
    await tapAmount('218');
    await save();
    expect(await waitFor(() => screen.getByText('Курса нет — введите, сколько денег пришло'))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(await row(td, ids.tx)).toMatchObject({ amountMinor: 10_900, toAmountMinor: 1000 });
  });

  it('«Подставить по курсу» возвращает расчёт по курсу после ручного ввода', async () => {
    const { td, ids, onClose } = await openEdit(crossTransfer);
    await user.clear(screen.getByRole('textbox', { name: /^Получено/ }));
    await user.type(screen.getByRole('textbox', { name: /^Получено/ }), '15');
    await user.click(screen.getByRole('button', { name: 'Подставить по курсу' }));
    await waitFor(() => expect(received()).toBe('10'));
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.tx)).toMatchObject({ amountMinor: 10_900, toAmountMinor: 1000 });
  });
});
