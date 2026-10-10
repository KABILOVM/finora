import fc from 'fast-check';
import { LOCAL_USER_ID } from '@/auth/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventually, makeTestDeps, pick, renderAppRoot, write, type TestDeps } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { ValidationError } from '@/db';
import { computeBalances } from '@/domain/balances';
import { formatMinor } from '@/domain/money';
import type { RateTable, Transaction } from '@/domain/types';
import { createRateService } from '@/rates/service';
import { createMemoryRateStorage } from '@/rates/storage';
import { reconcileWallet } from './reconcile';
import { computeWalletsTotal } from './walletTotals';
import { cleanName, sameName } from './walletUi';
import WalletsPage from './WalletsPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

afterEach(() => vi.restoreAllMocks());

// ───────────────────────── чистые функции ─────────────────────────

type TxIn = Pick<Transaction, 'kind' | 'walletId' | 'toWalletId' | 'amountMinor' | 'toAmountMinor' | 'deletedAt'>;
const tx = (over: Partial<TxIn>): TxIn => ({
  kind: 'expense',
  walletId: 'w1',
  toWalletId: null,
  amountMinor: 100,
  toAmountMinor: null,
  deletedAt: null,
  ...over,
});

describe('reconcileWallet', () => {
  const w = { id: 'w1', openingBalanceMinor: 100_000 };

  it('начальный + доходы − расходы + переводы на − переводы с', () => {
    const r = reconcileWallet(w, [
      tx({ kind: 'income', amountMinor: 50_000 }),
      tx({ kind: 'expense', amountMinor: 12_345 }),
      tx({ kind: 'expense', amountMinor: 5 }),
      tx({ kind: 'transfer', walletId: 'w2', toWalletId: 'w1', amountMinor: 10_000, toAmountMinor: 109_000 }),
      tx({ kind: 'transfer', walletId: 'w1', toWalletId: 'w2', amountMinor: 20_000, toAmountMinor: 2_000 }),
    ]);
    expect(r).toMatchObject({
      openingMinor: 100_000,
      incomeMinor: 50_000,
      incomeCount: 1,
      expenseMinor: 12_350,
      expenseCount: 2,
      transferInMinor: 109_000,
      transferInCount: 1,
      transferOutMinor: 20_000,
      transferOutCount: 1,
      skipped: 0,
    });
    expect(r.totalMinor).toBe(100_000 + 50_000 - 12_350 + 109_000 - 20_000);
  });

  it('удалённые и чужие операции не считаются, битые суммы пропускаются и подсчитываются', () => {
    const r = reconcileWallet(w, [
      tx({ kind: 'income', amountMinor: 500, deletedAt: '2026-10-01T00:00:00.000Z' }),
      tx({ kind: 'expense', walletId: 'w9', amountMinor: 700 }),
      tx({ kind: 'expense', amountMinor: 0 }),
      tx({ kind: 'expense', amountMinor: 1.5 }),
      tx({ kind: 'income', amountMinor: -3 }),
    ]);
    expect(r.totalMinor).toBe(100_000);
    expect(r.skipped).toBe(3);
  });

  it('перевод без toAmountMinor зачисляет ту же сумму (как computeBalances)', () => {
    const r = reconcileWallet({ id: 'w2', openingBalanceMinor: 0 }, [
      tx({ kind: 'transfer', walletId: 'w1', toWalletId: 'w2', amountMinor: 700, toAmountMinor: null }),
    ]);
    expect(r.transferInMinor).toBe(700);
  });

  it('переполнение — RangeError, а не молчаливая неточность', () => {
    expect(() =>
      reconcileWallet({ id: 'w1', openingBalanceMinor: Number.MAX_SAFE_INTEGER }, [tx({ kind: 'income', amountMinor: 10 })]),
    ).toThrow(RangeError);
  });

  it('СВОЙСТВО: итог всегда равен computeBalances для любого набора операций', () => {
    const walletIds = ['w1', 'w2', 'w3'];
    const txArb = fc.record({
      kind: fc.constantFrom('expense', 'income', 'transfer') as fc.Arbitrary<Transaction['kind']>,
      walletId: fc.constantFrom(...walletIds),
      toWalletId: fc.option(fc.constantFrom(...walletIds), { nil: null }),
      amountMinor: fc.oneof(fc.integer({ min: -5, max: 10_000_000 }), fc.constant(1.5)),
      toAmountMinor: fc.option(fc.integer({ min: -5, max: 10_000_000 }), { nil: null }),
      deletedAt: fc.option(fc.constant('2026-10-01T00:00:00.000Z'), { nil: null }),
    });
    fc.assert(
      fc.property(fc.array(txArb, { maxLength: 40 }), fc.integer({ min: -1_000_000, max: 1_000_000 }), (txs, opening) => {
        const wallets = walletIds.map((id) => ({ id, openingBalanceMinor: opening }));
        const expected = computeBalances(wallets, txs);
        for (const wallet of wallets) {
          expect(reconcileWallet(wallet, txs).totalMinor).toBe(expected.get(wallet.id));
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('computeWalletsTotal', () => {
  const lookup = (table: Record<string, { rate: number; stale?: boolean; asOf?: string }>) => (from: string) => {
    const hit = table[from];
    return hit ? { rate: hit.rate, source: 'nbt', asOf: hit.asOf ?? '2026-10-10', stale: hit.stale ?? false, manual: false } : null;
  };
  const balances = new Map([
    ['a', 100_000],
    ['b', 10_000],
    ['c', 5_000],
  ]);

  it('все кошельки в базовой валюте: итог точный, без «≈»', () => {
    const t = computeWalletsTotal([{ id: 'a', currency: 'TJS' }], balances, 'TJS', lookup({}));
    expect(t).toEqual({ totalMinor: 100_000, missing: [], approximate: false, stale: [] });
  });

  it('иностранная валюта пересчитывается по курсу и помечается приблизительной', () => {
    const t = computeWalletsTotal(
      [{ id: 'a', currency: 'TJS' }, { id: 'b', currency: 'USD' }],
      balances,
      'TJS',
      lookup({ USD: { rate: 10.9 } }),
    );
    expect(t?.totalMinor).toBe(100_000 + 109_000);
    expect(t?.approximate).toBe(true);
    expect(t?.missing).toEqual([]);
  });

  it('валюта без курса не входит в итог и перечисляется', () => {
    const t = computeWalletsTotal(
      [{ id: 'a', currency: 'TJS' }, { id: 'b', currency: 'USD' }, { id: 'c', currency: 'EUR' }],
      balances,
      'TJS',
      lookup({ EUR: { rate: 12 } }),
    );
    expect(t?.missing).toEqual(['USD']);
    expect(t?.totalMinor).toBe(100_000 + 60_000);
    expect(t?.approximate).toBe(true);
  });

  it('если курса нет ни у одной иностранной валюты, «≈» не нужен (итог точен, но неполон)', () => {
    const t = computeWalletsTotal([{ id: 'a', currency: 'TJS' }, { id: 'b', currency: 'USD' }], balances, 'TJS', lookup({}));
    expect(t?.approximate).toBe(false);
    expect(t?.missing).toEqual(['USD']);
  });

  it('устаревшие курсы перечисляются', () => {
    const t = computeWalletsTotal(
      [{ id: 'b', currency: 'USD' }],
      balances,
      'TJS',
      lookup({ USD: { rate: 10.9, stale: true, asOf: '2026-10-01' } }),
    );
    expect(t?.stale).toEqual([{ currency: 'USD', asOf: '2026-10-01' }]);
  });

  it('переполнение → null, а не неверная сумма', () => {
    const big = new Map([
      ['a', Number.MAX_SAFE_INTEGER],
      ['b', Number.MAX_SAFE_INTEGER],
    ]);
    expect(
      computeWalletsTotal([{ id: 'a', currency: 'TJS' }, { id: 'b', currency: 'TJS' }], big, 'TJS', lookup({})),
    ).toBeNull();
  });

  it('архивные кошельки в итог не передаются вызывающим (здесь — только то, что дали)', () => {
    expect(computeWalletsTotal([], balances, 'TJS', lookup({}))).toEqual({ totalMinor: 0, missing: [], approximate: false, stale: [] });
  });
});

// ───────────────────────── экран ─────────────────────────

const usdTable: RateTable = {
  asOf: '2026-10-10',
  pivot: 'TJS',
  perUnit: { TJS: 1, USD: 10.9 },
  source: 'nbt',
  fetchedAt: '2026-10-10T08:00:00.000Z',
};

function depsWithRates(table?: RateTable, today = new Date('2026-10-10T12:00:00.000Z')): TestDeps {
  const td = makeTestDeps();
  td.deps.createRates = () =>
    createRateService({
      providers: [],
      storage: createMemoryRateStorage(
        table ? { v: 1, tables: [table], manual: {}, lastRefreshAt: null, lastAttemptAt: null, lastError: null } : undefined,
      ),
      now: () => today,
    });
  return td;
}

async function openPage(td: TestDeps = makeTestDeps()) {
  renderAppRoot(<WalletsPage />, { deps: td.deps });
  await findByRole('heading', { name: 'Кошельки', level: 1 });
  await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument());
  return td;
}

const store = (td: TestDeps) => {
  const s = td.stores[0];
  if (!s) throw new Error('Хранилище не открыто');
  return s;
};

describe('экран «Кошельки»', () => {
  it('показывает кошелёк из затравки с остатком в его валюте и итог «Всего»', async () => {
    const td = await openPage();
    expect(screen.getByText('Наличные')).toBeInTheDocument();
    expect(screen.getByText(/Наличные · TJS/)).toBeInTheDocument();
    const total = document.querySelector('[data-testid="wallets-total"]');
    expect(total?.textContent).toContain(formatMinor(0, 'TJS'));
    expect(total?.textContent).not.toContain('≈');
    expect(td.opened).toEqual([LOCAL_USER_ID]);
  });

  it('создаёт кошелёк в долларах с начальным остатком; остаток считается из начального', async () => {
    const td = await openPage();
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog', { name: 'Новый кошелёк' });
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Доллары');
    pick(screen.getByRole('combobox', { name: 'Валюта' }), 'USD');
    await user.type(screen.getByRole('textbox', { name: /Начальный остаток/ }), '100,5');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const rows = await store(td).db.wallets.toArray();
    const usd = rows.find((r) => r.name === 'Доллары');
    expect(usd).toMatchObject({ currency: 'USD', openingBalanceMinor: 10050, kind: 'cash', archivedAt: null });
    await waitFor(() => expect(screen.getByText(formatMinor(10050, 'USD'))).toBeInTheDocument());
  });

  it('пустое название и повтор названия не сохраняются, внятная подсказка', async () => {
    const td = await openPage();
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog', { name: 'Новый кошелёк' });
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await findByRole('alert')).toHaveTextContent('Введите название кошелька');

    await user.type(screen.getByRole('textbox', { name: 'Название' }), '  наличные ');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await waitFor(() => screen.getByText('Кошелёк с таким названием уже есть'))).toBeInTheDocument();
    expect((await store(td).db.wallets.toArray()).length).toBe(1);
  });

  it('валюту кошелька с операциями менять нельзя: поле заблокировано и объяснено', async () => {
    const td = await openPage();
    const s = store(td);
    const cash = (await s.db.wallets.toArray())[0];
    if (!cash) throw new Error('нет кошелька');
    await write(() => s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 500, occurredOn: '2026-10-05' }));

    await user.click(screen.getByText('Наличные'));
    await findByRole('dialog', { name: 'Правка кошелька' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Валюта' })).toBeDisabled());
    expect(screen.getByText(/по этому кошельку уже есть операции/)).toBeInTheDocument();
  });

  it('если репозиторий всё же отверг смену валюты (ValidationError) — понятное объяснение у поля валюты, ничего не меняется', async () => {
    const td = await openPage();
    const s = store(td);
    vi.spyOn(s.wallets, 'update').mockRejectedValue(
      new ValidationError('Нельзя менять валюту кошелька «Наличные»: по нему уже есть операции. Заведите новый кошелёк.'),
    );
    await user.click(screen.getByText('Наличные'));
    await findByRole('dialog', { name: 'Правка кошелька' });
    pick(screen.getByRole('combobox', { name: 'Валюта' }), 'USD');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await waitFor(() => screen.getByText(/Нельзя менять валюту кошелька «Наличные»/))).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Правка кошелька' })).toBeInTheDocument(); // шит остался открыт
    expect((await s.db.wallets.toArray())[0]?.currency).toBe('TJS');
  });

  it('правка названия не трогает остальные поля (в том числе отрицательный начальный остаток)', async () => {
    const td = await openPage();
    const s = store(td);
    const created = await write(() => s.wallets.create({
      name: 'Кредитка',
      currency: 'TJS',
      kind: 'card',
      openingBalanceMinor: -50_000,
      color: '#2563eb',
      icon: '💳',
    }));
    await waitFor(() => expect(screen.getByText('Кредитка')).toBeInTheDocument());
    await user.click(screen.getByText('Кредитка'));
    await findByRole('dialog', { name: 'Правка кошелька' });
    expect(screen.getByText(/начальный остаток отрицательный/)).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Название' }));
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Кредитка Visa');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const after = await s.db.wallets.get(created.id);
    expect(after).toMatchObject({ name: 'Кредитка Visa', openingBalanceMinor: -50_000, currency: 'TJS', kind: 'card' });
  });

  it('архив: подтверждение, кошелёк уходит в свёрнутый блок, возвращается кнопкой; из «Всего» исчезает', async () => {
    const td = await openPage();
    const s = store(td);
    await write(() => s.wallets.create({ name: 'Старый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 7_000, color: '#2563eb', icon: '💰' }));
    await waitFor(() => expect(screen.getByText('Старый')).toBeInTheDocument());

    await user.click(screen.getByText('Старый'));
    await findByRole('dialog', { name: 'Правка кошелька' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    const confirm = await findByRole('alertdialog');
    expect(confirm).toHaveTextContent('в «Всего» он учитываться не будет');
    await user.click(screen.getByRole('button', { name: 'В архив' }));
    await waitFor(() => expect(screen.queryByText('Старый')).toBeNull());

    const toggle = screen.getByRole('button', { name: /Архив · 1 кошелёк/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByText('Старый')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Вернуть: Старый' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Архив ·/ })).toBeNull());
    expect(screen.getByText('Старый')).toBeInTheDocument();
    expect((await s.db.wallets.toArray()).find((w) => w.name === 'Старый')?.archivedAt).toBeNull();
  });

  it('архивирование кошелька по умолчанию сбрасывает его в настройках', async () => {
    const td = await openPage();
    const s = store(td);
    const cash = (await s.db.wallets.toArray())[0];
    expect((await s.settings.get())?.defaultWalletId).toBe(cash?.id);
    await user.click(screen.getByText('Наличные'));
    await findByRole('dialog', { name: 'Правка кошелька' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    await findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'В архив' }));
    await eventually(async () => expect((await s.settings.get())?.defaultWalletId).toBeNull());
  });

  it('«Всего»: кошелёк в долларах пересчитан по курсу, помечен «≈», курс не устарел', async () => {
    const td = depsWithRates(usdTable);
    await openPage(td);
    const s = store(td);
    await write(() => s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 10_000, color: '#2563eb', icon: '💲' }));
    await waitFor(() => expect(document.querySelector('[data-testid="wallets-total"]')?.textContent).toContain('≈'));
    expect(document.querySelector('[data-testid="wallets-total"]')?.textContent).toContain(formatMinor(109_000, 'TJS'));
    expect(screen.queryByText(/Курс устарел/)).toBeNull();
    expect(screen.queryByText(/Нет курса/)).toBeNull();
  });

  it('«Всего»: курса нет — валюта названа, в итог не вошла', async () => {
    const td = depsWithRates();
    await openPage(td);
    await write(() => store(td).wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 10_000, color: '#2563eb', icon: '💲' }));
    await waitFor(() => expect(screen.getByText(/Нет курса, в итог не вошли: USD/)).toBeInTheDocument());
    expect(document.querySelector('[data-testid="wallets-total"]')?.textContent).toContain(formatMinor(0, 'TJS'));
  });

  it('«Всего»: старый курс отмечен как устаревший', async () => {
    const old: RateTable = { ...usdTable, asOf: '2026-10-01' };
    const td = depsWithRates(old);
    await openPage(td);
    await write(() => store(td).wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 10_000, color: '#2563eb', icon: '💲' }));
    await waitFor(() => expect(screen.getByText(/Курс устарел: USD/)).toBeInTheDocument());
  });

  it('«Сверка» показывает из чего сложился остаток и подтверждает совпадение с экраном', async () => {
    const td = await openPage();
    const s = store(td);
    const cash = (await s.db.wallets.toArray())[0];
    if (!cash) throw new Error('нет кошелька');
    await write(() => s.wallets.update(cash.id, { openingBalanceMinor: 100_000 }));
    await write(() => s.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 50_000, occurredOn: '2026-10-05' }));
    await write(() => s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 12_345, occurredOn: '2026-10-06' }));
    const gone = await write(() => s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 99_999, occurredOn: '2026-10-07' }));
    await write(() => s.transactions.softDelete(gone.id));

    await user.click(screen.getByRole('button', { name: 'Сверка: Наличные' }));
    const dialog = await findByRole('dialog', { name: 'Сверка: Наличные' });
    await waitFor(() => expect(dialog).toHaveTextContent('= Остаток'));
    const text = dialog.textContent ?? '';
    expect(text).toContain(formatMinor(100_000, 'TJS'));
    expect(text).toContain(formatMinor(137_655, 'TJS')); // 1000 + 500 − 123,45 = 1376,55
    expect(text).toContain('1 операция');
    expect(text).not.toContain(formatMinor(99_999, 'TJS')); // удалённая не считается
    expect(await waitFor(() => screen.getByText('Совпадает с остатком на экране «Кошельки».'))).toBeInTheDocument();
  });
});

describe('cleanName / sameName — невидимые символы по краям', () => {
  it('убирает пробелы, неразрывные пробелы и невидимые символы только по краям', () => {
    expect(cleanName('  Нал  ')).toBe('Нал');
    expect(cleanName('​‎Карта⁠﻿')).toBe('Карта');
    expect(cleanName('Нал​ичные')).toBe('Нал​ичные'); // внутри не трогаем
  });

  it.each([[''], ['   '], ['​'], ['  '], ['‎'], ['⁠​'], ['﻿­']])('%j → пусто', (raw) => {
    expect(cleanName(raw)).toBe('');
  });

  it('«Нал» и «нал​ » — одно название', () => {
    expect(sameName('Нал', 'нал​ ')).toBe(true);
    expect(sameName('Нал', 'Карта')).toBe(false);
  });
});
