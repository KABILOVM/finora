import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, renderAppRoot, write } from '@/app/testkit';
import { act, render, screen, waitFor } from '@/components/testUtils';
import { ToastProvider } from '@/components/Toast';
import { uuidV5, type RecurringInput, type Store } from '@/db';
import { addDays } from '@/lib/dates';
import { opsDeps, pinToday, table, unpinToday, type OpsDeps } from '@/features/transactions/__fixtures__/opsKit';
import { currentFailures, requestAutoPostRun, resetAutoPostState } from '@/recurring/autoPostState';
import { SyncProvider } from '@/sync/syncContext';
import type { SyncEngineApi } from '@/sync/transport';
import AutoPostRunner from './AutoPostRunner';
import RecurringPage from './RecurringPage';
import UpcomingWidget from './UpcomingWidget';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => {
  pinToday();
  resetAutoPostState();
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const TODAY = '2026-10-15';
const LONG_AGO = '2026-09-01T00:00:00.000Z';

interface Ids {
  cash: string;
  card: string;
  usd: string;
}

/** Открывает приложение с готовыми данными. Подготовка выполняется один раз: повторное открытие («перезагрузка») её не повторяет. */
function makeApp(make: (s: Store, ids: Ids) => Promise<void> = async () => undefined, tables = [table()]): OpsDeps {
  let done = false;
  return opsDeps(tables, {
    setup: async (s) => {
      if (done) return;
      done = true;
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
      const card = (await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' })).id;
      const usd = (await s.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '💲' })).id;
      await make(s, { cash, card, usd });
    },
  });
}

const show = async (td: OpsDeps, ui = <AutoPostRunner />, opts: { strict?: boolean } = {}) => {
  const before = td.stores.length;
  const handle = renderAppRoot(ui, { deps: td.deps, ...opts });
  await waitFor(() => {
    if (td.stores.length <= before) throw new Error('База ещё открывается');
  });
  // затравка (кошелёк «Наличные») делается чуть позже открытия базы
  await eventually(async () => {
    if ((await lastStore(td).db.wallets.count()) === 0) throw new Error('Затравка ещё не прошла');
  });
  return handle;
};
const lastStore = (td: OpsDeps): Store => td.stores[td.stores.length - 1] as Store;
const txs = async (td: OpsDeps) => lastStore(td).db.transactions.toArray();
const liveTxs = async (td: OpsDeps) => (await txs(td)).filter((t) => t.deletedAt === null);

/** Платёж «Проводить само», созданный давно (иначе «историю» отсекла бы дата создания). */
async function auto(s: Store, over: Partial<RecurringInput> & Pick<RecurringInput, 'walletId'>) {
  const r = await s.recurring.create({ kind: 'expense', amountMinor: 50_000, frequency: 'monthly', startOn: TODAY, autoPost: 1, ...over });
  await s.db.recurring_rules.update(r.id, { createdAt: LONG_AGO, clientUpdatedAt: LONG_AGO });
  return r;
}

describe('AutoPostRunner: при открытии приложения', () => {
  it('проводит платёж на сегодня, говорит об этом одним уведомлением; после «перезагрузки» операция остаётся одна и уведомления нет', async () => {
    const td = makeApp(async (s, ids) => {
      await auto(s, { walletId: ids.cash, note: 'Аренда', amountMinor: 123_400 });
    });
    const first = await show(td);
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    await waitFor(() => expect(screen.getByText('Проведено автоплатежей: 1')).toBeInTheDocument());
    expect((await liveTxs(td))[0]).toMatchObject({ amountMinor: 123_400, note: 'Аренда', occurredOn: TODAY });

    // «перезагрузка» ×2: ни дубля, ни нового уведомления
    for (let i = 0; i < 2; i++) {
      first.unmount();
      const again = await show(td);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 150));
      });
      expect(await liveTxs(td)).toHaveLength(1);
      expect(screen.queryByText(/Проведено автоплатежей/)).toBeNull();
      again.unmount();
    }
  });

  it('в двойном режиме разработки (StrictMode) операция одна и уведомление одно', async () => {
    const td = makeApp(async (s, ids) => {
      await auto(s, { walletId: ids.cash });
    });
    await show(td, <AutoPostRunner />, { strict: true });
    // В двойном режиме база открывается дважды, а подготовка данных идёт только в первом (отменённом) открытии: на нагруженной
    // машине приложение успевает открыться раньше, чем появится правило. Ждём правило и просим проход, как при возврате на вкладку.
    await eventually(async () => expect(await lastStore(td).db.recurring_rules.count()).toBe(1));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(await txs(td)).toHaveLength(1);
    expect(screen.getAllByText('Проведено автоплатежей: 1')).toHaveLength(1);
  });

  it('много платежей: одно уведомление с общим числом', async () => {
    const td = makeApp(async (s, ids) => {
      for (let i = 0; i < 3; i++) await auto(s, { walletId: ids.cash, note: `р${i}` });
    });
    await show(td);
    await waitFor(() => expect(screen.getByText('Проведено автоплатежей: 3')).toBeInTheDocument());
    expect(await liveTxs(td)).toHaveLength(3);
  });

  it('нечего проводить — тихо', async () => {
    const td = makeApp(async (s, ids) => {
      await auto(s, { walletId: ids.cash, autoPost: 0 });
      await auto(s, { walletId: ids.cash, startOn: addDays(TODAY, 3) });
    });
    await show(td);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(await txs(td)).toHaveLength(0);
    expect(document.querySelector('[role="status"]')).toBeNull();
  });
});

