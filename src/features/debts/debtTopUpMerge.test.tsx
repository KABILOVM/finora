import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { formatMinor } from '@/domain/money';
import {
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
import DebtsPage from './DebtsPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const DEBT_ID = '0d6c0d3e-5a3b-4f43-9c59-7b4b0d3a1111';
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const text = (el: Element | null) => norm(el?.textContent);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const findTid = (id: string) => waitFor(() => tid(id)!);
/** Строка предпросмотра объединения по подписи: «Остаток» → «750 с.». */
const previewRow = (label: string): string => {
  const dt = Array.from(document.querySelectorAll('[data-testid="merge-preview"] dt')).find((x) => text(x) === label);
  return text(dt?.nextElementSibling ?? null);
};
const dateInput = (label: string) => document.querySelector(`input[type="date"][aria-label="${label}"]`) as HTMLElement;

type Setup = (s: Store, ids: { cash: string }) => Promise<unknown>;

/** «Наличные» с 1 000 с.; долг «Алишер» 500 с. («мне должны», выдан 1 октября деньгами с «Наличных»). */
async function seed(s: Store, setup?: Setup) {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
  await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 100_000, occurredOn: '2026-09-30' });
  const d = await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' }, { id: DEBT_ID });
  await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 50_000, occurredOn: '2026-10-01', debtId: d.id });
  await setup?.(s, { cash });
  return cash;
}

async function showDetail(setup?: Setup) {
  let cash = '';
  const td = opsDeps([table()], {
    setup: async (s) => {
      cash = await seed(s, setup);
    },
  });
  await showApp(
    <>
      <Routes>
        <Route path="/debts/:id" element={<DebtDetailPage />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <LocationProbe />
    </>,
    td,
    `/debts/${DEBT_ID}`,
  );
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return { td, cash: () => cash };
}

const remaining = () => text(document.querySelector('[data-testid="debt-remaining"]'));
const balanceOf = async (td: OpsDeps, walletId: string) => {
  const s = storeOf(td);
  const wallets = (await s.db.wallets.toArray()).filter((w) => w.deletedAt === null);
  return computeBalances(wallets, await s.db.transactions.toArray()).get(walletId);
};
const debtOf = (td: OpsDeps, id = DEBT_ID) => storeOf(td).db.debts.get(id);
const issueTxs = async (td: OpsDeps) => (await storeOf(td).db.transactions.toArray()).filter((t) => t.debtId === DEBT_ID && t.kind === 'expense');

const openTopUp = async () => {
  await user.click(button('Дал ещё в долг'));
  return findByRole('dialog', { name: 'Дал ещё в долг' });
};
const gone = (name: string) => waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeNull());

