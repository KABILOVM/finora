import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventually, makeTestDeps, renderAppRoot, write, type TestDeps } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import CategoriesPage from './CategoriesPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

afterEach(() => vi.restoreAllMocks());

async function openPage() {
  const td = makeTestDeps();
  renderAppRoot(<CategoriesPage />, { deps: td.deps, path: '/settings/categories' });
  await findByRole('heading', { name: 'Категории', level: 1 });
  await waitFor(() => expect(screen.getByText('Еда')).toBeInTheDocument());
  return td;
}
const store = (td: TestDeps) => {
  const s = td.stores[0];
  if (!s) throw new Error('Хранилище не открыто');
  return s;
};

describe('экран «Категории»', () => {
  it('две вкладки: расходы по умолчанию, доходы по переключению; у каждой категории значок', async () => {
    await openPage();
    expect(screen.getByText('Еда')).toBeInTheDocument();
    expect(screen.queryByText('Зарплата')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Доходы' }));
    await waitFor(() => expect(screen.getByText('Зарплата')).toBeInTheDocument());
    expect(screen.queryByText('Еда')).toBeNull();
    expect(screen.getByText('💼')).toBeInTheDocument();
  });

  it('есть ссылка назад в «Настройки»', async () => {
    await openPage();
    expect(screen.getByRole('link', { name: 'Настройки' })).toHaveAttribute('href', '/settings');
  });

  it('добавляет категорию расходов с выбранным значком; вид берётся из вкладки', async () => {
    const td = await openPage();
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog', { name: 'Новая категория расходов' });
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Кафе');
    await user.click(screen.getByRole('button', { name: '☕' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByText('Кафе')).toBeInTheDocument());
    const created = (await store(td).db.categories.toArray()).find((c) => c.name === 'Кафе');
    expect(created).toMatchObject({ kind: 'expense', icon: '☕', parentId: null, archivedAt: null });
  });

  it('на вкладке «Доходы» создаётся категория дохода', async () => {
    const td = await openPage();
    await user.click(screen.getByRole('radio', { name: 'Доходы' }));
    await waitFor(() => expect(screen.getByText('Зарплата')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog', { name: 'Новая категория доходов' });
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Кэшбэк');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByText('Кэшбэк')).toBeInTheDocument());
    expect((await store(td).db.categories.toArray()).find((c) => c.name === 'Кэшбэк')?.kind).toBe('income');
  });

  it('пустое название и повтор названия не сохраняются; такое же имя в другом виде — можно', async () => {
    const td = await openPage();
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await waitFor(() => screen.getByText('Введите название категории'))).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Название' }), ' еда ');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await waitFor(() => screen.getByText('Такая категория уже есть'))).toBeInTheDocument();
    expect((await store(td).db.categories.toArray()).filter((c) => c.name === 'Еда')).toHaveLength(1);
    // «Прочее» есть и в расходах, и в доходах — это разные категории
    const same = (await store(td).db.categories.toArray()).filter((c) => c.name === 'Прочее');
    expect(same.map((c) => c.kind).sort()).toEqual(['expense', 'income']);
  });

  it('переименование и смена значка: меняются только они', async () => {
    const td = await openPage();
    const before = (await store(td).db.categories.toArray()).find((c) => c.name === 'Еда');
    await user.click(screen.getByText('Еда'));
    await findByRole('dialog', { name: 'Правка категории' });
    await user.clear(screen.getByRole('textbox', { name: 'Название' }));
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Питание');
    await user.click(screen.getByRole('button', { name: '🍞' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await eventually(async () => {
      const after = await store(td).db.categories.get(before?.id ?? '');
      expect(after).toMatchObject({ name: 'Питание', icon: '🍞', kind: 'expense', color: before?.color, archivedAt: null });
    });
    expect(screen.getByText('Питание')).toBeInTheDocument();
  });

  it('архив с подтверждением: пропадает из списка, лежит в свёрнутом «Архиве», возвращается кнопкой', async () => {
    const td = await openPage();
    await user.click(screen.getByText('Еда'));
    await findByRole('dialog', { name: 'Правка категории' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    expect(await findByRole('alertdialog')).toHaveTextContent('Старые операции останутся');
    await user.click(screen.getByRole('button', { name: 'В архив' }));
    await waitFor(() => expect(screen.queryByText('Еда')).toBeNull());

    const toggle = screen.getByRole('button', { name: /Архив · 1 категория/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByText('Еда')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Вернуть: Еда' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Архив ·/ })).toBeNull());
    expect(screen.getByText('Еда')).toBeInTheDocument();
    expect((await store(td).db.categories.toArray()).find((c) => c.name === 'Еда')?.archivedAt).toBeNull();
  });

  it('повтор названия архивной категории подсказывает вернуть её из архива', async () => {
    const td = await openPage();
    const food = (await store(td).db.categories.toArray()).find((c) => c.name === 'Еда');
    await write(() => store(td).categories.archive(food?.id ?? ''));
    await waitFor(() => expect(screen.queryByText('Еда')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog');
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Еда');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await waitFor(() => screen.getByText(/уже есть в архиве/))).toBeInTheDocument();
  });

  it('ошибка репозитория показывается в шите, шит остаётся открытым', async () => {
    const td = await openPage();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(store(td).categories, 'create').mockRejectedValue(new Error('диск переполнен'));
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog');
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Новая');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await findByRole('alert')).toHaveTextContent('Не удалось сохранить категорию');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