describe('AutoPostRunner: возвращение на вкладку и смена даты', () => {
  it('visibilitychange и focus запускают проход: новый платёж проводится без перезагрузки', async () => {
    const td = makeApp();
    await show(td);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(await txs(td)).toHaveLength(0);

    await write(async () => {
      const cash = (await lastStore(td).db.wallets.toArray()).find((w) => w.name === 'Наличные');
      await auto(lastStore(td), { walletId: cash?.id ?? '', note: 'Подписка' });
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));

    await write(async () => {
      const cash = (await lastStore(td).db.wallets.toArray()).find((w) => w.name === 'Наличные');
      await auto(lastStore(td), { walletId: cash?.id ?? '', note: 'Ещё' });
    });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(2));
  });

  it('скрытая вкладка проход не запускает', async () => {
    // Первый платёж проводится проходом при открытии. Когда он проведён, этот проход уже прочитал правила и второй не заберёт:
    // без этого на медленной машине проход при открытии мог начаться уже после записи второго платежа и провести его сам.
    const td = makeApp(async (s, ids) => {
      await auto(s, { walletId: ids.cash, note: 'Первый' });
    });
    await show(td);
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    await write(async () => {
      const cash = (await lastStore(td).db.wallets.toArray()).find((w) => w.name === 'Наличные');
      await auto(lastStore(td), { walletId: cash?.id ?? '', note: 'Второй' });
    });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(await liveTxs(td)).toHaveLength(1);
  });

  it('наступил новый день: проверка раз в минуту замечает смену даты и проводит платёж на новый день', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 9, 15, 23, 59, 0));
    const td = makeApp(async (s, ids) => {
      await auto(s, { walletId: ids.cash, frequency: 'daily', startOn: TODAY, note: 'Кофе' });
    });
    await show(td);
    await eventually(async () => expect((await liveTxs(td)).map((t) => t.occurredOn)).toEqual([TODAY]));

    vi.setSystemTime(new Date(2026, 9, 16, 0, 1, 0));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await eventually(async () => expect((await liveTxs(td)).map((t) => t.occurredOn).sort()).toEqual([TODAY, '2026-10-16']));
  });
});

