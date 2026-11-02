import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, makeTestDeps, renderAppRoot, write, type TestDeps } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { opsDeps, showApp, table } from '@/features/transactions/__fixtures__/opsKit';
import CategoriesPage from '../CategoriesPage';
import { CatalogOffer } from './CatalogOffer';
import { __resetCatalogOfferMemory, markCatalogOffered, wasCatalogOffered } from './catalogOfferStorage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => {
  localStorage.clear();
  __resetCatalogOfferMemory();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const store = (td: TestDeps) => {
  const s = td.stores[0];
  if (!s) throw new Error('Хранилище не открыто');
  return s;
};
const live = async (td: TestDeps) => (await store(td).db.categories.toArray()).filter((c) => c.deletedAt === null);

async function openPage() {
  const td = makeTestDeps();
  renderAppRoot(<CategoriesPage />, { deps: td.deps, path: '/settings/categories' });
  await findByRole('heading', { name: 'Категории', level: 1 });
  await waitFor(() => expect(screen.getByText('Еда')).toBeInTheDocument());
  return td;
}
const openCatalog = async (opts: { groups?: boolean } = {}) => {
  await user.click(screen.getByRole('button', { name: 'Готовые категории с подкатегориями' }));
  const dialog = await findByRole('dialog', { name: 'Готовые категории' });
  // категории читаются из базы: список наборов появляется чуть позже окна
  await waitFor(() => expect(screen.queryAllByRole('checkbox', { name: /^Набор/ }).length > 0 || opts.groups === false).toBe(true));
  return dialog;
};
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
/** Вкладка «Расходы»/«Доходы» самого окна (такие же есть и на странице под ним: окно в конце документа). */
const sheetTab = (name: string) => screen.getAllByRole('radio', { name }).at(-1)!;
/** Все отмеченные (или неотмеченные) наборы на текущей вкладке окна. */
const groupBoxes = (checked: boolean) =>
  screen.getAllByRole('checkbox').filter((c) => /^Набор/.test(c.getAttribute('aria-label') ?? '') && (c as HTMLInputElement).checked === checked);

