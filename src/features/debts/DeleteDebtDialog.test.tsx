import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { chooseMenuAction, findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { DebtDeleteMode, Store } from '@/db';
import { formatMinor } from '@/domain/money';
import type { LocalRow, Transaction, UUID, Wallet } from '@/domain/types';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, storeOf, table, unpinToday, type OpsDeps } from '@/features/transactions/__fixtures__/opsKit';
import DebtDetailPage from './DebtDetailPage';
import { DeleteDebtDialog } from './DeleteDebtDialog';
import { keepText, previewDebtDelete } from './debtDeleteText';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const DEBT_ID = '0d6c0d3e-5a3b-4f43-9c59-7b4b0d3a1111';
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const text = (el: Element | null) => norm(el?.textContent);
const TITLE = 'Удалить долг «Алишер»?';
const ARCHIVE_HINT = 'Чтобы просто убрать долг из списка, отправьте его в архив.';
const hint = () => text(document.querySelector('[data-testid="debt-delete-hint"]'));
const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
/** Кнопка внутри окна подтверждения (на странице есть «Удалить долг» и другие кнопки). */
const inAlert = (name: string): HTMLButtonElement => {
  const dlg = screen.getByRole('alertdialog', { name: TITLE });
  const hit = Array.from(dlg.querySelectorAll('button')).find((b) => text(b) === name);
  if (!hit) throw new Error(`В окне «${TITLE}» нет кнопки «${name}»`);
  return hit;
};

interface Ids {
  cash: string;
  issue: string;
  pay: string;
}
type Setup = (s: Store, ids: Ids) => Promise<unknown>;

/**
 * «Наличные» с 1 000 с. Долг «Алишер» 500 с. («мне должны», от 01.10.2026): выдан деньгами с «Наличных» (расход 500 с.),
 * вернул 100 с. (доход 05.10.2026). ops: false — долг «на бумаге», без операций.
 */
async function show(setup?: Setup, opts: { ops?: boolean } = {}) {
  const ids: Ids = { cash: '', issue: '', pay: '' };
  const td = opsDeps([table()], {
    setup: async (s) => {
      ids.cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
      await s.transactions.create({ kind: 'income', walletId: ids.cash, amountMinor: 100_000, occurredOn: '2026-09-30' });
      await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' }, { id: DEBT_ID });
      if (opts.ops !== false) {
        ids.issue = (await s.transactions.create({ kind: 'expense', walletId: ids.cash, amountMinor: 50_000, occurredOn: '2026-10-01', debtId: DEBT_ID })).id;
        ids.pay = (await s.transactions.create({ kind: 'income', walletId: ids.cash, amountMinor: 10_000, occurredOn: '2026-10-05', debtId: DEBT_ID })).id;
      }
      await setup?.(s, ids);
    },
  });
  await showApp(
    <>
      <Routes>
        <Route path="/debts/:id" element={<DebtDetailPage />} />
        <Route path="/debts" element={<p>Список долгов</p>} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <LocationProbe />
    </>,
    td,
    `/debts/${DEBT_ID}`,
  );
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return { td, ids };
}

const openDelete = async () => {
  await chooseMenuAction('Удалить долг');
  return findByRole('alertdialog', { name: TITLE });
};
const debtRow = (td: OpsDeps) => storeOf(td).db.debts.get(DEBT_ID);
const txRow = (td: OpsDeps, id: string) => storeOf(td).db.transactions.get(id);