/** Подставной движок синхронизации: каждый syncNow ждёт, пока тест его не отпустит. */
function fakeEngine() {
  const gates: Array<() => void> = [];
  const syncNow = vi.fn(() => new Promise<void>((resolve) => void gates.push(resolve)));
  const status = { phase: 'idle', pending: 0, quarantined: 0, lastSyncedAt: null, lastError: null } as const;
  const engine: SyncEngineApi = { subscribe: () => () => undefined, getStatus: () => status, syncNow, start: vi.fn(), stop: vi.fn() };
  return { engine, syncNow, release: () => gates.splice(0).forEach((open) => open()) };
}
const pause = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const cashId = async (td: OpsDeps) => (await lastStore(td).db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';

describe('AutoPostRunner: с облаком сначала обмен с сервером, потом проход', () => {
  it('при открытии платёж не проводится, пока идёт обмен (чужой «Пропустить» мог ещё не прийти); после обмена — проводится', async () => {
    const td = makeApp(async (s, ids) => {
      await auto(s, { walletId: ids.cash, note: 'Аренда' });
    });
    const fake = fakeEngine();
    await show(td, (
      <SyncProvider engine={fake.engine}>
        <AutoPostRunner />
      </SyncProvider>
    ));
    await pause(250);
    expect(fake.syncNow).toHaveBeenCalledTimes(1);
    expect(await txs(td)).toHaveLength(0);

    fake.release();
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    await waitFor(() => expect(screen.getByText('Проведено автоплатежей: 1')).toBeInTheDocument());
  });

  it('обмен завис: через отведённое время платёж всё равно проводится (сеть не держит автоплатежи вечно)', async () => {
    const td = makeApp(async (s, ids) => {
      await auto(s, { walletId: ids.cash, note: 'Аренда' });
    });
    const fake = fakeEngine();
    await show(td, (
      <SyncProvider engine={fake.engine}>
        <AutoPostRunner syncWaitMs={150} />
      </SyncProvider>
    ));
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    expect(fake.syncNow).toHaveBeenCalledTimes(1);
  });

  it('возврат на вкладку: снова сначала обмен, потом проход; «сохранили правило» и новый день обмен не ждут', async () => {
    const td = makeApp();
    const fake = fakeEngine();
    await show(td, (
      <SyncProvider engine={fake.engine}>
        <AutoPostRunner />
      </SyncProvider>
    ));
    await waitFor(() => expect(fake.syncNow).toHaveBeenCalledTimes(1));
    fake.release(); // обмен при открытии закончился
    await pause(100);

    await write(async () => {
      await auto(lastStore(td), { walletId: await cashId(td), note: 'Подписка' });
    });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await pause(250);
    expect(fake.syncNow).toHaveBeenCalledTimes(2);
    expect(await txs(td)).toHaveLength(0); // ждёт обмена

    fake.release();
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));

    await write(async () => {
      await auto(lastStore(td), { walletId: await cashId(td), note: 'Ещё' });
    });
    act(() => requestAutoPostRun()); // как после «Сохранить» в окне правила: обмена не ждём
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(2));
    expect(fake.syncNow).toHaveBeenCalledTimes(2);
  });

  it('два события подряд (visibilitychange и focus при возврате на вкладку) — один обмен, а не два', async () => {
    const td = makeApp();
    const fake = fakeEngine();
    await show(td, (
      <SyncProvider engine={fake.engine}>
        <AutoPostRunner />
      </SyncProvider>
    ));
    await waitFor(() => expect(fake.syncNow).toHaveBeenCalledTimes(1));
    fake.release();
    await pause(100);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await pause(100);
    expect(fake.syncNow).toHaveBeenCalledTimes(2);
  });
});

describe('AutoPostRunner: кошелёк в чужой валюте', () => {
  it('курса нет: платёж не проведён, одно уведомление «нет курса», без повторов; в «Просроченных»/«Сегодня» он остаётся', async () => {
    const td = makeApp(async (s, ids) => {
      await auto(s, { walletId: ids.usd, note: 'Подписка', amountMinor: 1_000 });
    }, []);
    await show(td, (
      <>
        <AutoPostRunner />
        <RecurringPage />
      </>
    ));
    await waitFor(() => expect(screen.getByText(/Не удалось провести автоплатёж: нет курса USD → TJS/)).toBeInTheDocument());
    expect(await txs(td)).toHaveLength(0);
    // платёж ждёт в «Сегодня», у него пометка
    await waitFor(() => expect(screen.getByRole('button', { name: /^Провести: Подписка/ })).toBeInTheDocument());
    // пометка и в «Сегодня», и в «Все правила»
    expect(screen.getAllByText(/Не проведён сам: нет курса USD → TJS/)).toHaveLength(2);

    // возвращение на вкладку не плодит такие же уведомления
    for (let i = 0; i < 3; i++) {
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 80));
      });
    }
    expect(screen.getAllByText(/Не удалось провести автоплатёж/)).toHaveLength(1);
  });

  it('курс появился («Свой курс») — платёж проводится сам, пометка исчезает, уведомление «Проведено»', async () => {
    const td = makeApp(async (s, ids) => {
      await auto(s, { walletId: ids.usd, note: 'Подписка', amountMinor: 1_000 });
    }, []);
    await show(td, (
      <>
        <AutoPostRunner />
        <RecurringPage />
      </>
    ));
    await waitFor(() => expect(screen.getAllByText(/Не проведён сам/).length).toBeGreaterThan(0));
    await write(async () => td.rates.setManualRate('USD', 'TJS', 11));
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    expect((await liveTxs(td))[0]).toMatchObject({ fxRate: 11, fxSource: 'manual', baseAmountMinor: 11_000 });
    await waitFor(() => expect(screen.getByText('Проведено автоплатежей: 1')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText(/Не проведён сам/)).toBeNull());
  });

  it('свежий курс есть — проводит со снимком', async () => {
    const td = makeApp(async (s, ids) => {
      await auto(s, { walletId: ids.usd, amountMinor: 1_000 });
    });
    await show(td);
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    expect((await liveTxs(td))[0]).toMatchObject({ fxRate: 10.9, fxSource: 'nbt', baseAmountMinor: 10_900 });
  });
});