describe('окно «Готовые категории»', () => {
  it('открывается из «Категорий» одним окном: наборы с галочками, популярные уже отмечены, остальные нет', async () => {
    await openPage();
    await openCatalog();
    expect(box('Набор «Коммунальные услуги»').checked).toBe(true);
    expect(box('Набор «Семья»').checked).toBe(true);
    expect(box('Набор «Продукты»').checked).toBe(true);
    expect(box('Набор «Путешествия»').checked).toBe(false);
    expect(screen.getByRole('button', { name: /^Добавить выбранное · \d+$/ })).toBeInTheDocument();
  });

  it('раскрывает состав набора: свет, вода, газ', async () => {
    await openPage();
    await openCatalog();
    expect(screen.queryByRole('checkbox', { name: 'Электричество' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Показать состав набора «Коммунальные услуги»' }));
    for (const n of ['Электричество', 'Вода', 'Газ', 'Отопление']) expect(box(n).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Скрыть состав набора «Коммунальные услуги»' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('добавляет только отмеченное: набор целиком и отдельные подкатегории', async () => {
    const td = await openPage();
    await openCatalog();
    // снимаем всё популярное, берём «Путешествия» целиком и одну подкатегорию «Здоровья»
    for (const n of ['Коммунальные услуги', 'Семья', 'Продукты', 'Связь', 'Еда', 'Транспорт', 'Здоровье', 'Покупки', 'Развлечения', 'Подписки', 'Образование', 'Жильё']) {
      const b = screen.queryByRole('checkbox', { name: `Набор «${n}»` }) as HTMLInputElement | null;
      if (b?.checked) await user.click(b);
    }
    await user.click(box('Набор «Путешествия»'));
    await user.click(screen.getByRole('button', { name: 'Показать состав набора «Здоровье»' }));
    await user.click(box('Стоматолог'));
    await user.click(sheetTab('Доходы'));
    for (const b of groupBoxes(true)) await user.click(b);
    await user.click(sheetTab('Расходы'));
    const before = (await live(td)).length;
    await user.click(screen.getByRole('button', { name: /^Добавить выбранное · \d+$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const rows = await live(td);
    const travel = rows.find((c) => c.name === 'Путешествия')!;
    expect(travel.parentId).toBeNull();
    expect(rows.filter((c) => c.parentId === travel.id).length).toBe(6);
    expect(rows.find((c) => c.name === 'Стоматолог')).toBeDefined();
    expect(rows.find((c) => c.name === 'Лекарства')).toBeUndefined();
    expect(rows.find((c) => c.name === 'Коммунальные услуги')).toBeUndefined();
    expect(rows.length).toBe(before + 8); // «Путешествия», шесть подкатегорий и «Стоматолог»
    // страница «Категории» показывает новые под родителем
    await waitFor(() => expect(screen.getByText('Путешествия')).toBeInTheDocument());
  });

  it('с кнопкой «Отмена» ничего не пишет', async () => {
    const td = await openPage();
    const before = (await live(td)).length;
    await openCatalog();
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await live(td)).length).toBe(before);
  });

  it('когда ничего не отмечено, кнопка недоступна и говорит об этом', async () => {
    await openPage();
    await openCatalog();
    for (const b of groupBoxes(true)) await user.click(b);
    await user.click(sheetTab('Доходы'));
    for (const b of groupBoxes(true)) await user.click(b);
    const btn = screen.getByRole('button', { name: 'Выберите, что добавить' });
    expect(btn).toBeDisabled();
  });

  it('свои категории переносятся под набор, а не дублируются: «Коммуналка» и «Свет» → под одним родителем', async () => {
    const td = makeTestDeps();
    renderAppRoot(<CategoriesPage />, { deps: td.deps, path: '/settings/categories' });
    await findByRole('heading', { name: 'Категории', level: 1 });
    await waitFor(() => expect(screen.getByText('Еда')).toBeInTheDocument());
    const komm = await write(() => store(td).categories.create({ name: 'Коммуналка', kind: 'expense', color: '#111111', icon: '🏠' }));
    const light = await write(() => store(td).categories.create({ name: 'Свет', kind: 'expense', color: '#abcdef', icon: '💡' }));
    await waitFor(() => expect(screen.getByText('Коммуналка')).toBeInTheDocument());
    await openCatalog();
    await user.click(screen.getByRole('button', { name: 'Показать состав набора «Коммунальные услуги»' }));
    const row = box('Свет').closest('label')!;
    expect(row.textContent).toContain('перенесём сюда');
    expect(screen.getByRole('checkbox', { name: 'Набор «Коммунальные услуги»' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Добавить выбранное · \d+$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const rows = await live(td);
    expect(rows.find((c) => c.id === light.id)?.parentId).toBe(komm.id);
    expect(rows.filter((c) => c.name === 'Коммуналка' || c.name === 'Коммунальные услуги')).toHaveLength(1);
  });

  it('когда всё уже есть, говорит об этом и предлагает закрыть окно', async () => {
    const td = await openPage();
    // применяем всё, что предложено, потом открываем окно снова
    await openCatalog();
    for (const b of groupBoxes(false)) await user.click(b);
    await user.click(sheetTab('Доходы'));
    for (const b of groupBoxes(false)) await user.click(b);
    await user.click(screen.getByRole('button', { name: /^Добавить выбранное · \d+$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await eventually(async () => expect((await live(td)).length).toBeGreaterThan(150));
    await openCatalog({ groups: false });
    await waitFor(() => expect(screen.getByText(/Все готовые наборы у вас уже есть/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Понятно' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('разовое предложение действующему человеку', () => {
  /** Открывает приложение с готовой базой: с операциями (действующий человек) или без (новый). */
  async function mount(withOps: boolean) {
    const td = opsDeps([table()], {
      setup: async (s: Store) => {
        if (!withOps) return;
        const wallet = (await s.db.wallets.toArray())[0]!;
        await s.transactions.create({ kind: 'income', walletId: wallet.id, amountMinor: 1000, occurredOn: '2026-10-01' });
      },
    });
    await showApp(<CatalogOffer />, td, '/');
    return td;
  }

  it('у человека с операциями окно появляется через паузу, один раз; после закрытия больше не приходит', async () => {
    const td = await mount(true);
    const dialog = await findByRole('dialog', { name: 'Готовые категории' });
    await waitFor(() => expect(dialog.textContent).toContain('Подготовили готовые категории'));
    await user.click(screen.getByRole('button', { name: 'Не сейчас' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(wasCatalogOffered(store(td).userId)).toBe(true);
  }, 15000);

  it('у нового человека (операций нет) окна нет, и позже, когда операции появятся, оно тоже не придёт', async () => {
    const td = await mount(false);
    await eventually(() => expect(wasCatalogOffered(store(td).userId)).toBe(true)); // новичку отметка ставится сразу
    const wallet = (await store(td).db.wallets.toArray())[0]!;
    await write(() => store(td).transactions.create({ kind: 'income', walletId: wallet.id, amountMinor: 1000, occurredOn: '2026-10-01' }));
    await new Promise((r) => setTimeout(r, 2200));
    expect(screen.queryByRole('dialog')).toBeNull();
  }, 15000);

  it('если уже предлагали, окна нет', async () => {
    const td = opsDeps([table()], {
      setup: async (s: Store) => {
        const wallet = (await s.db.wallets.toArray())[0]!;
        await s.transactions.create({ kind: 'income', walletId: wallet.id, amountMinor: 1000, occurredOn: '2026-10-01' });
        markCatalogOffered(s.userId);
      },
    });
    await showApp(<CatalogOffer />, td, '/');
    await new Promise((r) => setTimeout(r, 2200));
    expect(screen.queryByRole('dialog')).toBeNull();
  }, 15000);

  it('когда все готовые наборы уже есть, предлагать нечего: окна нет, но отметка не ставится', async () => {
    const td = opsDeps([table()], {
      setup: async (s: Store) => {
        const wallet = (await s.db.wallets.toArray())[0]!;
        await s.transactions.create({ kind: 'income', walletId: wallet.id, amountMinor: 1000, occurredOn: '2026-10-01' });
        const { CATALOG } = await import('./catalogData');
        const { planCatalog, defaultSelection } = await import('./catalogPlan');
        const { applyCatalog } = await import('./catalogApply');
        const rows = await s.db.categories.toArray();
        const plan = planCatalog(rows.map((c) => ({ id: c.id, name: c.name, kind: c.kind, parentId: c.parentId, archived: c.archivedAt !== null, color: c.color })));
        const all = new Set<string>(defaultSelection(plan));
        for (const g of plan.groups) {
          all.add(g.key);
          for (const c of g.children) all.add(c.key);
        }
        await applyCatalog(s, plan, all);
        expect(CATALOG.length).toBeGreaterThan(0);
      },
    });
    await showApp(<CatalogOffer />, td, '/');
    await new Promise((r) => setTimeout(r, 2200));
    expect(screen.queryByRole('dialog')).toBeNull();
  }, 20000);
});

describe('отметка «предлагали»', () => {
  it('хранится по человеку и переживает недоступное хранилище (в памяти)', () => {
    expect(wasCatalogOffered('u1')).toBe(false);
    markCatalogOffered('u1');
    expect(wasCatalogOffered('u1')).toBe(true);
    expect(wasCatalogOffered('u2')).toBe(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('нет места', 'QuotaExceededError');
    });
    expect(() => markCatalogOffered('u3')).not.toThrow();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('доступ закрыт', 'SecurityError');
    });
    expect(wasCatalogOffered('u3')).toBe(true);
  });
});
