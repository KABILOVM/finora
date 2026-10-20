import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventually, makeTestDeps, renderAppRoot, write, type TestDeps } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { BALANCES_OVERFLOW_MESSAGE } from '@/db';
import { formatMinor } from '@/domain/money';
import { chip } from '@/features/transactions/__fixtures__/opsKit';
import { createRateService } from '@/rates/service';
import { createMemoryRateStorage } from '@/rates/storage';
import { BANKS } from './banks';
import WalletsPage from './WalletsPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

afterEach(() => vi.restoreAllMocks());

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function openPage(options: { path?: string; setup?: (td: TestDeps) => Promise<void>; rates?: boolean } = {}) {
  const td = makeTestDeps();
  if (options.rates) {
    td.deps.createRates = () =>
      createRateService({
        providers: [],
        storage: createMemoryRateStorage({
          v: 1,
          tables: [{ asOf: '2026-10-15', pivot: 'TJS', perUnit: { TJS: 1, USD: 10.9 }, source: 'nbt', fetchedAt: '2026-10-15T08:00:00.000Z' }],
          manual: {},
          lastRefreshAt: null,
          lastAttemptAt: null,
          lastError: null,
        }),
        now: () => new Date('2026-10-15T09:00:00Z'),
      });
  }
  renderAppRoot(<WalletsPage />, { deps: td.deps, path: options.path ?? '/wallets' });
  await findByRole('heading', { name: 'Кошельки', level: 1 });
  await waitFor(() => expect(document.body.textContent).toContain('Наличные'));
  if (options.setup) await options.setup(td);
  return td;
}

const store = (td: TestDeps) => {
  const s = td.stores[0];
  if (!s) throw new Error('Хранилище не открыто');
  return s;
};
const cashOf = async (td: TestDeps) => {
  const w = (await store(td).db.wallets.toArray()).find((x) => x.name === 'Наличные');
  if (!w) throw new Error('нет кошелька');
  return w;
};

describe('строка кошелька', () => {
  it('вся строка — ссылка на операции этого кошелька за всё время; правка — отдельная кнопка-карандаш', async () => {
    const td = await openPage();
    const cash = await cashOf(td);
    const link = screen.getByRole('link', { name: /Наличные/ });
    expect(link.getAttribute('href')).toBe(`/transactions?wallet=${cash.id}&period=all`);
    expect(screen.getByRole('button', { name: 'Изменить: Наличные' })).toBeInTheDocument();
    // «Сверка» из строки ушла в форму правки: на узком экране строке нужна каждая клетка
    expect(screen.queryByRole('button', { name: /^Сверка:/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Изменить: Наличные' }));
    await findByRole('dialog', { name: 'Правка кошелька' });
  });

  it('«Сверка остатка» открывается из формы правки; пока есть несохранённые изменения — недоступна', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: 'Изменить: Наличные' }));
    await findByRole('dialog', { name: 'Правка кошелька' });
    const reconcile = screen.getByRole('button', { name: 'Сверка остатка' });
    expect(reconcile).not.toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Название' }), '!');
    expect(screen.getByRole('button', { name: 'Сверка остатка' })).toBeDisabled();
    expect(screen.getByText('Сначала сохраните изменения.')).toBeInTheDocument();
    await user.keyboard('{Backspace}');
    expect(screen.getByRole('button', { name: 'Сверка остатка' })).not.toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Сверка остатка' }));
    await findByRole('dialog', { name: 'Сверка: Наличные' });
    expect(screen.queryByRole('dialog', { name: 'Правка кошелька' })).toBeNull();
  });
});