describe('AutoPostRunner: сбой одного правила', () => {
  it('у платежа пометка «Не удалось провести: причина», остальные проведены, данные правила не изменены', async () => {
    let brokenId = '';
    const td = makeApp(async (s, ids) => {
      const broken = await auto(s, { walletId: ids.card, note: 'Сломанный' });
      brokenId = broken.id;
      await auto(s, { walletId: ids.cash, note: 'Живой' });
      await s.wallets.archive(ids.card);
    });
    await show(td, (
      <>
        <AutoPostRunner />
        <RecurringPage />
      </>
    ));
    // уведомление живёт несколько секунд: проверяем его первым
    await waitFor(() => expect(screen.getByText('Проведено автоплатежей: 1')).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText(/Не удалось провести: Кошелёк «Карта» в архиве/).length).toBeGreaterThan(0));
    expect((await liveTxs(td)).map((t) => t.note)).toEqual(['Живой']);
    const rule = await lastStore(td).db.recurring_rules.get(brokenId);
    expect(rule).toMatchObject({ walletId: expect.any(String), autoPost: 1, archivedAt: null, deletedAt: null, note: 'Сломанный' });
    expect(currentFailures(lastStore(td).userId).get(brokenId)?.kind).toBe('error');
  });
});

describe('AutoPostRunner: без хранилища и вне рабочего окружения', () => {
  it('нет хранилища (экран входа) — ничего не рисует и ничего не делает', () => {
    const { container } = render(
      <ToastProvider>
        <MemoryRouter>
          <AutoPostRunner />
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(container.textContent).toBe('');
    expect(container.querySelector('button, a, [role]')).toBeNull();
  });

  it('StrictMode без хранилища тоже спокоен', () => {
    const { container } = render(
      <StrictMode>
        <ToastProvider>
          <MemoryRouter>
            <AutoPostRunner />
          </MemoryRouter>
        </ToastProvider>
      </StrictMode>,
    );
    expect(container.textContent).toBe('');
  });
});

describe('UpcomingWidget на «Главной»', () => {
  it('нет правил — ничего не рисует', async () => {
    const td = makeApp();
    await show(td, <UpcomingWidget />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(screen.queryByText('Ближайшие платежи')).toBeNull();
  });

  it('просроченные и ближайшие 7 дней; до 2 строк и «Ещё N»; дальше недели не показывает', async () => {
    const td = makeApp(async (s, ids) => {
      const base = { walletId: ids.cash, frequency: 'monthly' as const, autoPost: 0 as const };
      await s.recurring.create({ ...base, kind: 'expense', amountMinor: 100, startOn: addDays(TODAY, -3), note: 'Просрочен' });
      await s.recurring.create({ ...base, kind: 'expense', amountMinor: 200, startOn: TODAY, note: 'Сегодняшний' });
      await s.recurring.create({ ...base, kind: 'expense', amountMinor: 300, startOn: addDays(TODAY, 1), note: 'Завтрашний' });
      await s.recurring.create({ ...base, kind: 'expense', amountMinor: 400, startOn: addDays(TODAY, 5), note: 'Через пять' });
      await s.recurring.create({ ...base, kind: 'expense', amountMinor: 500, startOn: addDays(TODAY, 7), note: 'Через семь' });
      await s.recurring.create({ ...base, kind: 'expense', amountMinor: 600, startOn: addDays(TODAY, 8), note: 'Через восемь' });
    });
    await show(td, <UpcomingWidget />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ближайшие платежи' })).toBeInTheDocument());
    // две строки: самый старый просроченный и сегодняшний; остальные три в пределах недели — «Ещё 3»
    for (const name of ['Просрочен', 'Сегодняшний']) expect(screen.getByText(name)).toBeInTheDocument();
    for (const name of ['Завтрашний', 'Через пять', 'Через семь']) expect(screen.queryByText(name)).toBeNull();
    expect(screen.queryByText('Через восемь')).toBeNull(); // дальше недели
    expect(screen.getByRole('link', { name: 'Ещё 3' })).toHaveAttribute('href', '/recurring');
    expect(screen.getByRole('link', { name: 'Все платежи' })).toHaveAttribute('href', '/recurring');
    expect(screen.getByText('Просрочено на 3 дня')).toBeInTheDocument();
  });

  it('«Провести» в одно касание: операция записана, строка уходит, двойное нажатие не задваивает', async () => {
    const td = makeApp(async (s, ids) => {
      await s.recurring.create({ walletId: ids.cash, kind: 'expense', amountMinor: 700, frequency: 'monthly', startOn: TODAY, note: 'Интернет' });
    });
    await show(td, <UpcomingWidget />);
    const button = await waitFor(() => screen.getByRole('button', { name: /^Провести: Интернет/ }));
    act(() => {
      button.click();
      button.click();
      button.click();
    });
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    expect(await txs(td)).toHaveLength(1);
    await waitFor(() => expect(screen.getByText(/Платёж проведён: Интернет/)).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('Ближайшие платежи')).toBeNull());
  });

  it('«Провести» просроченный платёж: операция записывается на сегодня (когда оплатили), id — от даты по расписанию; «Отменить» оставляет её в окне «Пропущенных»', async () => {
    let ruleId = '';
    const td = makeApp(async (s, ids) => {
      const r = await s.recurring.create({ walletId: ids.cash, kind: 'expense', amountMinor: 700, frequency: 'monthly', startOn: addDays(TODAY, -20), note: 'Старая аренда' });
      ruleId = r.id;
    });
    await show(td, <UpcomingWidget />);
    const button = await waitFor(() => screen.getByRole('button', { name: /^Провести: Старая аренда/ }));
    act(() => button.click());
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    const [tx] = await liveTxs(td);
    expect(tx).toMatchObject({ occurredOn: TODAY, recurringRuleId: ruleId, id: await uuidV5(ruleId, addDays(TODAY, -20)) });
    act(() => screen.getByRole('button', { name: 'Отменить' }).click());
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(0));
    // удалённая строка осталась на сегодняшней дате: она попадёт в окно «Пропущенных» (оно смотрит 90 дней назад), а не потеряется
    expect((await txs(td))[0]).toMatchObject({ occurredOn: TODAY });
  });

  it('«Провести» с отменой: в уведомлении «Отменить» — операция удаляется, а дата платежа остаётся среди пропущенных', async () => {
    const td = makeApp(async (s, ids) => {
      await s.recurring.create({ walletId: ids.cash, kind: 'expense', amountMinor: 700, frequency: 'monthly', startOn: TODAY, note: 'Интернет' });
    });
    await show(td, <UpcomingWidget />);
    const button = await waitFor(() => screen.getByRole('button', { name: /^Провести: Интернет/ }));
    act(() => button.click());
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(1));
    const undo = await waitFor(() => screen.getByRole('button', { name: 'Отменить' }));
    act(() => undo.click());
    await eventually(async () => expect(await liveTxs(td)).toHaveLength(0));
    expect(await txs(td)).toHaveLength(1); // строка осталась (удалённая): дата считается пропущенной, её можно вернуть
    await waitFor(() => expect(screen.getByText(/Платёж отменён. Вернуть его можно/)).toBeInTheDocument());
    // платёж снова не появляется в виджете (он пропущен), а не «забыт»
    await waitFor(() => expect(screen.queryByText('Ближайшие платежи')).toBeNull());
  });

  it('кошелёк в чужой валюте и курса нет — открывается окно, где курс можно ввести', async () => {
    const td = makeApp(async (s, ids) => {
      await s.recurring.create({ walletId: ids.usd, kind: 'expense', amountMinor: 1_000, frequency: 'monthly', startOn: TODAY, note: 'Подписка' });
    }, []);
    await show(td, <UpcomingWidget />);
    const button = await waitFor(() => screen.getByRole('button', { name: /^Провести: Подписка/ }));
    act(() => button.click());
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Провести платёж' })).toBeInTheDocument());
    expect(await txs(td)).toHaveLength(0);
  });

  it('пропущенный платёж в виджете не показывается', async () => {
    const td = makeApp(async (s, ids) => {
      const r = await s.recurring.create({ walletId: ids.cash, kind: 'expense', amountMinor: 700, frequency: 'monthly', startOn: TODAY, note: 'Интернет' });
      await s.transactions.skipOccurrence(r.id, TODAY);
    });
    await show(td, <UpcomingWidget />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(screen.queryByText('Ближайшие платежи')).toBeNull();
  });
});