describe('Удаление долга с операциями: вариант выбирают сами', () => {
  it('заранее не выбран ни один вариант, «Удалить» недоступно, подсказка просит выбрать; нажатие ничего не удаляет', async () => {
    const { td } = await show();
    const dlg = await openDelete();
    expect(screen.getByRole('radiogroup', { name: 'Что удалить' })).toBeTruthy();
    expect(radio('Удалить только долг').checked).toBe(false);
    expect(radio('Удалить долг и его операции').checked).toBe(false);
    expect(hint()).toBe('Выберите, что сделать с 2 операциями этого долга.');
    expect(inAlert('Удалить').disabled).toBe(true);
    expect(inAlert('Отмена').disabled).toBe(false);
    expect(text(dlg)).toContain(`Сразу после удаления всё можно вернуть кнопкой «Отменить». ${ARCHIVE_HINT}`);
    await user.click(inAlert('Удалить'));
    expect(screen.getByRole('alertdialog', { name: TITLE })).toBeTruthy();
    expect((await debtRow(td))!.deletedAt).toBeNull();
  });

  it('одна операция — «с 1 операцией»', async () => {
    await show(async (s, ids) => void (await s.transactions.softDelete(ids.pay)));
    await openDelete();
    expect(hint()).toBe('Выберите, что сделать с 1 операцией этого долга.');
    await user.click(radio('Удалить только долг'));
    expect(hint()).toMatch(/^1 операция останется в истории как обычная: деньги в кошельках не меняются, но теперь она считается обычным доходом или расходом месяца и попадёт в итоги и бюджеты\. В расходы добавится /);
  });

  it('«Удалить только долг»: что добавится в итоги и что допишется в заметку; «Удалить» становится доступным', async () => {
    await show();
    await openDelete();
    await user.click(radio('Удалить только долг'));
    expect(radio('Удалить только долг').checked).toBe(true);
    expect(inAlert('Удалить').disabled).toBe(false);
    const h = hint();
    expect(h).toContain('2 операции останутся в истории как обычные: деньги в кошельках не меняются, но теперь они считаются обычными доходами и расходами месяца и попадут в итоги и бюджеты.');
    expect(h).toContain(` В расходы добавится ${fmt(50_000)}, в доходы — ${fmt(10_000)}`);
    expect(h).toContain('Операциям без заметки допишем «Долг «Алишер» (удалён)».');
    expect(h).toContain(`в доходы — ${fmt(10_000)} Операциям`); // «с.» уже с точкой: без «с..»
    expect(h).not.toContain('..');
  });

  it('«Удалить долг и его операции»: перечислено, что будет удалено', async () => {
    await show();
    await openDelete();
    await user.click(radio('Удалить долг и его операции'));
    expect(inAlert('Удалить').disabled).toBe(false);
    const h = hint();
    expect(h).toMatch(/^Будет удалено: 2 операции: /);
    expect(h).toContain(`расходов на ${fmt(50_000)}, доходов на ${fmt(10_000)}`);
    expect(h).toContain('Остатки кошельков вернутся такими, как были до этого долга.');
    expect(h).not.toContain('..');
    expect(h).not.toContain('допишем');
  });

  it('после «Отмена» выбор сбрасывается: при новом открытии снова ничего не выбрано', async () => {
    await show();
    await openDelete();
    await user.click(radio('Удалить только долг'));
    await user.click(inAlert('Отмена'));
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: TITLE })).toBeNull());
    await openDelete();
    expect(radio('Удалить только долг').checked).toBe(false);
    expect(inAlert('Удалить').disabled).toBe(true);
    expect(hint()).toBe('Выберите, что сделать с 2 операциями этого долга.');
  });

  it('«Удалить только долг» → «Удалить»: операции отвязаны, без заметки получили «Долг «Алишер» (удалён)»; «Отменить» всё возвращает', async () => {
    const { td, ids } = await show(async (s, ids) => void (await s.transactions.update(ids.pay, { note: 'вернул часть' })));
    await openDelete();
    await user.click(radio('Удалить только долг'));
    await user.click(inAlert('Удалить'));
    await waitFor(() => expect(currentPath()).toBe('/debts'));
    expect((await debtRow(td))!.deletedAt).not.toBeNull();
    expect(await txRow(td, ids.issue)).toMatchObject({ debtId: null, deletedAt: null, note: 'Долг «Алишер» (удалён)' });
    expect(await txRow(td, ids.pay)).toMatchObject({ debtId: null, deletedAt: null, note: 'вернул часть' });

    await user.click(await findByRole('button', { name: 'Отменить' }));
    await eventually(async () => expect((await debtRow(td))!.deletedAt).toBeNull());
    await eventually(async () => expect(await txRow(td, ids.issue)).toMatchObject({ debtId: DEBT_ID, note: '' }));
    expect(await txRow(td, ids.pay)).toMatchObject({ debtId: DEBT_ID, note: 'вернул часть' });
  });

  it('«Удалить долг и его операции» → «Удалить»: операции удалены, заметки не тронуты', async () => {
    const { td, ids } = await show();
    await openDelete();
    await user.click(radio('Удалить долг и его операции'));
    await user.click(inAlert('Удалить'));
    await waitFor(() => expect(currentPath()).toBe('/debts'));
    for (const id of [ids.issue, ids.pay]) expect(await txRow(td, id)).toMatchObject({ deletedAt: expect.any(String), debtId: DEBT_ID, note: '' });
  });
});

