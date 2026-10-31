import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseMenuAction, findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import {
  LocationProbe,
  opsDeps,
  pinToday,
  showApp,
  storeOf,
  table,
  tapAmount,
  unpinToday,
} from '@/features/transactions/__fixtures__/opsKit';
import DebtDetailPage from './DebtDetailPage';
import DebtsPage from './DebtsPage';

/** Проценты по долгу (кредит в банке): форма «Новый долг», правка, страница долга, список. «Сегодня» — четверг 15.10.2026. */
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const DEBT_ID = '0d6c0d3e-5a3b-4f43-9c59-7b4b0d3a7777';
const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const text = (el: Element | null | undefined) => norm(el?.textContent);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const line = (label: string): string => {
  const dt = Array.from(document.querySelectorAll('dt')).find((x) => text(x) === label);
  return text(dt?.nextElementSibling ?? null);
};
const remaining = () => text(document.querySelector('[data-testid="debt-remaining"]'));
const closed = (name: string) => waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeNull());

type DebtInput = Parameters<Store['debts']['create']>[0];

/** 10 000 с. под 24 % на 12 месяцев: платёж 945,60, проценты 1 347,15, всего 11 347,15. */
const CREDIT: Partial<DebtInput> = {
  direction: 'borrowed',
  counterparty: 'Банк',
  principalMinor: 1_000_000,
  interestMinor: 134_715,
  interestRateBp: 2400,
  termMonths: 12,
};

