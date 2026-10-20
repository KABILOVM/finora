import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import {
  choose,
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
import { useLocation } from 'react-router-dom';
import DebtsPage from './DebtsPage';

/** Строка запроса адреса (?dir=…): по ней видно, какую вкладку записало приложение. */
function SearchProbe() {
  return <p data-testid="search">{useLocation().search}</p>;
}
const search = () => document.querySelector('[data-testid="search"]')?.textContent ?? '';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const text = (el: Element | null) => norm(el?.textContent);

type Setup = (s: Store) => Promise<unknown>;
const quiet = (setup?: Setup) => (setup ? async (s: Store) => void (await setup(s)) : undefined);

async function openPage(setup?: Setup, path = '/debts', tables = [table()]) {
  const td = opsDeps(tables, { setup: quiet(setup) });
  await showApp(
    <>
      <DebtsPage />
      <LocationProbe />
      <SearchProbe />
    </>,
    td,
    path,
  );
  await findByRole('heading', { name: 'Долги', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const cashOf = async (s: Store) => (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
const lend = (s: Store, over: Partial<Parameters<Store['debts']['create']>[0]> = {}) =>
  s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', ...over });
const rowLink = (name: string) => screen.getByRole('link', { name: new RegExp(`^${name}`) });
const walletBalance = async (td: OpsDeps) => {
  const { computeBalances } = await import('@/domain/balances');
  const s = storeOf(td);
  const wallets = (await s.db.wallets.toArray()).filter((w) => w.deletedAt === null);
  return computeBalances(wallets, await s.db.transactions.toArray());
};

describe('экран «Долги»: пустые состояния', () => {
  it('«Мне должны»: понятный призыв, а не пустота', async () => {
    await openPage();
    expect(screen.getByRole('heading', { name: 'Вам пока никто не должен' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Записать долг' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Новый долг' })).toBeTruthy();
    expect(document.querySelector('[data-testid="debts-totals"]')).toBeNull();
  });

  it('«Я должен»: свой текст', async () => {
    await openPage();
    await user.click(screen.getByRole('radio', { name: 'Я должен' }));
    expect(screen.getByRole('heading', { name: 'Вы никому не должны' })).toBeTruthy();
  });

  it('долги другого направления не мешают: «Я должен» пусто, хотя «Мне должны» есть', async () => {
    await openPage(lend);
    expect(rowLink('Алишер')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Я должен' }));
    expect(screen.getByRole('heading', { name: 'Вы никому не должны' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Алишер/ })).toBeNull();
  });
});

describe('экран «Долги»: список', () => {
  it('строка: имя, остаток из суммы долга минус платежи, полоса и слова о погашении', async () => {
    await openPage(async (s) => {
      const cash = await cashOf(s);
      const d = await lend(s);
      await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 20_000, occurredOn: '2026-10-05', debtId: d.id });
    });
    const row = rowLink('Алишер');
    expect(text(row)).toContain(fmt(30_000));
    expect(text(row)).toContain('Возвращено 40%');
    expect(text(row)).toContain(`из ${fmt(50_000)}`);
    expect(screen.getByRole('progressbar', { name: 'Алишер: Возвращено 40%' }).getAttribute('aria-valuenow')).toBe('40');
    expect(row.getAttribute('href')).toMatch(/^\/debts\//);
  });

  it('итог каждой валюты отдельно, без сложения разных валют', async () => {
    await openPage(async (s) => {
      await lend(s, { counterparty: 'Алишер', principalMinor: 50_000 });
      await lend(s, { counterparty: 'Бобур', principalMinor: 70_000 });
      await lend(s, { counterparty: 'Джон', principalMinor: 20_000, currency: 'USD' });
    });
    const totals = document.querySelector('[data-testid="debts-totals"]');
    const lines = Array.from(totals!.querySelectorAll('li')).map((li) => text(li));
    expect(lines).toEqual([fmt(120_000), fmt(20_000, 'USD')]);
    expect(text(totals)).toContain('Валюты не складываем');
  });

  it('срок словами: «через N дней», «завтра», «просрочен на N дня» — просрочка с тревожным значком', async () => {
    await openPage(async (s) => {
      await lend(s, { counterparty: 'Скоро', dueOn: '2026-10-20' });
      await lend(s, { counterparty: 'Завтра', dueOn: '2026-10-16' });
      await lend(s, { counterparty: 'Давно', dueOn: '2026-10-12' });
      await lend(s, { counterparty: 'Бессрочный' });
    });
    expect(text(rowLink('Скоро'))).toContain('Срок 20.10.2026 · через 5 дней');
    expect(text(rowLink('Завтра'))).toContain('завтра');
    const late = rowLink('Давно');
    expect(text(late)).toContain('Просрочен на 3 дня (срок был 12.10.2026)');
    expect(late.querySelector('svg')).not.toBeNull(); // не только цвет: ещё и значок
    expect(late.querySelector('.text-danger')).not.toBeNull();
    expect(text(rowLink('Бессрочный'))).toContain('Без срока');
    expect(text(document.querySelector('[data-testid="debts-totals"]'))).toContain('Просрочено: 1 долг');
    // порядок: ближайший срок первым (просроченный — самый первый), без срока — в конце
    const names = screen.getAllByRole('link').map((a) => text(a.querySelector('.line-clamp-2')));
    expect(names).toEqual(['Давно', 'Завтра', 'Скоро', 'Бессрочный']);
  });

  it('закрытые свёрнуты и не входят в итог; раскрываются по кнопке', async () => {
    await openPage(async (s) => {
      await lend(s, { counterparty: 'Открытый', principalMinor: 10_000 });
      const closed = await lend(s, { counterparty: 'Закрытый', principalMinor: 99_000 });
      await s.debts.close(closed.id);
    });
    expect(screen.queryByRole('link', { name: /Закрытый/ })).toBeNull();
    expect(text(document.querySelector('[data-testid="debts-totals"]'))).toContain(fmt(10_000));
    const fold = screen.getByRole('button', { name: 'Закрытые · 1' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    await user.click(fold);
    expect(text(rowLink('Закрытый'))).toContain('Закрыт');
  });

  it('архив: долг скрыт, его можно вернуть кнопкой', async () => {
    const td = await openPage(async (s) => {
      const d = await lend(s, { counterparty: 'Старый' });
      await s.debts.archive(d.id);
    });
    expect(screen.getByRole('heading', { name: 'Вам пока никто не должен' }) ?? null).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Архив · 1' }));
    await user.click(screen.getByRole('button', { name: 'Вернуть из архива: Старый' }));
    await eventually(async () => {
      expect((await storeOf(td).db.debts.toArray())[0]?.archivedAt).toBeNull();
    });
    await findByRole('link', { name: /^Старый/ });
  });

  it('переполнение суммы в одном долге не роняет экран: у него честное сообщение, остальные целы', async () => {
    await openPage(async (s) => {
      const cash = await cashOf(s);
      const big = await lend(s, { counterparty: 'Огромный', principalMinor: 1_000_000_000_000_000 });
      for (let i = 0; i < 10; i++) {
        await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 1_000_000_000_000_000, occurredOn: '2026-10-05', debtId: big.id });
      }
      await lend(s, { counterparty: 'Нормальный', principalMinor: 5_000 });
    });
    expect(text(rowLink('Огромный'))).toContain('слишком большие');
    expect(text(rowLink('Нормальный'))).toContain(fmt(5_000));
  });
});

describe('шит «Новый долг»', () => {
  const open = async () => {
    await user.click(screen.getByRole('button', { name: 'Новый долг' }));
    return findByRole('dialog', { name: 'Новый долг' });
  };
  const name = (v: string) => user.type(screen.getByRole('textbox', { name: /^(Кому я дал|У кого я взял)$/ }), v);
  const save = () => user.click(screen.getByRole('button', { name: 'Сохранить' }));

  it('«Я дал» с движением денег (по умолчанию включено): долг, расход с кошелька, остаток уменьшился', async () => {
    const td = await openPage(async (s) => {
      await s.transactions.create({ kind: 'income', walletId: await cashOf(s), amountMinor: 100_000, occurredOn: '2026-10-01' });
    });
    await open();
    expect(screen.getByRole('checkbox', { name: 'Записать движение денег' }).hasAttribute('checked') || (screen.getByRole('checkbox', { name: 'Записать движение денег' }) as HTMLInputElement).checked).toBe(true);
    await name('  Алишер ');
    await tapAmount('500');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый долг' })).toBeNull());
    const s = storeOf(td);
    const debt = (await s.db.debts.toArray())[0]!;
    expect(debt).toMatchObject({ counterparty: 'Алишер', direction: 'lent', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-15', dueOn: null });
    const txs = (await s.db.transactions.toArray()).filter((t) => t.debtId === debt.id);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ kind: 'expense', amountMinor: 50_000, categoryId: null, occurredOn: '2026-10-15', walletId: await cashOf(s) });
    expect((await walletBalance(td)).get(await cashOf(s))).toBe(50_000);
    expect(text(await findByRole('link', { name: /^Алишер/ }))).toContain(fmt(50_000));
  });

  it('галочку можно снять: долг «на бумаге», остатки кошельков не меняются', async () => {
    const td = await openPage();
    await open();
    await user.click(screen.getByRole('checkbox', { name: 'Записать движение денег' }));
    expect(text(screen.getByRole('dialog', { name: 'Новый долг' }))).toContain('Долг запишется «на бумаге»');
    expect(screen.queryByRole('group', { name: 'Кошелёк' })).toBeNull();
    await name('Алишер');
    await tapAmount('500');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый долг' })).toBeNull());
    expect(await storeOf(td).db.transactions.count()).toBe(0);
    expect(await storeOf(td).db.debts.count()).toBe(1);
  });

  it('нет кошелька в такой валюте: предложено «на бумаге» с пояснением, галочка недоступна', async () => {
    const td = await openPage();
    await open();
    choose('Валюта', 'USD — Доллар США');
    const note = await waitFor(() => document.querySelector('[data-testid="debt-paper-note"]')!);
    expect(text(note)).toContain('Нет кошелька в валюте USD');
    expect(text(note)).toContain('«на бумаге»');
    expect((screen.getByRole('checkbox', { name: 'Записать движение денег' }) as HTMLInputElement).disabled).toBe(true);
    await name('Джон');
    await tapAmount('20');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый долг' })).toBeNull());
    const s = storeOf(td);
    expect((await s.db.debts.toArray())[0]).toMatchObject({ currency: 'USD', principalMinor: 2_000 });
    expect(await s.db.transactions.count()).toBe(0);
  });

  const usdWallet = async (s: Store) => {
    await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 100_000, color: '#2563eb', icon: '💲' });
  };

  it('кошелёк в долларах: курс взят из сервиса и записан снимком в операцию', async () => {
    const td = await openPage(usdWallet);
    await open();
    choose('Валюта', 'USD — Доллар США');
    await name('Джон');
    await tapAmount('20');
    expect(text(await waitFor(() => document.querySelector('[data-testid="fx-notice"]')!))).toContain('Курс: 1 $ = 10,9 с.');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый долг' })).toBeNull());
    const tx = (await storeOf(td).db.transactions.toArray())[0]!;
    expect(tx).toMatchObject({ kind: 'expense', amountMinor: 2_000, baseCurrency: 'TJS', baseAmountMinor: 21_800, fxRate: 10.9, fxSource: 'nbt' });
  });

  it('курса нет совсем: без введённого курса не сохранить, с курсом — запись с ручным курсом', async () => {
    const td = await openPage(usdWallet, '/debts', []);
    await open();
    choose('Валюта', 'USD — Доллар США');
    await name('Джон');
    await tapAmount('20');
    await save();
    expect(text(screen.getByRole('dialog', { name: 'Новый долг' }))).toContain('Курса пока нет — введите его');
    expect(await storeOf(td).db.debts.count()).toBe(0);
    await user.type(screen.getByRole('textbox', { name: /^Курс:/ }), '10,9');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый долг' })).toBeNull());
    expect((await storeOf(td).db.transactions.toArray())[0]).toMatchObject({ fxRate: 10.9, fxSource: 'manual', baseAmountMinor: 21_800 });
  });

  it('пустое имя и нет суммы: ошибки у полей, ничего не записано', async () => {
    const td = await openPage();
    await open();
    await save();
    expect(text(screen.getByRole('dialog', { name: 'Новый долг' }))).toContain('Укажите, кому вы дали');
    expect(text(screen.getByRole('dialog', { name: 'Новый долг' }))).toContain('Введите сумму долга');
    expect(await storeOf(td).db.debts.count()).toBe(0);
  });

  it('«Я взял»: подписи меняются, деньги поступают на кошелёк доходом', async () => {
    const td = await openPage();
    await open();
    await user.click(screen.getByRole('radio', { name: 'Я взял в долг' }));
    await name('Банк');
    await tapAmount('1000');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый долг' })).toBeNull());
    const s = storeOf(td);
    expect((await s.db.debts.toArray())[0]).toMatchObject({ direction: 'borrowed', counterparty: 'Банк' });
    expect((await s.db.transactions.toArray())[0]).toMatchObject({ kind: 'income', amountMinor: 100_000 });
    // экран переключился на «Я должен» и показывает новый долг
    expect(screen.getByRole('radio', { name: 'Я должен' }).getAttribute('aria-checked')).toBe('true');
    await findByRole('link', { name: /^Банк/ });
  });

  it('срок возврата раньше даты долга — понятная ошибка, ничего не записано', async () => {
    const td = await openPage();
    await open();
    await name('Алишер');
    await tapAmount('500');
    await user.click(screen.getByRole('button', { name: 'Указать срок' }));
    setDateInput(document.querySelector('input[type="date"][aria-label="Срок возврата: календарь"]') as HTMLElement, '2026-10-10');
    await save();
    expect(text(screen.getByRole('dialog', { name: 'Новый долг' }))).toContain('Срок возврата не может быть раньше даты долга (15.10.2026)');
    expect(await storeOf(td).db.debts.count()).toBe(0);
  });

  it('срок и заметка сохраняются; в списке срок словами', async () => {
    const td = await openPage();
    await open();
    await name('Алишер');
    await tapAmount('500');
    await user.click(screen.getByRole('button', { name: 'Указать срок' }));
    setDateInput(document.querySelector('input[type="date"][aria-label="Срок возврата: календарь"]') as HTMLElement, '2026-10-20');
    await user.type(screen.getByRole('textbox', { name: 'Заметка' }), 'на ремонт');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый долг' })).toBeNull());
    expect((await storeOf(td).db.debts.toArray())[0]).toMatchObject({ dueOn: '2026-10-20', note: 'на ремонт' });
    expect(text(await findByRole('link', { name: /^Алишер/ }))).toContain('через 5 дней');
  });
});

describe('экран «Долги»: какая вкладка открывается', () => {
  const borrow = (s: Store, over: Partial<Parameters<Store['debts']['create']>[0]> = {}) => lend(s, { direction: 'borrowed', counterparty: 'Банк', ...over });
  const tab = (name: string) => screen.getByRole('radio', { name });

  it('адрес без вкладки и открытые долги только у «Я должен» — сразу «Я должен», без пустого экрана', async () => {
    await openPage(async (s) => void (await borrow(s)));
    expect(tab('Я должен').getAttribute('aria-checked')).toBe('true');
    expect(rowLink('Банк')).toBeTruthy();
  });

  it('адрес без вкладки и долги «Мне должны» есть — «Мне должны»', async () => {
    await openPage(async (s) => {
      await lend(s);
      await borrow(s);
    });
    expect(tab('Мне должны').getAttribute('aria-checked')).toBe('true');
  });

  it('вкладка названа в адресе — остаётся, даже пустая: «Мне должны» не перескакивает сама', async () => {
    await openPage(async (s) => void (await borrow(s)), '/debts?dir=lent');
    expect(tab('Мне должны').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Вам пока никто не должен' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Банк/ })).toBeNull();
  });

  it('мусор вместо вкладки в адресе (?dir=что-то) — как будто вкладки нет: выбор по данным', async () => {
    await openPage(async (s) => void (await borrow(s)), '/debts?dir=мусор');
    expect(tab('Я должен').getAttribute('aria-checked')).toBe('true');
  });

  it('нажатие на вкладку пишет её в адрес, «Мне должны» тоже', async () => {
    await openPage(async (s) => void (await borrow(s)));
    await user.click(tab('Мне должны'));
    await waitFor(() => expect(search()).toBe('?dir=lent'));
    expect(screen.getByRole('heading', { name: 'Вам пока никто не должен' })).toBeTruthy();
    await user.click(tab('Я должен'));
    await waitFor(() => expect(search()).toBe('?dir=borrowed'));
  });
});

describe('экран «Долги»: погашенные, но не закрытые', () => {
  const paidDebt = async (s: Store, counterparty: string) => {
    const cash = await cashOf(s);
    const d = await lend(s, { counterparty, principalMinor: 5_000 });
    await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 5_000, occurredOn: '2026-10-05', debtId: d.id });
    return d;
  };

  it('выплаченный долг уходит из открытых в раздел «Погашены» с кнопкой «Закрыть»; итог «Вам должны всего» его не включает', async () => {
    await openPage(async (s) => {
      await lend(s, { counterparty: 'Бобур', principalMinor: 30_000 });
      await paidDebt(s, 'Алишер');
    });
    const open = screen.getByRole('list', { name: 'Мне должны' });
    expect(open.textContent).toContain('Бобур');
    expect(open.textContent).not.toContain('Алишер');
    const settled = document.querySelector('[data-testid="debts-settled"]')!;
    expect(text(settled)).toContain('Погашены · 1');
    expect(settled.textContent).toContain('Алишер');
    expect(screen.getByRole('button', { name: 'Закрыть погашенный долг' }).textContent).toBe('Закрыть');
    expect(text(document.querySelector('[data-testid="debts-totals"]'))).toContain(fmt(30_000));
  });

  it('«Закрыть все» закрывает все погашенные; «Отменить» открывает их снова', async () => {
    const td = await openPage(async (s) => {
      await paidDebt(s, 'Алишер');
      await paidDebt(s, 'Бобур');
    });
    expect(text(document.querySelector('[data-testid="debts-settled"]'))).toContain('Погашены · 2');
    await user.click(screen.getByRole('button', { name: 'Закрыть все погашенные долги: 2' }));
    await waitFor(() => expect(document.querySelector('[data-testid="debts-settled"]')).toBeNull());
    const debts = await storeOf(td).db.debts.toArray();
    expect(debts.every((d) => d.closedAt !== null)).toBe(true);
    expect(screen.getByRole('button', { name: /Закрытые · 2/ })).toBeTruthy();
    await user.click(await findByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(text(document.querySelector('[data-testid="debts-settled"]'))).toContain('Погашены · 2'));
    expect((await storeOf(td).db.debts.toArray()).every((d) => d.closedAt === null)).toBe(true);
  });

  it('когда есть только погашенные, «Открытых долгов нет» не пишем: раздел «Погашены» сам всё объясняет', async () => {
    await openPage(async (s) => void (await paidDebt(s, 'Алишер')));
    expect(screen.queryByText('Открытых долгов нет.')).toBeNull();
    expect(document.querySelector('[data-testid="debts-settled"]')).not.toBeNull();
  });
});

describe('экран «Долги»: «Закрыть все» при частичном сбое', () => {
  it('один долг закрыть не удалось — остальные закрыты, сказано «2 из 3», «Отменить» открывает закрытые снова', async () => {
    const td = await openPage(async (s) => {
      const cash = await cashOf(s);
      for (const name of ['Алишер', 'Бобур', 'Вали']) {
        const d = await lend(s, { counterparty: name, principalMinor: 5_000 });
        await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 5_000, occurredOn: '2026-10-05', debtId: d.id });
      }
    });
    const store = storeOf(td);
    const real = store.debts.close.bind(store.debts);
    const bobur = (await store.db.debts.toArray()).find((d) => d.counterparty === 'Бобур')!;
    vi.spyOn(store.debts, 'close').mockImplementation((id: string) => (id === bobur.id ? Promise.reject(new Error('сбой')) : real(id)));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Закрыть все погашенные долги: 3' }));
    await waitFor(() => expect(document.body.textContent).toContain('Закрыто долгов: 2 из 3. Остальные закрыть не удалось.'));
    const closed = (await store.db.debts.toArray()).filter((d) => d.closedAt !== null).map((d) => d.counterparty).sort();
    expect(closed).toEqual(['Алишер', 'Вали']);
    await waitFor(() => expect(text(document.querySelector('[data-testid="debts-settled"]'))).toContain('Погашены · 1')); // Бобур остался
    vi.restoreAllMocks();
    await user.click(await findByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(text(document.querySelector('[data-testid="debts-settled"]'))).toContain('Погашены · 3'));
  });
});