describe('/wallets?new=1', () => {
  it('открывает «Новый кошелёк» сразу; после закрытия форма не возвращается', async () => {
    await openPage({ path: '/wallets?new=1' });
    await findByRole('dialog', { name: 'Новый кошелёк' });
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('форма кошелька: порядок и подсказки', () => {
  const labelsInOrder = () =>
    Array.from(document.querySelectorAll('[role="dialog"] span.text-sm.font-semibold, [role="dialog"] label')).map((e) => norm(e.textContent));

  it('вид — первым и с пояснением; «Банк» только у карты и счёта в банке', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog', { name: 'Новый кошелёк' });
    const order = labelsInOrder();
    expect(order.indexOf('Вид')).toBeLessThan(order.findIndex((t) => t.startsWith('Название')));
    expect(screen.getByText('Деньги на руках.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Банк' })).toBeNull(); // наличные — банка нет
    await user.click(chip('Вид кошелька', 'Карта'));
    expect(screen.getByRole('group', { name: 'Банк' })).toBeInTheDocument();
    expect(screen.getByText('Банковская карта: можно выбрать банк.')).toBeInTheDocument();
    await user.click(chip('Вид кошелька', 'Накопления'));
    expect(screen.queryByRole('group', { name: 'Банк' })).toBeNull();
    expect(screen.getByText(/Накопления не входят в «Можно тратить в день»/)).toBeInTheDocument();
  });

  it('смена вида на «Наличные» после выбора банка сбрасывает банк: значок обычный, поле «Банк» скрыто', async () => {
    const td = await openPage();
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog', { name: 'Новый кошелёк' });
    await user.click(chip('Вид кошелька', 'Карта'));
    await user.click(chip('Банк', BANKS[0]!.name));
    await user.click(chip('Вид кошелька', 'Наличные'));
    expect(screen.queryByRole('group', { name: 'Банк' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const saved = (await store(td).db.wallets.toArray()).find((w) => w.name === BANKS[0]!.name);
    expect(saved?.kind).toBe('cash');
    expect(saved?.icon.startsWith('b:')).toBe(false);
  });

  it('«Убрать в архив» недоступно, пока в форме есть несохранённые изменения (как «Сверка остатка»)', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: 'Изменить: Наличные' }));
    await findByRole('dialog', { name: 'Правка кошелька' });
    expect(screen.getByRole('button', { name: 'Убрать в архив' })).not.toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Название' }), '!');
    expect(screen.getByRole('button', { name: 'Убрать в архив' })).toBeDisabled();
    expect(screen.getByText('Чтобы убрать в архив, сначала сохраните изменения.')).toBeInTheDocument();
    await user.keyboard('{Backspace}');
    expect(screen.getByRole('button', { name: 'Убрать в архив' })).not.toBeDisabled();
  });
});

describe('валюта закреплена так же, как в хранилище', () => {
  it('у кошелька без операций, но с регулярным платежом, валюту менять нельзя — форма не обещает того, что хранилище откажет', async () => {
    const td = await openPage();
    const s = store(td);
    const cash = await cashOf(td);
    expect(await s.wallets.isCurrencyLocked(cash.id)).toBe(false);
    await write(() =>
      s.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 5000, note: 'Интернет', frequency: 'monthly', intervalN: 1, startOn: '2026-11-01' }),
    );
    expect(await s.wallets.isCurrencyLocked(cash.id)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Изменить: Наличные' }));
    await findByRole('dialog', { name: 'Правка кошелька' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Валюта' })).toBeDisabled());
    // пояснение появляется, только когда запрет подтверждён запросом (до ответа поле заблокировано молча — без мигания)
    await waitFor(() => expect(screen.getByText(/по этому кошельку уже есть операции или регулярные платежи/)).toBeInTheDocument());
  });

  it('у чистого кошелька поле валюты доступно', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: 'Изменить: Наличные' }));
    await findByRole('dialog', { name: 'Правка кошелька' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Валюта' })).not.toBeDisabled());
  });
});