describe('Удаление долга без операций', () => {
  it('выбирать нечего: вариантов нет, «Удалить» доступно сразу, подсказка про архив на месте', async () => {
    await show(undefined, { ops: false });
    const dlg = await openDelete();
    expect(screen.queryByRole('radiogroup', { name: 'Что удалить' })).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(hint()).toBe('Операций по этому долгу нет: удалится только сам долг.');
    expect(inAlert('Удалить').disabled).toBe(false);
    expect(text(dlg)).toContain(ARCHIVE_HINT);
  });

  it('«Удалить» удаляет долг вариантом «только долг»', async () => {
    const { td } = await show(undefined, { ops: false });
    const spy = vi.spyOn(storeOf(td).debts, 'softDelete');
    await openDelete();
    await user.click(inAlert('Удалить'));
    await waitFor(() => expect(currentPath()).toBe('/debts'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(DEBT_ID, 'keep-operations');
    expect((await debtRow(td))!.deletedAt).not.toBeNull();
  });
});

describe('DeleteDebtDialog сам по себе', () => {
  const WALLET = 'w-tjs';
  const wallets = new Map<UUID, LocalRow<Wallet>>([[WALLET, { id: WALLET, currency: 'TJS' } as unknown as LocalRow<Wallet>]]);
  const tx = (id: string, kind: 'income' | 'expense', amountMinor: number) =>
    [id, { id, kind, walletId: WALLET, amountMinor, deletedAt: null, note: '' } as unknown as LocalRow<Transaction>] as const;

  function Harness({ txs, onConfirm }: { txs: ReadonlyMap<UUID, LocalRow<Transaction>>; onConfirm: (m: DebtDeleteMode) => void }) {
    const [open, setOpen] = useState(true);
    return (
      <DeleteDebtDialog
        open={open}
        debtId={DEBT_ID}
        counterparty="Алишер"
        txs={txs}
        wallets={wallets}
        base="TJS"
        loading={false}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    );
  }
  async function mount(txs: ReadonlyMap<UUID, LocalRow<Transaction>>) {
    const onConfirm = vi.fn<(m: DebtDeleteMode) => void>();
    await showApp(<Harness txs={txs} onConfirm={onConfirm} />, opsDeps([table()]));
    await findByRole('alertdialog', { name: TITLE });
    return onConfirm;
  }

  it('операций нет — onConfirm получает «keep-operations»', async () => {
    const onConfirm = await mount(new Map());
    await user.click(inAlert('Удалить'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('keep-operations');
  });

  it('удалённые операции не считаются: остались только удалённые — выбирать нечего', async () => {
    const gone = { ...tx('t1', 'expense', 100)[1], deletedAt: '2026-10-10T00:00:00.000Z' } as LocalRow<Transaction>;
    const onConfirm = await mount(new Map([['t1', gone]]));
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(hint()).toBe('Операций по этому долгу нет: удалится только сам долг.');
    await user.click(inAlert('Удалить'));
    expect(onConfirm).toHaveBeenCalledWith('keep-operations');
  });

  it('выбран вариант — onConfirm получает именно его', async () => {
    const onConfirm = await mount(new Map([tx('t1', 'expense', 40_000)]));
    await user.click(inAlert('Удалить'));
    expect(onConfirm).not.toHaveBeenCalled(); // пока не выбрано — кнопка недоступна
    await user.click(radio('Удалить долг и его операции'));
    await user.click(inAlert('Удалить'));
    expect(onConfirm).toHaveBeenLastCalledWith('with-operations');
    await user.click(radio('Удалить только долг'));
    await user.click(inAlert('Удалить'));
    expect(onConfirm).toHaveBeenLastCalledWith('keep-operations');
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('суммы не помещаются в расчёт — окно не падает: количество есть, сумм нет', async () => {
    const big = Number.MAX_SAFE_INTEGER - 10;
    await mount(new Map([tx('t1', 'expense', big), tx('t2', 'expense', big)]));
    expect(hint()).toBe('Выберите, что сделать с 2 операциями этого долга.');
    await user.click(radio('Удалить только долг'));
    expect(hint()).toBe(
      '2 операции останутся в истории как обычные: деньги в кошельках не меняются, но теперь они считаются обычными доходами и расходами месяца и попадут в итоги и бюджеты. Операциям без заметки допишем «Долг «Алишер» (удалён)».',
    );
    await user.click(radio('Удалить долг и его операции'));
    expect(hint()).toBe('Будет удалено: 2 операции. Остатки кошельков вернутся такими, как были до этого долга.');
  });
});

describe('previewDebtDelete и keepText', () => {
  const wallets = new Map([
    ['w1', { currency: 'TJS' }],
    ['w2', { currency: 'USD' }],
  ]);
  const tx = (id: string, kind: 'income' | 'expense' | 'transfer', amountMinor: number, walletId = 'w1') =>
    [id, { kind, walletId, amountMinor, deletedAt: null }] as [string, { kind: typeof kind; walletId: string; amountMinor: number; deletedAt: null }];

  it('переполнение суммы — RangeError, а не неверное число', () => {
    const big = Number.MAX_SAFE_INTEGER - 10;
    expect(() => previewDebtDelete(new Map([tx('a', 'expense', big), tx('b', 'expense', big)]), wallets, 'TJS')).toThrow(RangeError);
    expect(() => previewDebtDelete(new Map([tx('a', 'income', big), tx('b', 'income', 11)]), wallets, 'TJS')).toThrow(RangeError);
    // по разным валютам суммы не складываются — переполнения нет
    const p = previewDebtDelete(new Map([tx('a', 'expense', big), tx('b', 'expense', big, 'w2')]), wallets, 'TJS');
    expect([...p.expenses]).toEqual([
      ['TJS', big],
      ['USD', big],
    ]);
  });

  it('keepText: расходы и доходы', () => {
    const p = previewDebtDelete(new Map([tx('a', 'expense', 40_000), tx('b', 'income', 10_000), tx('c', 'income', 2_500)]), wallets, 'TJS');
    expect(norm(keepText(p))).toBe(`в расходы добавится ${fmt(40_000)}, в доходы — ${fmt(12_500)}`);
  });

  it('keepText: только расходы или только доходы', () => {
    expect(norm(keepText(previewDebtDelete(new Map([tx('a', 'expense', 40_000)]), wallets, 'TJS')))).toBe(`в расходы добавится ${fmt(40_000)}`);
    expect(norm(keepText(previewDebtDelete(new Map([tx('a', 'income', 10_000)]), wallets, 'TJS')))).toBe(`в доходы добавится ${fmt(10_000)}`);
  });

  it('keepText: несколько валют через «и»; переводы в итоги не попадают; нет операций — пусто', () => {
    const p = previewDebtDelete(new Map([tx('a', 'expense', 40_000), tx('b', 'expense', 500, 'w2'), tx('c', 'transfer', 9_999)]), wallets, 'TJS');
    expect(p.count).toBe(3);
    expect(norm(keepText(p))).toBe(`в расходы добавится ${fmt(40_000)} и ${fmt(500, 'USD')}`);
    expect(keepText(previewDebtDelete(new Map(), wallets, 'TJS'))).toBe('');
  });
});