async function show(path: string, opts: { debt?: Partial<DebtInput>; setup?: (s: Store, cash: string) => Promise<unknown> } = {}) {
  const td = opsDeps([table()], {
    setup: async (s) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
      if (opts.debt) {
        const d = await s.debts.create(
          { direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', ...opts.debt },
          { id: DEBT_ID },
        );
        // деньги по долгу: «Банк» выдал сумму долга (проценты денег не двигают)
        await s.transactions.create({
          kind: d.direction === 'lent' ? 'expense' : 'income',
          walletId: cash,
          amountMinor: d.principalMinor,
          occurredOn: '2026-10-01',
          debtId: d.id,
        });
      }
      await opts.setup?.(s, cash);
    },
  });
  await showApp(
    <>
      <Routes>
        <Route path="/debts/:id" element={<DebtDetailPage />} />
        <Route path="/debts" element={<DebtsPage />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <LocationProbe />
    </>,
    td,
    path,
  );
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const interestField = () => screen.getByRole('textbox', { name: /^Проценты за весь срок/ }) as HTMLInputElement;
const rateField = () => screen.getByRole('textbox', { name: 'Ставка, % годовых' }) as HTMLInputElement;
const termField = () => screen.getByRole('textbox', { name: 'Срок, месяцев' }) as HTMLInputElement;
const interestToggle = () => screen.getByRole('checkbox', { name: 'Есть проценты' }) as HTMLInputElement;
/** Значение строки в блоке «Всего к возврату / Платёж в месяц» под полями процентов. */
const previewLine = (label: string): string => {
  const dt = Array.from(document.querySelectorAll('[data-testid="interest-preview"] dt')).find((x) => text(x) === label);
  return text(dt?.nextElementSibling ?? null);
};

describe('новый долг с процентами', () => {
  const openNew = async () => {
    await findByRole('heading', { name: 'Долги', level: 1 });
    await user.click(button('Новый долг'));
    await findByRole('dialog', { name: 'Новый долг' });
    await user.click(screen.getByRole('radio', { name: 'Я взял в долг' }));
  };

  it('проценты выключены по умолчанию: поля ставки и срока не видны, долг как прежде', async () => {
    const td = await show('/debts');
    await openNew();
    expect(interestToggle().checked).toBe(false);
    expect(screen.queryByRole('textbox', { name: 'Ставка, % годовых' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'У кого я взял' }), 'Алишер');
    await tapAmount('500');
    await user.click(button('Сохранить'));
    await closed('Новый долг');
    expect((await storeOf(td).db.debts.toArray())[0]).toMatchObject({ principalMinor: 50_000, interestMinor: null, interestRateBp: null, termMonths: null });
  });

  it('ставка и срок считают проценты сами; видно, сколько вернуть и сколько платить в месяц; долг сохраняется с процентами', async () => {
    const td = await show('/debts');
    await openNew();
    await user.type(screen.getByRole('textbox', { name: 'У кого я взял' }), 'Банк');
    await tapAmount('10000');
    await user.click(interestToggle());
    await user.type(rateField(), '24');
    await user.type(termField(), '12');

    await waitFor(() => expect(interestField().value).toMatch(/1\s?347,15/));
    expect(previewLine('Всего к возврату')).toBe(fmt(1_134_715));
    expect(previewLine('Платёж в месяц')).toBe(`≈ ${fmt(94_560)}`);

    await user.click(button('Сохранить'));
    await closed('Новый долг');
    const s = storeOf(td);
    const debt = (await s.db.debts.toArray())[0]!;
    expect(debt).toMatchObject({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 1_000_000, interestMinor: 134_715, interestRateBp: 2400, termMonths: 12 });
    // деньги на кошелёк пришли только в сумме долга: проценты денег не двигают
    const txs = (await s.db.transactions.toArray()).filter((t) => t.debtId === debt.id);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ kind: 'income', amountMinor: 1_000_000 });
    // в списке — остаток вместе с процентами
    const row = await findByRole('link', { name: /^Банк/ });
    expect(text(row)).toContain(fmt(1_134_715));
    expect(text(row)).toContain('с процентами');
  });

  it('сумму процентов можно поправить руками под договор: ставка и срок её больше не перезаписывают', async () => {
    const td = await show('/debts');
    await openNew();
    await user.type(screen.getByRole('textbox', { name: 'У кого я взял' }), 'Банк');
    await tapAmount('10000');
    await user.click(interestToggle());
    await user.type(rateField(), '24');
    await user.type(termField(), '12');
    await waitFor(() => expect(interestField().value).toMatch(/1\s?347,15/));

    await user.clear(interestField());
    await user.type(interestField(), '1500');
    expect(text(screen.getByRole('dialog', { name: 'Новый долг' }))).toContain('Введено вручную');
    await user.clear(termField());
    await user.type(termField(), '24');
    expect(interestField().value).toMatch(/1\s?500/); // срок изменился, а введённая сумма осталась
    expect(previewLine('Всего к возврату')).toBe(fmt(1_150_000));
    expect(previewLine('Платёж в месяц')).toBe(fmt(47_917)); // вручную введённые проценты: сумма с процентами поровну на 24 месяца, вверх (без «≈»)

    await user.click(button('Сохранить'));
    await closed('Новый долг');
    expect((await storeOf(td).db.debts.toArray())[0]).toMatchObject({ interestMinor: 150_000, interestRateBp: 2400, termMonths: 24 });
  });

  it('только сумма процентов из договора — без ставки и срока', async () => {
    const td = await show('/debts');
    await openNew();
    await user.type(screen.getByRole('textbox', { name: 'У кого я взял' }), 'Банк');
    await tapAmount('10000');
    await user.click(interestToggle());
    await user.type(interestField(), '1200');
    await user.click(button('Сохранить'));
    await closed('Новый долг');
    expect((await storeOf(td).db.debts.toArray())[0]).toMatchObject({ interestMinor: 120_000, interestRateBp: null, termMonths: null });
  });

  it('проценты включены, но не указаны: сказано, что ввести; ничего не сохранилось', async () => {
    const td = await show('/debts');
    await openNew();
    await user.type(screen.getByRole('textbox', { name: 'У кого я взял' }), 'Банк');
    await tapAmount('10000');
    await user.click(interestToggle());
    await user.click(button('Сохранить'));
    await waitFor(() => expect(text(screen.getByRole('dialog', { name: 'Новый долг' }))).toContain('Укажите проценты'));
    expect(await storeOf(td).db.debts.count()).toBe(0);
  });

  it('нечитаемая ставка и срок подсвечены, долг не создаётся', async () => {
    const td = await show('/debts');
    await openNew();
    await user.type(screen.getByRole('textbox', { name: 'У кого я взял' }), 'Банк');
    await tapAmount('10000');
    await user.click(interestToggle());
    await user.type(rateField(), 'abc');
    await user.type(termField(), '1,5');
    await user.type(interestField(), '100');
    await user.click(button('Сохранить'));
    const dlg = await findByRole('dialog', { name: 'Новый долг' });
    await waitFor(() => expect(text(dlg)).toContain('Ставка — число'));
    expect(text(dlg)).toContain('Срок — целое число месяцев');
    expect(await storeOf(td).db.debts.count()).toBe(0);
  });

  it('у человека уже есть долг: с процентами предложение «добавить к нему» не показывается — это отдельный договор', async () => {
    await show('/debts', { debt: { direction: 'borrowed', counterparty: 'Банк', principalMinor: 100_000 } });
    await openNew();
    await user.type(screen.getByRole('textbox', { name: 'У кого я взял' }), 'Банк');
    await waitFor(() => expect(document.querySelector('[data-testid="debt-match"]')).not.toBeNull());
    await user.click(interestToggle());
    await waitFor(() => expect(document.querySelector('[data-testid="debt-match"]')).toBeNull());
    await user.click(interestToggle());
    await waitFor(() => expect(document.querySelector('[data-testid="debt-match"]')).not.toBeNull());
  });
});