describe('архив кошелька с регулярными платежами', () => {
  it('диалог называет платежи, которые перестанут проводиться', async () => {
    const td = await openPage();
    const s = store(td);
    const cash = await cashOf(td);
    await write(() =>
      s.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 5000, note: 'Интернет', frequency: 'monthly', intervalN: 1, startOn: '2026-11-01' }),
    );
    await user.click(screen.getByRole('button', { name: 'Изменить: Наличные' }));
    await findByRole('dialog', { name: 'Правка кошелька' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    const confirm = await findByRole('alertdialog');
    await waitFor(() => expect(confirm).toHaveTextContent('К кошельку привязаны регулярные платежи: Интернет'));
    expect(confirm).toHaveTextContent('перестанут проводиться');
  });

  it('платёж без заметки назван так же, как в списке платежей — по категории, а не «без названия»', async () => {
    const td = await openPage();
    const s = store(td);
    const cash = await cashOf(td);
    const category = (await s.db.categories.toArray()).find((c) => c.kind === 'expense' && c.deletedAt === null);
    if (!category) throw new Error('нет категории расходов');
    await write(() =>
      s.recurring.create({ kind: 'expense', walletId: cash.id, categoryId: category.id, amountMinor: 5000, note: '', frequency: 'monthly', intervalN: 1, startOn: '2026-11-01' }),
    );
    await user.click(screen.getByRole('button', { name: 'Изменить: Наличные' }));
    await findByRole('dialog', { name: 'Правка кошелька' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    const confirm = await findByRole('alertdialog');
    await waitFor(() => expect(confirm).toHaveTextContent(`К кошельку привязаны регулярные платежи: ${category.name}`));
    expect(confirm).not.toHaveTextContent('без названия');
  });

  it('архивный платёж не мешает архивации (проводиться он и так не будет), но валюту кошелька закрепляет', async () => {
    const td = await openPage();
    const s = store(td);
    const cash = await cashOf(td);
    const rule = await write(() =>
      s.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 5000, note: 'Интернет', frequency: 'monthly', intervalN: 1, startOn: '2026-11-01' }),
    );
    await write(() => s.recurring.archive(rule.id));
    expect(await s.wallets.isCurrencyLocked(cash.id)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Изменить: Наличные' }));
    await findByRole('dialog', { name: 'Правка кошелька' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    const confirm = await findByRole('alertdialog');
    expect(confirm).not.toHaveTextContent('регулярные платежи');
  });

  it('без регулярных платежей предупреждения нет', async () => {
    await openPage();
    await user.click(screen.getByRole('button', { name: 'Изменить: Наличные' }));
    await findByRole('dialog', { name: 'Правка кошелька' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    const confirm = await findByRole('alertdialog');
    expect(confirm).not.toHaveTextContent('регулярные платежи');
  });
});

describe('карточка «Всего»', () => {
  it('несколько валют — разбивка «TJS … · USD …» под итогом', async () => {
    await openPage({
      rates: true,
      setup: async (td) => {
        const s = store(td);
        await write(() => s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 12_000, color: '#2563eb', icon: '💲' }));
      },
    });
    await waitFor(() => expect(document.querySelector('[data-testid="wallets-by-currency"]')).not.toBeNull());
    const line = norm(document.querySelector('[data-testid="wallets-by-currency"]')?.textContent);
    expect(line).toContain(norm(formatMinor(0, 'TJS')));
    expect(line).toContain(norm(formatMinor(12_000, 'USD')));
  });

  it('все кошельки в одной небазовой валюте — исходная сумма всё равно видна', async () => {
    const td = await openPage({ rates: true });
    const s = store(td);
    const cash = await cashOf(td);
    await write(() => s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 12_000, color: '#2563eb', icon: '💲' }));
    await write(() => s.wallets.archive(cash.id));
    await waitFor(() => expect(document.querySelector('[data-testid="wallets-by-currency"]')).not.toBeNull());
    expect(norm(document.querySelector('[data-testid="wallets-by-currency"]')?.textContent)).toBe(norm(formatMinor(12_000, 'USD')));
  });

  it('строка архивного кошелька тоже ведёт к его операциям', async () => {
    const td = await openPage();
    const s = store(td);
    const old = await write(() => s.wallets.create({ name: 'Старый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 7000, color: '#2563eb', icon: '💰' }));
    await write(() => s.wallets.archive(old.id));
    await user.click(await findByRole('button', { name: /Архив · 1/ }));
    expect(screen.getByRole('link', { name: /Старый/ }).getAttribute('href')).toBe(`/transactions?wallet=${old.id}&period=all`);
  });

  it('одна валюта — разбивки нет; фраза про архив — только когда в архиве есть деньги', async () => {
    const td = await openPage();
    expect(document.querySelector('[data-testid="wallets-by-currency"]')).toBeNull();
    expect(screen.queryByText('Архивные кошельки в итог не входят.')).toBeNull();
    const s = store(td);
    // архивный кошелёк с нулём — фразы по-прежнему нет
    const empty = await write(() => s.wallets.create({ name: 'Пустой', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '💰' }));
    await write(() => s.wallets.archive(empty.id));
    await waitFor(() => expect(screen.getByRole('button', { name: /Архив · 1/ })).toBeInTheDocument());
    expect(screen.queryByText('Архивные кошельки в итог не входят.')).toBeNull();
    // архивный кошелёк с деньгами — фраза появляется
    const rich = await write(() => s.wallets.create({ name: 'Старый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 7000, color: '#2563eb', icon: '💰' }));
    await write(() => s.wallets.archive(rich.id));
    await waitFor(() => expect(screen.getByText('Архивные кошельки в итог не входят.')).toBeInTheDocument());
  });
});

describe('слишком большие суммы', () => {
  it('остатки не считаются — не вечная «Загрузка…», а список кошельков и понятное сообщение', async () => {
    const td = await openPage();
    const s = store(td);
    const cash = await cashOf(td);
    // два дохода по максимальному целому: вместе не помещаются (в обход проверок формы — как испорченные данные с другого устройства)
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const row = await write(() => s.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 100, occurredOn: '2026-10-05' }));
      ids.push(row.id);
    }
    await write(async () => {
      for (const id of ids) await s.db.transactions.update(id, { amountMinor: Number.MAX_SAFE_INTEGER });
    });
    await waitFor(() => expect(screen.getByText(new RegExp(BALANCES_OVERFLOW_MESSAGE))).toBeInTheDocument());
    expect(screen.queryByText('Загрузка…')).toBeNull();
    // кошелёк по-прежнему виден и ведёт к своим операциям: там можно найти огромную сумму
    const link = screen.getByRole('link', { name: /Наличные/ });
    expect(link.getAttribute('href')).toContain('/transactions?wallet=');
    expect(link.textContent).toContain('—');
    await eventually(() => expect(document.querySelector('[data-testid="wallets-total"]')).toBeNull());
  });
});

describe('слишком большие суммы: архив', () => {
  it('в архиве — прочерк вместо «0», а подтверждение архивации честно говорит, что остаток не посчитан', async () => {
    const td = await openPage();
    const s = store(td);
    const cash = await cashOf(td);
    const old = await write(() => s.wallets.create({ name: 'Старый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 7000, color: '#2563eb', icon: '💰' }));
    await write(() => s.wallets.archive(old.id));
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const row = await write(() => s.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 100, occurredOn: '2026-10-05' }));
      ids.push(row.id);
    }
    await write(async () => {
      for (const id of ids) await s.db.transactions.update(id, { amountMinor: Number.MAX_SAFE_INTEGER });
    });
    await waitFor(() => expect(screen.getByText(new RegExp(BALANCES_OVERFLOW_MESSAGE))).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Архив · 1/ }));
    const row = screen.getByRole('link', { name: /Старый/ });
    expect(row.textContent).toContain('—');
    expect(norm(row.textContent)).not.toMatch(/(^|\D)0\s*с\./);
    // подтверждение архивации: остаток не «нулевой», а не посчитан
    await user.click(screen.getByRole('button', { name: 'Изменить: Наличные' }));
    await findByRole('dialog', { name: 'Правка кошелька' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    const confirm = await findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Остаток кошелька не удалось посчитать');
  });
});

describe('загрузка', () => {
  it('пока данные читаются — каркас с aria-busy и слово «Загрузка…» только для скринридера; потом каркас уходит', async () => {
    const td = makeTestDeps();
    renderAppRoot(<WalletsPage />, { deps: td.deps, path: '/wallets' });
    // первый кадр после открытия базы: каркас или уже готовый список; если каркас есть — он честный
    const busy = document.querySelector('[aria-busy="true"]');
    if (busy) {
      expect(busy.querySelector('.sr-only')?.textContent).toBe('Загрузка…');
      expect(busy.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(busy.textContent).not.toMatch(/\d/); // в каркасе нет ни одной цифры (не «0»)
    }
    await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument());
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByText('Загрузка…')).toBeNull();
  });
});
