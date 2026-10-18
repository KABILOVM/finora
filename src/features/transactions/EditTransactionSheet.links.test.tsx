import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { computeDebtState } from '@/domain/debts';
import { addDays, todayLocal } from '@/lib/dates';
import {
  amountField,
  opsDeps,
  pickWallet,
  showApp,
  storeOf,
  table,
  tapAmount,
  type OpsDeps,
} from './__fixtures__/opsKit';
import EditTransactionSheet from './EditTransactionSheet';

afterEach(() => vi.restoreAllMocks());

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

interface Ids {
  cash: string;
  card: string;
  usd: string;
  debt: string;
  /** Операция выдачи долга (расход 500 с. с «Наличных»). */
  issue: string;
  /** Платёж по долгу (доход 200 с.). */
  payment: string;
  rule: string;
  /** Операция по регулярному платежу. */
  ruleTx: string;
  plain: string;
}

/** Долг «Алишер» (я дал 500 с.) с выдачей и платежом 200 с.; регулярный расход с операцией; обычная операция. Кошельки: Наличные, Карта (TJS), Доллары (USD). */
async function seed(s: Store, ids: Ids): Promise<void> {
  ids.cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
  ids.card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
  ids.usd = (await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 100_000, color: '#2563eb', icon: '💲' })).id;
  const debt = await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: addDays(todayLocal(), -10) });
  ids.debt = debt.id;
  ids.issue = (await s.transactions.create({ kind: 'expense', walletId: ids.cash, amountMinor: 50_000, occurredOn: addDays(todayLocal(), -10), debtId: debt.id })).id;
  ids.payment = (await s.transactions.create({ kind: 'income', walletId: ids.cash, amountMinor: 20_000, occurredOn: addDays(todayLocal(), -2), debtId: debt.id })).id;
  const rule = await s.recurring.create({ kind: 'expense', walletId: ids.cash, amountMinor: 3_000, frequency: 'monthly', startOn: todayLocal(), note: 'интернет' });
  ids.rule = rule.id;
  ids.ruleTx = (await s.transactions.createFromRule(rule.id, todayLocal())).id;
  ids.plain = (await s.transactions.create({ kind: 'expense', walletId: ids.cash, amountMinor: 1_000, occurredOn: todayLocal() })).id;
}

async function openEdit(pick: (ids: Ids) => string) {
  const ids = { cash: '', card: '', usd: '', debt: '', issue: '', payment: '', rule: '', ruleTx: '', plain: '' } as Ids;
  const td = opsDeps([table()], { setup: (s) => seed(s, ids) });
  const onClose = vi.fn();
  function Edit() {
    return <EditTransactionSheet id={pick(ids)} onClose={onClose} />;
  }
  await showApp(<Edit />, td, '/edit/x');
  await findByRole('dialog', { name: 'Правка операции' });
  return { td, ids, onClose };
}

const save = () => user.click(screen.getByRole('button', { name: 'Сохранить' }));
const row = (td: OpsDeps, id: string) => storeOf(td).db.transactions.get(id);
const stateOf = async (td: OpsDeps, debtId: string) => {
  const s = storeOf(td);
  const debt = (await s.db.debts.get(debtId))!;
  const wallets = await s.db.wallets.toArray();
  return computeDebtState(debt, await s.db.transactions.where('debtId').equals(debtId).toArray(), new Map(wallets.map((w) => [w.id, w])));
};
const notice = () => document.querySelector('[data-testid="tx-link-notice"]');