describe('«Добавить ещё в долг» на странице долга', () => {
  it('сумма долга растёт, выдача — расход с кошелька, остаток и кошелёк пересчитаны, в списке «Выдачи и пополнения» две строки', async () => {
    const { td, cash } = await showDetail();
    expect(screen.queryByRole('heading', { name: 'Выдачи и пополнения' })).toBeNull(); // пока одна выдача — отдельного списка нет
    const dlg = await openTopUp();
    expect(text(dlg)).toContain(`сумма долга сейчас ${fmt(50_000)}, остаток ${fmt(50_000)}`);
    expect(text(dlg)).not.toContain('..'); // «500 с.» уже кончается точкой
    await tapAmount('300');
    expect(text(dlg)).toContain(`Сумма долга станет ${fmt(80_000)}`);
    await user.click(button('Добавить к долгу'));
    await gone('Дал ещё в долг');
    await waitFor(() => expect(remaining()).toBe(fmt(80_000)));
    expect(await debtOf(td)).toMatchObject({ principalMinor: 80_000, openedOn: '2026-10-01' });
    const tx = (await issueTxs(td)).find((t) => t.amountMinor === 30_000)!;
    expect(tx).toMatchObject({ kind: 'expense', walletId: cash(), categoryId: null, occurredOn: '2026-10-15', note: '' });
    expect(await balanceOf(td, cash())).toBe(20_000); // 1 000 − 500 − 300
    const list = screen.getByRole('list', { name: 'Выдачи и пополнения долга' });
    expect(Array.from(list.querySelectorAll('li')).map((li) => text(li))).toEqual([
      expect.stringContaining(fmt(30_000)),
      expect.stringContaining(fmt(50_000)),
    ]);
  });

  it('заметка записывается к операции пополнения', async () => {
    const { td } = await showDetail();
    await openTopUp();
    await tapAmount('100');
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'ещё на запчасти');
    await user.click(button('Добавить к долгу'));
    await gone('Дал ещё в долг');
    expect((await issueTxs(td)).find((t) => t.amountMinor === 10_000)?.note).toBe('ещё на запчасти');
  });

  it('«на бумаге»: сумма растёт, кошелёк не меняется, операции нет', async () => {
    const { td, cash } = await showDetail();
    await openTopUp();
    await user.click(screen.getByRole('checkbox', { name: 'Записать движение денег' }));
    expect(text(screen.getByRole('dialog', { name: 'Дал ещё в долг' }))).toContain('Пополнение запишется «на бумаге»');
    await tapAmount('200');
    await user.click(button('Добавить к долгу'));
    await gone('Дал ещё в долг');
    await waitFor(() => expect(remaining()).toBe(fmt(70_000)));
    expect(await issueTxs(td)).toHaveLength(1);
    expect(await balanceOf(td, cash())).toBe(50_000);
  });

  it('закрытый долг после пополнения открыт снова', async () => {
    await showDetail(async (s) => void (await s.debts.close(DEBT_ID)));
    expect(screen.getByRole('button', { name: 'Открыть снова' })).toBeTruthy();
    const dlg = await openTopUp();
    expect(text(dlg)).toContain('Долг закрыт — после пополнения он откроется снова');
    await tapAmount('100');
    await user.click(button('Добавить к долгу'));
    await gone('Дал ещё в долг');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Закрыть долг' })).toBeTruthy());
  });

  it('«я должен»: свои слова, деньги поступают на кошелёк доходом', async () => {
    const { td, cash } = await showDetail(async (s) => {
      await s.db.transactions.clear();
      await s.debts.update(DEBT_ID, { direction: 'borrowed' });
    });
    await user.click(button('Взял ещё в долг'));
    const dlg = await findByRole('dialog', { name: 'Взял ещё в долг' });
    expect(text(dlg)).toContain('Сколько ещё взяли');
    await tapAmount('250');
    await user.click(button('Добавить к долгу'));
    await gone('Взял ещё в долг');
    const tx = (await storeOf(td).db.transactions.toArray()).find((t) => t.debtId === DEBT_ID)!;
    expect(tx).toMatchObject({ kind: 'income', amountMinor: 25_000, walletId: cash() });
  });

  it('без суммы не сохранить: сказано словами, ничего не записано', async () => {
    const { td } = await showDetail();
    const dlg = await openTopUp();
    await user.click(button('Добавить к долгу'));
    expect(text(dlg)).toContain('Введите сумму пополнения');
    expect((await debtOf(td))!.principalMinor).toBe(50_000);
    expect(await issueTxs(td)).toHaveLength(1);
  });

  it('дата раньше даты долга не принимается', async () => {
    const { td } = await showDetail();
    const dlg = await openTopUp();
    await tapAmount('100');
    await user.click(button('Другая дата'));
    setDateInput(dateInput('Дата пополнения: календарь'), '2026-09-01');
    await user.click(button('Добавить к долгу'));
    expect(text(dlg)).toContain('Пополнение не может быть раньше даты долга (01.10.2026)');
    expect((await debtOf(td))!.principalMinor).toBe(50_000);
  });

  it('срок: можно указать новый — он сохраняется, прежний не трогается, если его не меняли', async () => {
    const { td } = await showDetail(async (s) => void (await s.debts.update(DEBT_ID, { dueOn: '2026-10-10' }))); // уже просрочен
    await openTopUp();
    await tapAmount('100');
    await user.click(button('Добавить к долгу')); // срок не менялся: просроченный срок пополнению не мешает
    await gone('Дал ещё в долг');
    expect((await debtOf(td))!.dueOn).toBe('2026-10-10');

    await openTopUp();
    await tapAmount('100');
    setDateInput(dateInput('Срок возврата: календарь'), '2026-12-01');
    await user.click(button('Добавить к долгу'));
    await gone('Дал ещё в долг');
    expect(await debtOf(td)).toMatchObject({ principalMinor: 70_000, dueOn: '2026-12-01' });
  });

  it('кнопки нет у долга в архиве', async () => {
    await showDetail(async (s) => void (await s.debts.archive(DEBT_ID)));
    expect(screen.queryByRole('button', { name: 'Дал ещё в долг' })).toBeNull();
  });
});