describe('страница долга с процентами', () => {
  it('сумма долга, проценты со ставкой и сроком, «всего к возврату» и остаток от суммы с процентами', async () => {
    await show(`/debts/${DEBT_ID}`, { debt: CREDIT });
    expect(remaining()).toBe(fmt(1_134_715));
    expect(line('Сумма долга')).toBe(fmt(1_000_000));
    expect(line('Проценты')).toContain(fmt(134_715));
    expect(line('Проценты')).toContain('24 % годовых · 12 месяцев');
    expect(line('Всего к возврату')).toBe(fmt(1_134_715));
  });

  it('платёж уменьшает остаток с процентами; вернули только сумму долга — долг не погашен', async () => {
    await show(`/debts/${DEBT_ID}`, {
      debt: CREDIT,
      setup: async (s, cash) => void (await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1_000_000, occurredOn: '2026-10-10', debtId: DEBT_ID })),
    });
    expect(remaining()).toBe(fmt(134_715));
    expect(screen.queryByText('Погашен')).toBeNull();
  });

  it('долг без процентов выглядит как раньше: строк «Проценты» и «Всего к возврату» нет', async () => {
    await show(`/debts/${DEBT_ID}`, { debt: { direction: 'lent', principalMinor: 50_000 } });
    expect(remaining()).toBe(fmt(50_000));
    expect(Array.from(document.querySelectorAll('dt')).map((x) => text(x))).not.toContain('Проценты');
    expect(Array.from(document.querySelectorAll('dt')).map((x) => text(x))).not.toContain('Всего к возврату');
  });
});