describe('правка операции по долгу', () => {
  it('в шите сказано, к какому долгу относится операция, и есть ссылка на него', async () => {
    const { ids } = await openEdit((i) => i.payment);
    await waitFor(() => expect(norm(notice()?.textContent)).toContain('Эта операция относится к долгу «Алишер»'));
    expect(norm(notice()?.textContent)).toContain('Связь сохранится');
    expect(norm(notice()?.textContent)).toContain('валюте долга (TJS)');
    expect(screen.getByRole('link', { name: 'Открыть долг' }).getAttribute('href')).toBe(`/debts/${ids.debt}`);
  });

  it('правка суммы платежа не теряет debtId; остаток долга пересчитывается', async () => {
    const { td, ids, onClose } = await openEdit((i) => i.payment);
    expect((await stateOf(td, ids.debt)).remainingMinor).toBe(30_000);
    await user.clear(amountField());
    await tapAmount('300');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.payment)).toMatchObject({ amountMinor: 30_000, debtId: ids.debt, kind: 'income' });
    expect((await stateOf(td, ids.debt)).remainingMinor).toBe(20_000);
  });

  it('правка только заметки или даты тоже оставляет связь с долгом', async () => {
    const { td, ids, onClose } = await openEdit((i) => i.issue);
    await user.click(screen.getByRole('button', { name: 'Заметка' })); // заметка скрыта, пока её не откроют
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'наличными');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.issue)).toMatchObject({ note: 'наличными', debtId: ids.debt });
  });

  it('кошелёк в другой валюте: понятная ошибка от репозитория, операция не меняется', async () => {
    const { td, ids, onClose } = await openEdit((i) => i.payment);
    const before = await row(td, ids.payment);
    await pickWallet('Доллары · USD');
    // курс для доллара есть в таблице, поэтому дело именно в долге
    await save();
    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(norm(alert.textContent)).toContain('Валюта кошелька «Доллары» (USD) не совпадает с валютой долга «Алишер» (TJS)');
    expect(onClose).not.toHaveBeenCalled();
    expect(await row(td, ids.payment)).toEqual(before);
  });

  it('кошелёк в той же валюте менять можно: связь остаётся', async () => {
    const { td, ids, onClose } = await openEdit((i) => i.payment);
    await pickWallet('Карта · TJS');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.payment)).toMatchObject({ walletId: ids.card, debtId: ids.debt });
    expect((await stateOf(td, ids.debt)).remainingMinor).toBe(30_000);
  });

  it('вид операции по долгу закрыт: платёж не стать выдачей или переводом, рядом подсказка; сохранение ничего не меняет', async () => {
    const { td, ids, onClose } = await openEdit((i) => i.payment);
    const before = await row(td, ids.payment);
    const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLButtonElement;
    expect(radio('Доход')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Расход').disabled).toBe(true);
    expect(radio('Перевод').disabled).toBe(true);
    expect(screen.getByText(/Вид операции по долгу не меняется/)).toBeInTheDocument();
    await user.click(radio('Перевод'));
    await user.click(radio('Расход'));
    radio('Доход').focus();
    await user.keyboard('{ArrowRight}');
    expect(radio('Доход')).toHaveAttribute('aria-checked', 'true');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.payment)).toEqual(before);
    expect((await stateOf(td, ids.debt)).remainingMinor).toBe(30_000);
  });

  it('у обычной операции вид меняется, подсказки про долг нет', async () => {
    await openEdit((i) => i.plain);
    expect((screen.getByRole('radio', { name: 'Доход' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Вид операции по долгу не меняется/)).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Доход' }));
    expect(screen.getByRole('radio', { name: 'Доход' })).toHaveAttribute('aria-checked', 'true');
  });

  it('если вид всё же пришёл другим (репозиторий), операция по долгу не меняется: понятная ошибка', async () => {
    const { td, ids } = await openEdit((i) => i.issue);
    const before = await row(td, ids.issue);
    await expect(storeOf(td).transactions.update(ids.issue, { kind: 'income', debtId: ids.debt })).rejects.toThrow(
      'Вид операции по долгу менять нельзя',
    );
    expect(await row(td, ids.issue)).toEqual(before);
    expect((await stateOf(td, ids.debt)).remainingMinor).toBe(30_000);
  });

  it('удаление: в подтверждении сказано про остаток долга; платёж удаляется мягко', async () => {
    const { td, ids, onClose } = await openEdit((i) => i.payment);
    await user.click(screen.getByRole('button', { name: 'Удалить операцию' }));
    const dlg = await findByRole('alertdialog', { name: 'Удалить операцию?' });
    expect(norm(dlg.textContent)).toContain('в том числе остаток долга');
    await user.click(Array.from(dlg.querySelectorAll('button')).find((b) => b.textContent === 'Удалить')!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await row(td, ids.payment))?.deletedAt).not.toBeNull();
    expect((await stateOf(td, ids.debt)).remainingMinor).toBe(50_000);
  });
});

