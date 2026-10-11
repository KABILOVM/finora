import { afterEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
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

  it('превратить операцию по долгу в перевод нельзя: связь не пропадает молча, а приходит ошибка', async () => {
    const { td, ids, onClose } = await openEdit((i) => i.payment);
    const before = await row(td, ids.payment);
    await user.click(screen.getByRole('radio', { name: 'Перевод' }));
    await save();
    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(norm(alert.textContent)).toContain('У перевода не бывает долга');
    expect(onClose).not.toHaveBeenCalled();
    expect(await row(td, ids.payment)).toEqual(before);
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