describe('«Объединить» на странице долга', () => {
  /** Второй долг того же человека (в другом регистре и с «ё»/«е») на 300 с. и долг «Бобур» на 100 с. */
  const withOthers: Setup = async (s, { cash }) => {
    const d2 = await s.debts.create({ direction: 'lent', counterparty: 'АЛИШЕР', principalMinor: 30_000, currency: 'TJS', openedOn: '2026-10-03', dueOn: '2026-11-01' });
    await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 30_000, occurredOn: '2026-10-03', debtId: d2.id });
    await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 5_000, occurredOn: '2026-10-08', debtId: d2.id });
    await s.debts.create({ direction: 'lent', counterparty: 'Бобур', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-10-04' });
  };
  const openMerge = async () => {
    // кнопка появляется, когда прочитаны все долги (для списка кандидатов): сразу после показа страницы её ещё может не быть
    await user.click(await waitFor(() => button('Объединить…')));
    return findByRole('dialog', { name: 'Объединить долги' });
  };

  it('других подходящих долгов нет — кнопки нет', async () => {
    await showDetail();
    expect(screen.queryByRole('button', { name: 'Объединить…' })).toBeNull();
  });

  it('долг другого направления или валюты в кандидаты не попадает', async () => {
    await showDetail(async (s) => {
      await s.debts.create({ direction: 'borrowed', counterparty: 'Алишер', principalMinor: 100, currency: 'TJS', openedOn: '2026-10-01' });
      await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 100, currency: 'USD', openedOn: '2026-10-01' });
    });
    expect(screen.queryByRole('button', { name: 'Объединить…' })).toBeNull();
  });

  it('одноимённый долг отмечен заранее, чужой — нет; предпросмотр: сумма, оплачено, остаток, ближайший срок', async () => {
    await showDetail(withOthers);
    const dlg = await openMerge();
    const same = screen.getByRole('checkbox', { name: /^АЛИШЕР от 03\.10\.2026/ }) as HTMLInputElement;
    const other = screen.getByRole('checkbox', { name: /^Бобур/ }) as HTMLInputElement;
    expect(same.checked).toBe(true);
    expect(other.checked).toBe(false);
    expect(text(dlg)).toContain('тот же человек');
    expect(previewRow('Сумма долга')).toBe(fmt(80_000));
    expect(previewRow('Оплачено')).toBe(fmt(5_000));
    expect(previewRow('Остаток')).toBe(fmt(75_000));
    expect(previewRow('Срок')).toBe('01.11.2026');
    await user.click(other);
    expect(previewRow('Сумма долга')).toBe(fmt(90_000));
    expect(button(/^Объединить: 3 долга$/)).toBeTruthy();
  });

  it('объединение: один долг с общей суммой, второй исчез, платежи и кошелёк целы; «Отменить» возвращает всё', async () => {
    const { td, cash } = await showDetail(withOthers);
    const before = await balanceOf(td, cash());
    await openMerge();
    await user.click(button(/^Объединить: 2 долга$/));
    await gone('Объединить долги');
    await waitFor(() => expect(remaining()).toBe(fmt(75_000)));
    const s = storeOf(td);
    const live = (await s.db.debts.toArray()).filter((d) => d.deletedAt === null);
    expect(live.map((d) => d.counterparty).sort()).toEqual(['Алишер', 'Бобур']);
    expect(await debtOf(td)).toMatchObject({ principalMinor: 80_000, openedOn: '2026-10-01', dueOn: '2026-11-01' });
    expect(await balanceOf(td, cash())).toBe(before);
    expect(screen.getByRole('list', { name: 'Платежи по долгу' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Выдачи и пополнения долга' }).querySelectorAll('li')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(remaining()).toBe(fmt(50_000)));
    expect((await s.db.debts.toArray()).filter((d) => d.deletedAt === null)).toHaveLength(3);
    expect(await debtOf(td)).toMatchObject({ principalMinor: 50_000, dueOn: null });
  });

  it('переплата одного долга засчитывается в остаток других — об этом предупреждено', async () => {
    await showDetail(async (s, { cash }) => {
      const d2 = await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-10-03' });
      await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 15_000, occurredOn: '2026-10-08', debtId: d2.id }); // переплата 50
    });
    await openMerge();
    expect(tid('merge-netted')).not.toBeNull();
    expect(previewRow('Остаток')).toBe(fmt(45_000));
  });

  it('снять все галочки — объединить нельзя', async () => {
    await showDetail(withOthers);
    await openMerge();
    await user.click(screen.getByRole('checkbox', { name: /^АЛИШЕР от 03\.10\.2026/ }));
    expect((button('Выберите долги') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-testid="merge-preview"]')).toBeNull();
  });
});

