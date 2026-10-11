import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, write } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { formatMinor } from '@/domain/money';
import {
  chipLabels,
  currentPath,
  LocationProbe,
  opsDeps,
  pinToday,
  setDateInput,
  showApp,
  storeOf,
  table,
  tapAmount,
  unpinToday,
  type OpsDeps,
} from '@/features/transactions/__fixtures__/opsKit';
import DebtDetailPage from './DebtDetailPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const DEBT_ID = '0d6c0d3e-5a3b-4f43-9c59-7b4b0d3a1111';
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const text = (el: Element | null) => norm(el?.textContent);

interface Ids {
  cash: string;
  usd: string;
}
type DebtInput = Parameters<Store['debts']['create']>[0];
type Setup = (s: Store, ids: Ids) => Promise<unknown>;

interface Options {
  debt?: Partial<DebtInput>;
  /** false — долг «на бумаге»: без исходной операции. */
  issue?: boolean;
  tables?: ReturnType<typeof table>[];
  id?: string;
}

/**
 * Кошельки: «Наличные» (из затравки) с 1 000 с. дохода и «Доллары» (1 000 $). Долг «Алишер» 500 с., выдан 1 октября:
 * деньгами с «Наличных» (расход 500 с. с debtId), если issue !== false.
 */
async function show(setup?: Setup, opts: Options = {}) {
  const ids: Ids = { cash: '', usd: '' };
  const td = opsDeps(opts.tables ?? [table()], {
    setup: async (s) => {
      ids.cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
      ids.usd = (await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 100_000, color: '#2563eb', icon: '💲' })).id;
      await s.transactions.create({ kind: 'income', walletId: ids.cash, amountMinor: 100_000, occurredOn: '2026-09-30' });
      const d = await s.debts.create(
        { direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', ...opts.debt },
        { id: DEBT_ID },
      );
      if (opts.issue !== false && d.currency === 'TJS') {
        await s.transactions.create({
          kind: d.direction === 'lent' ? 'expense' : 'income',
          walletId: ids.cash,
          amountMinor: d.principalMinor,
          occurredOn: '2026-10-01',
          debtId: d.id,
        });
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
    `/debts/${opts.id ?? DEBT_ID}`,
  );
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return { td, ids };
}

const balances = async (td: OpsDeps) => {
  const s = storeOf(td);
  const wallets = (await s.db.wallets.toArray()).filter((w) => w.deletedAt === null);
  return computeBalances(wallets, await s.db.transactions.toArray());
};
const remaining = () => text(document.querySelector('[data-testid="debt-remaining"]'));
const debtTxs = async (td: OpsDeps) => (await storeOf(td).db.transactions.toArray()).filter((t) => t.debtId === DEBT_ID);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const eraseAmount = async (times: number) => {
  for (let i = 0; i < times; i++) await user.click(button('Стереть'));
};
const pay = (s: Store, walletId: string, amountMinor: number, occurredOn = '2026-10-05', over: Record<string, unknown> = {}) =>
  s.transactions.create({ kind: 'income', walletId, amountMinor, occurredOn, debtId: DEBT_ID, ...over });
const line = (label: string): string => {
  const dt = Array.from(document.querySelectorAll('dt')).find((x) => text(x) === label);
  return text(dt?.nextElementSibling ?? null);
};
/** Кнопка внутри окна подтверждения (на странице есть кнопки с теми же словами). */
const inAlert = (title: string, name: string): HTMLElement => {
  const dlg = screen.getByRole('alertdialog', { name: title });
  const hit = Array.from(dlg.querySelectorAll('button')).find((b) => text(b) === name);
  if (!hit) throw new Error(`В окне «${title}» нет кнопки «${name}»`);
  return hit;
};
const openPayment = async () => {
  await user.click(button('Добавить платёж'));
  return findByRole('dialog', { name: 'Платёж по долгу' });
};
const amountField = () => screen.getByRole('textbox', { name: /^Сумма/ }) as HTMLInputElement;
const closed = (name: string) => waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeNull());

describe('страница долга: экраны без данных', () => {
  it('«Долг не найден» — понятный экран со ссылкой к списку, а не белый экран', async () => {
    await show(undefined, { id: '11111111-1111-4111-8111-111111111111' });
    expect(screen.getByRole('heading', { name: 'Долг не найден' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'К списку долгов' })[0]?.getAttribute('href')).toBe('/debts');
  });

  it('мусорный адрес тоже не роняет страницу', async () => {
    await show(undefined, { id: 'не-uuid' });
    expect(screen.getByRole('heading', { name: 'Долг не найден' })).toBeTruthy();
  });

  it('суммы слишком большие: честный экран «Не удалось посчитать»', async () => {
    await show(async (s, ids) => {
      for (let i = 0; i < 10; i++) await pay(s, ids.cash, 1_000_000_000_000_000);
    });
    expect(screen.getByRole('heading', { name: 'Не удалось посчитать' })).toBeTruthy();
    expect(text(document.body)).toContain('Суммы по долгу слишком большие, проверьте данные');
  });
});

describe('страница долга: что видно', () => {
  it('остаток крупно, оплачено, срок словами, выдача деньгами, заметка и платежи списком', async () => {
    await show(async (s, ids) => void (await pay(s, ids.cash, 20_000, '2026-10-05', { note: 'аванс' })), {
      debt: { dueOn: '2026-10-12', note: 'на ремонт' },
    });
    expect(remaining()).toBe(fmt(30_000));
    expect(text(document.querySelector('[data-testid="debt-summary"]'))).toContain('Вам ещё должны');
    expect(text(document.querySelector('[data-testid="debt-summary"]'))).toContain('Возвращено 40%');
    expect(line('Сумма долга')).toBe(fmt(50_000));
    expect(line('Оплачено')).toBe(fmt(20_000));
    expect(line('Срок возврата')).toContain('12.10.2026');
    expect(line('Срок возврата')).toContain('Просрочен на 3 дня');
    expect(line('Выдано деньгами')).toBe(fmt(50_000));
    expect(line('Заметка')).toBe('на ремонт');
    expect(screen.queryByText('Переплата')).toBeNull();
    const row = text(screen.getByRole('list', { name: 'Платежи по долгу' }));
    expect(row).toContain('Наличные · аванс');
    expect(row).toContain(fmt(20_000));
  });

  it('долг «на бумаге»: сказано словами, что деньги не двигались; платежей нет — понятная подсказка', async () => {
    await show(undefined, { issue: false });
    expect(line('Выдано деньгами')).toContain('Деньги не двигались');
    expect(text(document.body)).toContain('Платежей пока нет');
  });

  it('«я должен»: подписи другие', async () => {
    await show(undefined, { debt: { direction: 'borrowed' } });
    expect(text(document.querySelector('[data-testid="debt-summary"]'))).toContain('Вы ещё должны');
    expect(line('Получено деньгами')).toBe(fmt(50_000));
    expect(text(document.body)).toContain('Я должен · TJS');
  });
});

describe('страница долга: платежи', () => {
  it('сумма по умолчанию — весь остаток; частичный платёж меняет остаток долга и кошелька, но не расходы', async () => {
    const { td, ids } = await show();
    const dlg = await openPayment();
    expect(amountField().value).toBe('500');
    await eraseAmount(3);
    await tapAmount('200');
    expect(text(dlg)).toContain(`После платежа останется ${fmt(30_000)}`);
    await user.click(button('Записать платёж'));
    await closed('Платёж по долгу');
    await waitFor(() => expect(remaining()).toBe(fmt(30_000)));
    const payment = (await debtTxs(td)).find((t) => t.kind === 'income')!;
    expect(payment).toMatchObject({ amountMinor: 20_000, walletId: ids.cash, categoryId: null, occurredOn: '2026-10-15', note: '' });
    expect((await balances(td)).get(ids.cash)).toBe(70_000); // 1 000 − 500 выдано + 200 вернули
    expect(text(screen.getByRole('list', { name: 'Платежи по долгу' }))).toContain('Сегодня');
  });

  it('«Подставить весь остаток» возвращает полную сумму', async () => {
    await show();
    await openPayment();
    await eraseAmount(3);
    await tapAmount('100');
    await user.click(button('Подставить весь остаток'));
    expect(amountField().value).toBe('500');
  });

  it('больше остатка — только после «Это переплата»; платёж записан полностью, остаток 0, переплата видна', async () => {
    const { td } = await show();
    const dlg = await openPayment();
    await eraseAmount(3);
    await tapAmount('600');
    expect(text(screen.getByRole('group', { name: 'Переплата' }))).toContain(`Платёж больше остатка на ${fmt(10_000)}`);
    await user.click(button('Записать платёж'));
    expect(text(dlg)).toContain('Платёж больше остатка. Если это переплата');
    expect((await debtTxs(td)).filter((t) => t.kind === 'income')).toHaveLength(0);
    await user.click(screen.getByRole('checkbox', { name: 'Это переплата — записать платёж полностью' }));
    await user.click(button('Записать платёж'));
    await closed('Платёж по долгу');
    await waitFor(() => expect(remaining()).toBe(fmt(0)));
    expect(line('Переплата')).toBe(fmt(10_000));
    expect(text(document.querySelector('[data-testid="debt-summary"]'))).toContain('Погашен');
    expect((await debtTxs(td)).filter((t) => t.kind === 'income')[0]?.amountMinor).toBe(60_000);
  });

  it('подтверждение переплаты сбрасывается при изменении суммы: опечатка «6000» не пройдёт на старой галочке', async () => {
    const { td } = await show();
    await openPayment();
    await eraseAmount(3);
    await tapAmount('600');
    const box = () => screen.getByRole('checkbox', { name: 'Это переплата — записать платёж полностью' }) as HTMLInputElement;
    await user.click(box());
    expect(box().checked).toBe(true);
    await tapAmount('0');
    expect(box().checked).toBe(false);
    await user.click(button('Записать платёж'));
    expect((await debtTxs(td)).filter((t) => t.kind === 'income')).toHaveLength(0);
  });

  it('точно весь остаток — не переплата', async () => {
    await show();
    await openPayment();
    expect(screen.queryByRole('group', { name: 'Переплата' })).toBeNull();
  });

  it('платёж раньше даты долга — понятная ошибка', async () => {
    const { td } = await show();
    const dlg = await openPayment();
    await user.click(button('Другая дата'));
    setDateInput(document.querySelector('input[type="date"][aria-label="Дата платежа: календарь"]') as HTMLElement, '2026-09-30');
    await user.click(button('Записать платёж'));
    expect(text(dlg)).toContain('Платёж не может быть раньше даты долга (01.10.2026)');
    expect((await debtTxs(td)).filter((t) => t.kind === 'income')).toHaveLength(0);
  });

  it('нет кошелька в валюте долга: объяснение, платёж записать нельзя', async () => {
    await show(undefined, { debt: { currency: 'EUR' }, issue: false });
    const dlg = await openPayment();
    expect(text(dlg)).toContain('Нет кошелька в валюте EUR');
    expect((button('Записать платёж') as HTMLButtonElement).disabled).toBe(true);
  });

  it('долг в долларах: платёж идёт в долларовый кошелёк, курс записан снимком', async () => {
    const { td, ids } = await show(undefined, { debt: { currency: 'USD', principalMinor: 10_000 }, issue: false });
    await openPayment();
    expect(amountField().value).toBe('100');
    expect(text(screen.getByRole('dialog', { name: 'Платёж по долгу' }))).toContain('Курс: 1 $ = 10,9 с.');
    await user.click(button('Записать платёж'));
    await closed('Платёж по долгу');
    const tx = (await debtTxs(td))[0]!;
    expect(tx).toMatchObject({ walletId: ids.usd, amountMinor: 10_000, baseAmountMinor: 109_000, fxRate: 10.9, fxSource: 'nbt' });
  });

  it('кошелёк другой валюты в платёж выбрать нельзя: в списке только кошельки валюты долга', async () => {
    await show();
    await openPayment();
    expect(chipLabels('Кошелёк')).toEqual(['Наличные']);
  });

  it('удаление платежа: подтверждение, остаток вернулся; «Отменить» возвращает платёж', async () => {
    const { td } = await show(async (s, ids) => void (await pay(s, ids.cash, 20_000, '2026-10-05')));
    expect(remaining()).toBe(fmt(30_000));
    await user.click(button(`Удалить платёж от 05.10.2026 на ${fmt(20_000)}`));
    expect(text(await findByRole('alertdialog', { name: 'Удалить платёж?' }))).toContain('остаток долга и остаток кошелька пересчитаются');
    await user.click(inAlert('Удалить платёж?', 'Удалить'));
    await waitFor(() => expect(remaining()).toBe(fmt(50_000)));
    const row = (await debtTxs(td)).find((t) => t.kind === 'income')!;
    expect(row.deletedAt).not.toBeNull(); // мягкое удаление: строка на месте
    expect((await balances(td)).get((await storeOf(td).db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id)).toBe(50_000);
    await user.click(await waitFor(() => button('Отменить')));
    await waitFor(() => expect(remaining()).toBe(fmt(30_000)));
  });
});

describe('страница долга: закрыть, открыть, архив', () => {
  it('закрыть долг (с пояснением, что остаток останется в истории) и открыть снова', async () => {
    const { td } = await show();
    await user.click(button('Закрыть долг'));
    expect(text(await findByRole('alertdialog', { name: 'Закрыть долг?' }))).toContain(`Остаток ${fmt(50_000)}`);
    await user.click(inAlert('Закрыть долг?', 'Закрыть долг'));
    await waitFor(() => expect(text(document.querySelector('[data-testid="debt-summary"]'))).toContain('Закрыт'));
    expect((await storeOf(td).db.debts.get(DEBT_ID))?.closedAt).not.toBeNull();
    expect(remaining()).toBe(fmt(50_000)); // остаток не обнулён: он считается из операций
    await user.click(button('Открыть снова'));
    await eventually(async () => expect((await storeOf(td).db.debts.get(DEBT_ID))?.closedAt).toBeNull());
    await findByRole('button', { name: 'Закрыть долг' });
  });

  it('в архив: долг скрыт из списка, возврат кнопкой «Вернуть» в уведомлении', async () => {
    const { td } = await show();
    await user.click(button('В архив'));
    await eventually(async () => expect((await storeOf(td).db.debts.get(DEBT_ID))?.archivedAt).not.toBeNull());
    await findByRole('status');
    expect(currentPath()).toBe('/debts');
    await user.click(await waitFor(() => button('Вернуть')));
    await eventually(async () => expect((await storeOf(td).db.debts.get(DEBT_ID))?.archivedAt).toBeNull());
  });

  it('долг в архиве открывается по ссылке: платёж добавить нельзя, есть «Вернуть из архива»', async () => {
    const { td } = await show(async (s) => void (await s.debts.archive(DEBT_ID)));
    expect(screen.queryByRole('button', { name: 'Добавить платёж' })).toBeNull();
    expect(text(document.body)).toContain('Долг в архиве');
    await user.click(button('Вернуть из архива'));
    await eventually(async () => expect((await storeOf(td).db.debts.get(DEBT_ID))?.archivedAt).toBeNull());
    await findByRole('button', { name: 'Добавить платёж' });
  });
});

describe('страница долга: правка', () => {
  it('есть операции: направление и валюта закреплены словами; имя, срок, сумма и заметка меняются', async () => {
    const { td } = await show();
    await user.click(button('Править'));
    const dlg = await findByRole('dialog', { name: 'Правка долга' });
    expect(text(document.querySelector('[data-testid="debt-locked"]'))).toContain('Направление и валюту нельзя менять');
    expect(screen.queryByRole('radiogroup', { name: 'Направление долга' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Валюта' })).toBeNull();
    const nameField = screen.getByRole('textbox', { name: 'Кому я дал' });
    await user.clear(nameField);
    await user.type(nameField, 'Алишер Р.');
    await eraseAmount(3);
    await tapAmount('700');
    await user.click(button('Указать срок'));
    setDateInput(document.querySelector('input[type="date"][aria-label="Срок возврата: календарь"]') as HTMLElement, '2026-11-01');
    await user.type(screen.getByRole('textbox', { name: 'Заметка' }), 'на ремонт');
    await user.click(within(dlg, 'Сохранить'));
    await closed('Правка долга');
    expect(await storeOf(td).db.debts.get(DEBT_ID)).toMatchObject({ counterparty: 'Алишер Р.', principalMinor: 70_000, dueOn: '2026-11-01', note: 'на ремонт', direction: 'lent', currency: 'TJS' });
    await waitFor(() => expect(remaining()).toBe(fmt(70_000)));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Алишер Р.');
  });

  it('операций нет: направление можно сменить', async () => {
    const { td } = await show(undefined, { issue: false });
    await user.click(button('Править'));
    await findByRole('dialog', { name: 'Правка долга' });
    expect(document.querySelector('[data-testid="debt-locked"]')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Я взял в долг' }));
    await user.click(button('Сохранить'));
    await closed('Правка долга');
    expect((await storeOf(td).db.debts.get(DEBT_ID))?.direction).toBe('borrowed');
  });

  it('срок убирается кнопкой «Без срока»', async () => {
    const { td } = await show(undefined, { debt: { dueOn: '2026-11-01' }, issue: false });
    await user.click(button('Править'));
    await findByRole('dialog', { name: 'Правка долга' });
    await user.click(button('Без срока'));
    await user.click(button('Сохранить'));
    await closed('Правка долга');
    expect((await storeOf(td).db.debts.get(DEBT_ID))?.dueOn).toBeNull();
  });

  it('сумма меньше уже оплаченного: сказано, что появится переплата', async () => {
    await show(async (s, ids) => void (await pay(s, ids.cash, 30_000)));
    await user.click(button('Править'));
    const dlg = await findByRole('dialog', { name: 'Правка долга' });
    expect(text(dlg)).toContain(`Уже оплачено ${fmt(30_000)}`);
    expect(text(dlg)).not.toContain('с..');
    await eraseAmount(3);
    await tapAmount('200');
    expect(text(dlg)).toContain('это больше новой суммы, появится переплата');
  });

  it('без изменений ничего не пишется', async () => {
    const { td } = await show();
    const before = await storeOf(td).db.debts.get(DEBT_ID);
    await user.click(button('Править'));
    const dlg = await findByRole('dialog', { name: 'Правка долга' });
    await user.click(within(dlg, 'Сохранить'));
    await closed('Правка долга');
    expect((await storeOf(td).db.debts.get(DEBT_ID))?.clientUpdatedAt).toBe(before?.clientUpdatedAt);
  });
});

describe('страница долга: честное предупреждение об операциях, не вошедших в остаток', () => {
  it('платёж в кошельке другой валюты не входит в остаток; предупреждение с кнопкой «Открыть»', async () => {
    await show(async (s, ids) => {
      const p = await pay(s, ids.cash, 20_000);
      await s.db.transactions.update(p.id, { walletId: ids.usd }); // так могла прийти старая или чужая запись
    });
    expect(remaining()).toBe(fmt(50_000));
    const issues = document.querySelector('[data-testid="debt-issues"]');
    expect(text(issues)).toContain('Часть операций не вошла в остаток');
    expect(text(issues)).toContain('Операция в USD, а долг в TJS: в остаток не входит');
    await user.click(screen.getByRole('button', { name: /^Открыть операцию:/ }));
    expect(currentPath()).toMatch(/^\/edit\//);
  });

  it('предупреждение появляется само, когда запись приходит со стороны', async () => {
    const { td, ids } = await show();
    expect(document.querySelector('[data-testid="debt-issues"]')).toBeNull();
    await write(async () => {
      const p = await pay(storeOf(td), ids.cash, 1_000);
      await storeOf(td).db.transactions.update(p.id, { walletId: ids.usd });
    });
    await waitFor(() => expect(document.querySelector('[data-testid="debt-issues"]')).not.toBeNull());
  });
});

function within(root: HTMLElement, name: string): HTMLElement {
  const hit = Array.from(root.querySelectorAll('button')).find((b) => text(b) === name);
  if (!hit) throw new Error(`В окне нет кнопки «${name}»`);
  return hit;
}