describe('правка долга: проценты', () => {
  const openEdit = async () => {
    await user.click(button('Править'));
    return findByRole('dialog', { name: 'Правка долга' });
  };

  it('форма показывает сохранённые проценты, ставку и срок; смена ставки пересчитывает проценты; остаток обновляется', async () => {
    const td = await show(`/debts/${DEBT_ID}`, { debt: CREDIT });
    await openEdit();
    expect(interestToggle().checked).toBe(true);
    expect(rateField().value).toBe('24');
    expect(termField().value).toBe('12');
    expect(interestField().value).toMatch(/1\s?347,15/);
    await user.clear(rateField());
    await user.type(rateField(), '30');
    await waitFor(() => expect(interestField().value).not.toMatch(/1\s?347,15/));
    await user.click(button('Сохранить'));
    await closed('Правка долга');
    const saved = (await storeOf(td).db.debts.get(DEBT_ID))!;
    expect(saved).toMatchObject({ principalMinor: 1_000_000, interestRateBp: 3000, termMonths: 12 });
    expect(saved.interestMinor).toBeGreaterThan(134_715);
    await waitFor(() => expect(remaining()).toBe(fmt(1_000_000 + saved.interestMinor!)));
  });

  it('проценты, введённые по договору (не из ставки и срока), при открытии не пересчитываются сами', async () => {
    await show(`/debts/${DEBT_ID}`, { debt: { ...CREDIT, interestMinor: 150_000 } });
    await openEdit();
    expect(interestField().value).toMatch(/1\s?500/);
    expect(text(screen.getByRole('dialog', { name: 'Правка долга' }))).toContain('Введено вручную');
  });

  it('снять галочку «Есть проценты»: проценты, ставка и срок убираются, остаток — только сумма долга', async () => {
    const td = await show(`/debts/${DEBT_ID}`, { debt: CREDIT });
    await openEdit();
    await user.click(interestToggle());
    await user.click(button('Сохранить'));
    await closed('Правка долга');
    expect(await storeOf(td).db.debts.get(DEBT_ID)).toMatchObject({ interestMinor: null, interestRateBp: null, termMonths: null });
    await waitFor(() => expect(remaining()).toBe(fmt(1_000_000)));
  });

  it('добавить проценты к обычному долгу', async () => {
    const td = await show(`/debts/${DEBT_ID}`, { debt: { direction: 'borrowed', counterparty: 'Банк', principalMinor: 1_000_000 } });
    await openEdit();
    expect(interestToggle().checked).toBe(false);
    await user.click(interestToggle());
    await user.type(rateField(), '24');
    await user.type(termField(), '12');
    await waitFor(() => expect(interestField().value).toMatch(/1\s?347,15/));
    await user.click(button('Сохранить'));
    await closed('Правка долга');
    expect(await storeOf(td).db.debts.get(DEBT_ID)).toMatchObject({ interestMinor: 134_715, interestRateBp: 2400, termMonths: 12 });
    await waitFor(() => expect(remaining()).toBe(fmt(1_134_715)));
  });

  it('правка суммы долга пересчитывает проценты, пока они не введены руками; деньги идут за суммой долга, а не за процентами', async () => {
    const td = await show(`/debts/${DEBT_ID}`, { debt: CREDIT });
    await openEdit();
    for (let i = 0; i < 5; i++) await user.click(button('Стереть'));
    await tapAmount('20000');
    await waitFor(() => expect(interestField().value).toMatch(/2\s?694,\d\d/));
    await user.click(button('Сохранить'));
    await closed('Правка долга');
    const s = storeOf(td);
    const saved = (await s.db.debts.get(DEBT_ID))!;
    expect(saved.principalMinor).toBe(2_000_000);
    expect(Math.abs(saved.interestMinor! - 269_430)).toBeLessThanOrEqual(10);
    // выданная деньгами сумма выросла ровно на разницу сумм долга
    const issued = (await s.db.transactions.toArray()).filter((t) => t.debtId === DEBT_ID && t.deletedAt === null);
    expect(issued.reduce((sum, t) => sum + t.amountMinor, 0)).toBe(2_000_000);
  });
});

describe('кредит и остальные окна долга', () => {
  it('«Платить частями»: кнопка «По договору» подставляет платёж из суммы с процентами и срока', async () => {
    await show(`/debts/${DEBT_ID}`, { debt: CREDIT });
    await chooseMenuAction('Платить частями');
    await findByRole('dialog', { name: 'Платить частями' });
    const contract = document.querySelector<HTMLElement>('[data-testid="parts-contract"]')!;
    expect(text(contract)).toBe(`По договору — ${fmt(94_560)}`); // (10 000 + 1 347,15) / 12 месяцев, вверх
    await user.click(contract);
    await waitFor(() => expect(text(document.querySelector('[data-testid="payoff-preview"]'))).toContain('12 платежей'));
  });

  it('без срока или без процентов кнопки «По договору» нет', async () => {
    await show(`/debts/${DEBT_ID}`, { debt: { ...CREDIT, interestRateBp: null, termMonths: null } });
    await chooseMenuAction('Платить частями');
    await findByRole('dialog', { name: 'Платить частями' });
    expect(document.querySelector('[data-testid="parts-contract"]')).toBeNull();
  });

  it('«Взял ещё в долг»: остаток растёт на сумму пополнения, а проценты остаются прежними — об этом сказано', async () => {
    await show(`/debts/${DEBT_ID}`, { debt: CREDIT });
    await chooseMenuAction('Взял ещё в долг');
    const dlg = await findByRole('dialog', { name: 'Взял ещё в долг' });
    await tapAmount('1000');
    expect(text(dlg)).toContain(`Проценты ${fmt(134_715)} остаются прежними`);
    expect(text(document.querySelector('[data-testid="topup-remaining"]'))).toBe(`Остаток станет ${fmt(1_234_715)}`);
  });
});