describe('новый долг тому же человеку: предложение «добавить к существующему»', () => {
  async function openDebts(setup?: Setup) {
    let cash = '';
    const td = opsDeps([table()], {
      setup: async (s) => {
        cash = await seed(s, setup);
      },
    });
    await showApp(
      <>
        <DebtsPage />
        <LocationProbe />
      </>,
      td,
      '/debts',
    );
    await findByRole('heading', { name: 'Долги', level: 1 });
    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
    return { td, cash: () => cash };
  }
  const openNew = async () => {
    await user.click(screen.getByRole('button', { name: 'Новый долг' }));
    return findByRole('dialog', { name: 'Новый долг' });
  };
  const nameField = () => screen.getByRole('textbox', { name: /^(Кому я дал|У кого я взял)$/ });

  it('имя совпало (регистр, лишние пробелы, ё/е не важны): плашка с остатком; «Добавить к этому долгу» — пополнение, а не второй долг', async () => {
    const { td, cash } = await openDebts();
    await openNew();
    expect(tid('debt-match')).toBeNull();
    await user.type(nameField(), '  алишёр ');
    const banner = await findTid('debt-match'); // «алишёр» = «Алишер»: регистр, пробелы по краям и ё/е не важны
    expect(text(banner)).toContain('У вас уже есть долг «Алишер»');
    expect(text(banner)).toContain(`Остаток ${fmt(50_000)}`);
    await user.click(within(banner, 'Добавить к долгу «Алишер» от 01.10.2026'));
    expect(text(tid('debt-joined')!)).toContain('Сумма добавится к долгу «Алишер»');
    expect(text(tid('debt-joined')!)).not.toContain('..');
    expect(tid('debt-match')).toBeNull();
    await tapAmount('300');
    await user.click(button('Добавить к долгу'));
    await gone('Ещё в долг');
    const s = storeOf(td);
    expect(await s.db.debts.count()).toBe(1);
    expect(await debtOf(td)).toMatchObject({ principalMinor: 80_000, counterparty: 'Алишер' });
    expect((await issueTxs(td)).find((t) => t.amountMinor === 30_000)).toMatchObject({ walletId: cash(), occurredOn: '2026-10-15' });
    expect(await balanceOf(td, cash())).toBe(20_000);
    expect(text(await findByRole('link', { name: /^Алишер/ }))).toContain(fmt(80_000));
  });

  it('«Создать отдельный долг» прячет плашку, и долг создаётся как обычно', async () => {
    const { td } = await openDebts();
    await openNew();
    await user.type(nameField(), 'Алишер');
    const banner = await findTid('debt-match');
    await user.click(within(banner, 'Создать отдельный долг'));
    expect(tid('debt-match')).toBeNull();
    await tapAmount('100');
    await user.click(button('Сохранить'));
    await gone('Новый долг');
    expect(await storeOf(td).db.debts.count()).toBe(2);
  });

  it('после выбора можно передумать: «Создать отдельный долг» в блоке добавления', async () => {
    const { td } = await openDebts();
    await openNew();
    await user.type(nameField(), 'Алишер');
    await user.click(within(await findTid('debt-match'), /^Добавить к долгу/));
    await user.click(within(tid('debt-joined')!, 'Создать отдельный долг'));
    expect(tid('debt-joined')).toBeNull();
    expect(tid('debt-match')).toBeNull();
    await tapAmount('100');
    await user.click(button('Сохранить'));
    await gone('Новый долг');
    expect(await storeOf(td).db.debts.count()).toBe(2);
  });

  it('другое направление, другая валюта и другой человек не предлагаются', async () => {
    await openDebts();
    await openNew();
    await user.type(nameField(), 'Бобур');
    expect(tid('debt-match')).toBeNull();
    await user.clear(nameField());
    await user.type(nameField(), 'Алишер');
    expect(tid('debt-match')!).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Я взял в долг' }));
    expect(tid('debt-match')).toBeNull();
  });

  it('несколько долгов с одним человеком: список на выбор, и пополнение идёт в выбранный', async () => {
    const { td } = await openDebts(async (s) => {
      await s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 20_000, currency: 'TJS', openedOn: '2026-10-05' });
    });
    await openNew();
    await user.type(nameField(), 'Алишер');
    const banner = await findTid('debt-match');
    expect(text(banner)).toContain('У вас уже есть долги с «Алишер»');
    expect(banner.querySelectorAll('li')).toHaveLength(2);
    await user.click(within(banner, 'Добавить к долгу «Алишер» от 05.10.2026'));
    await tapAmount('50');
    await user.click(button('Добавить к долгу'));
    await gone('Ещё в долг');
    const rows = (await storeOf(td).db.debts.toArray()).sort((a, b) => a.openedOn.localeCompare(b.openedOn));
    expect(rows.map((d) => d.principalMinor)).toEqual([50_000, 25_000]);
  });

  it('дата пополнения раньше даты существующего долга — ошибка, ничего не записано', async () => {
    const { td } = await openDebts();
    await openNew();
    await user.type(nameField(), 'Алишер');
    await user.click(within(await findTid('debt-match'), /^Добавить к долгу/));
    await tapAmount('100');
    await user.click(button('Другая дата'));
    setDateInput(dateInput('Дата пополнения: календарь'), '2026-09-01');
    await user.click(button('Добавить к долгу'));
    expect(text(screen.getByRole('dialog', { name: 'Ещё в долг' }))).toContain('Пополнение не может быть раньше даты долга (01.10.2026)');
    expect((await debtOf(td))!.principalMinor).toBe(50_000);
  });
});

/** Кнопка внутри блока: по имени (строка — точное, регулярка — по маске). */
function within(root: HTMLElement, name: string | RegExp): HTMLElement {
  const hit = Array.from(root.querySelectorAll('button')).find((b) => {
    const label = b.getAttribute('aria-label') ?? text(b);
    return typeof name === 'string' ? label === name || text(b) === name : name.test(label) || name.test(text(b));
  });
  if (!hit) throw new Error(`В блоке нет кнопки «${String(name)}»`);
  return hit;
}