describe('правка операции по регулярному платежу', () => {
  it('в шите сказано, что операция создана регулярным платежом', async () => {
    await openEdit((i) => i.ruleTx);
    expect(norm(notice()?.textContent)).toContain('Операция создана регулярным платежом');
  });

  it('правка заметки и суммы не теряет recurringRuleId; id операции тот же (он выведен из правила и даты)', async () => {
    const { td, ids, onClose } = await openEdit((i) => i.ruleTx);
    const before = await row(td, ids.ruleTx);
    await user.clear(amountField());
    await tapAmount('45');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const after = await row(td, ids.ruleTx);
    expect(after).toMatchObject({ id: ids.ruleTx, recurringRuleId: ids.rule, amountMinor: 4_500 });
    expect(before?.recurringRuleId).toBe(ids.rule);
  });

  it('смена кошелька оставляет связь с регулярным платежом', async () => {
    const { td, ids, onClose } = await openEdit((i) => i.ruleTx);
    await pickWallet('Карта · TJS');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.ruleTx)).toMatchObject({ walletId: ids.card, recurringRuleId: ids.rule });
  });
});

describe('обычная операция', () => {
  it('никакого пояснения о связях, правка работает как раньше', async () => {
    const { td, ids, onClose } = await openEdit((i) => i.plain);
    expect(notice()).toBeNull();
    await user.clear(amountField());
    await tapAmount('15');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await row(td, ids.plain)).toMatchObject({ amountMinor: 1_500, debtId: null, recurringRuleId: null });
  });
});

// ---------- выдача и платёж: что правка и удаление делают с долгом ----------

const ENTRY_NOTE = 'Сумма долга хранится в самом долге: другая сумма здесь изменит только кошелёк и «Выдано деньгами», а не долг.';
const ENTRY_DELETE = 'сумма и остаток долга не изменятся — меняется только кошелёк и «Выдано деньгами»';

/** Как openEdit, но после общей подготовки — ещё своя (extra возвращает id операции, которую открыть). */
async function openEditAfter(extra: (s: Store, ids: Ids) => Promise<string>) {
  const ids = { cash: '', card: '', usd: '', debt: '', issue: '', payment: '', rule: '', ruleTx: '', plain: '' } as Ids;
  let target = '';
  const td = opsDeps([table()], {
    setup: async (s) => {
      await seed(s, ids);
      target = await extra(s, ids);
    },
  });
  const onClose = vi.fn();
  function Edit() {
    return <EditTransactionSheet id={target} onClose={onClose} />;
  }
  await showApp(<Edit />, td, '/edit/x');
  await findByRole('dialog', { name: 'Правка операции' });
  return { td, ids, onClose, target };
}

/** Открывает подтверждение удаления и ждёт, пока роль операции в долге дочитается (текст подтверждения от неё зависит). */
async function openDeleteConfirm(expectText: string) {
  await user.click(screen.getByRole('button', { name: 'Удалить операцию' }));
  const dlg = await findByRole('alertdialog', { name: 'Удалить операцию?' });
  await waitFor(() => expect(norm(dlg.textContent)).toContain(expectText));
  return dlg;
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });

describe('выдача долга (исходная операция): сумма долга живёт в самом долге', () => {
  it('в пояснении сказано, что правка меняет только кошелёк и «Выдано деньгами»', async () => {
    await openEdit((i) => i.issue);
    await waitFor(() => expect(norm(notice()?.textContent)).toContain(ENTRY_NOTE));
    expect(norm(notice()?.textContent)).toContain('Эта операция относится к долгу «Алишер»');
  });

  it('удаление: в подтверждении — «сумма и остаток долга не изменятся», а не «в том числе остаток долга»; остаток после удаления тот же', async () => {
    const { td, ids, onClose } = await openEdit((i) => i.issue);
    const dlg = await openDeleteConfirm(ENTRY_DELETE);
    const text = norm(dlg.textContent);
    expect(text).toContain(`остатки пересчитаются; ${ENTRY_DELETE}. Сразу после удаления её можно вернуть`);
    expect(text).not.toContain('в том числе остаток долга');

    expect(await stateOf(td, ids.debt)).toMatchObject({ remainingMinor: 30_000, issuedMinor: 50_000 });
    await user.click(Array.from(dlg.querySelectorAll('button')).find((b) => b.textContent === 'Удалить')!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await row(td, ids.issue))?.deletedAt).not.toBeNull();
    // как и обещано: остаток не изменился, пропала только выдача деньгами
    expect(await stateOf(td, ids.debt)).toMatchObject({ remainingMinor: 30_000, issuedMinor: 0, principalMinor: 50_000 });
  });

  it('пополнение («добавить ещё», второй расход по долгу «мне должны») — тоже выдача: та же оговорка и тот же текст удаления', async () => {
    await openEditAfter(async (s, ids) => {
      const t = await s.transactions.create({ kind: 'expense', walletId: ids.card, amountMinor: 10_000, occurredOn: addDays(todayLocal(), -1), debtId: ids.debt });
      return t.id;
    });
    await waitFor(() => expect(norm(notice()?.textContent)).toContain(ENTRY_NOTE));
    const dlg = await openDeleteConfirm(ENTRY_DELETE);
    expect(norm(dlg.textContent)).not.toContain('в том числе остаток долга');
  });

  it('«я должен»: полученные в долг деньги (доход) — тоже выдача: та же оговорка и тот же текст удаления', async () => {
    await openEditAfter(async (s, ids) => {
      const bank = await s.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 30_000, currency: 'TJS', openedOn: addDays(todayLocal(), -20) });
      // мой возврат 100 с. (расход) — платёж; открываем полученные деньги (доход)
      await s.transactions.create({ kind: 'expense', walletId: ids.cash, amountMinor: 10_000, occurredOn: addDays(todayLocal(), -3), debtId: bank.id });
      return (await s.transactions.create({ kind: 'income', walletId: ids.cash, amountMinor: 30_000, occurredOn: addDays(todayLocal(), -20), debtId: bank.id })).id;
    });
    await waitFor(() => expect(norm(notice()?.textContent)).toContain('Эта операция относится к долгу «Банк»'));
    await waitFor(() => expect(norm(notice()?.textContent)).toContain(ENTRY_NOTE));
    const dlg = await openDeleteConfirm(ENTRY_DELETE);
    expect(norm(dlg.textContent)).not.toContain('в том числе остаток долга');
  });
});

describe('платёж по долгу: оговорки про выдачу нет', () => {
  it('в пояснении нет фразы про «Выдано деньгами»; в подтверждении удаления — «в том числе остаток долга» без «не изменятся»', async () => {
    await openEdit((i) => i.payment);
    await waitFor(() => expect(norm(notice()?.textContent)).toContain('Эта операция относится к долгу «Алишер»'));
    await settle(); // роль дочитана: у выдачи здесь появилась бы оговорка
    expect(norm(notice()?.textContent)).not.toContain('Сумма долга хранится в самом долге');
    expect(norm(notice()?.textContent)).not.toContain('Выдано деньгами');

    await user.click(screen.getByRole('button', { name: 'Удалить операцию' }));
    const dlg = await findByRole('alertdialog', { name: 'Удалить операцию?' });
    await settle();
    const text = norm(dlg.textContent);
    expect(text).toContain('остатки пересчитаются, в том числе остаток долга. Сразу после удаления');
    expect(text).not.toContain('не изменятся');
    expect(text).not.toContain('Выдано деньгами');
  });

  it('операция долга в чужой валюте в расчёт не входит: ни «в том числе остаток долга», ни оговорки про выдачу', async () => {
    // такая операция приходит, например, с другого устройства (репозиторий сам её не запишет): кладём прямо в базу
    await openEditAfter(async (s, ids) => {
      await s.db.transactions.update(ids.payment, { walletId: ids.usd });
      return ids.payment;
    });
    await waitFor(() => expect(norm(notice()?.textContent)).toContain('Эта операция относится к долгу «Алишер»'));
    await user.click(screen.getByRole('button', { name: 'Удалить операцию' }));
    const dlg = await findByRole('alertdialog', { name: 'Удалить операцию?' });
    await waitFor(() => expect(norm(dlg.textContent)).toContain('Она пропадёт из списка, остатки пересчитаются. Сразу после удаления'));
    expect(norm(dlg.textContent)).not.toContain('остаток долга');
    expect(norm(notice()?.textContent)).not.toContain(ENTRY_NOTE);
  });
});
