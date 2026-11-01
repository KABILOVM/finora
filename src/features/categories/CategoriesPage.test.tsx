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
    // значок «💼» рисуется иконкой (svg), а не текстом
    expect(screen.getByText('Зарплата').closest('li')?.querySelector('svg')).not.toBeNull();
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
    await user.click(screen.getByRole('button', { name: 'Кофе' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByText('Кафе')).toBeInTheDocument());
    const created = (await store(td).db.categories.toArray()).find((c) => c.name === 'Кафе');
    expect(created).toMatchObject({ kind: 'expense', icon: 'i:cup', parentId: null, archivedAt: null });
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
    await user.click(screen.getByRole('button', { name: 'Книги' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await eventually(async () => {
      const after = await store(td).db.categories.get(before?.id ?? '');
      expect(after).toMatchObject({ name: 'Питание', icon: 'i:book', kind: 'expense', color: before?.color, archivedAt: null });
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

describe('подкатегории', () => {
  const food = async (td: TestDeps) => {
    const c = (await store(td).db.categories.toArray()).find((x) => x.name === 'Еда');
    if (!c) throw new Error('нет «Еды»');
    return c;
  };
  const addChild = async (td: TestDeps, name: string, parentId: string) => {
    const parent = await store(td).db.categories.get(parentId);
    return write(() => store(td).categories.create({ name, kind: 'expense', color: parent?.color ?? '#16a34a', icon: 'i:water', parentId }));
  };
  const rowTexts = () => [...document.querySelectorAll('ul > li')].map((li) => li.textContent ?? '');

  it('«Входит в…»: подкатегория создаётся под выбранным родителем, цвет берётся от родителя, в списке она сразу под ним и с отступом', async () => {
    const td = await openPage();
    const parent = await food(td);
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog', { name: 'Новая категория расходов' });
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Кафе');
    await user.click(screen.getByRole('button', { name: /^Входит в: / }));
    await user.click(screen.getByRole('option', { name: 'Еда' }));
    // название окна от выбора родителя не меняется
    expect(screen.getByRole('dialog', { name: 'Новая категория расходов' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await eventually(async () => {
      const created = (await store(td).db.categories.toArray()).find((c) => c.name === 'Кафе');
      expect(created).toMatchObject({ parentId: parent.id, kind: 'expense', color: parent.color });
    });
    await waitFor(() => expect(rowTexts()).toContain('Кафе'));
    const texts = rowTexts();
    expect(texts.indexOf('Кафе')).toBe(texts.indexOf('Еда') + 1);
    expect(screen.getByText('Кафе').closest('button')?.className).toContain('pl-10');
    expect(screen.getByText('Еда').closest('button')?.className).not.toContain('pl-10');
  });

  it('свой цвет не затирается выбором родителя', async () => {
    const td = await openPage();
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog');
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Кафе');
    await user.click(screen.getByRole('button', { name: 'Розовый' }));
    await user.click(screen.getByRole('button', { name: /^Входит в: / }));
    await user.click(screen.getByRole('option', { name: 'Еда' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await eventually(async () => {
      expect((await store(td).db.categories.toArray()).find((c) => c.name === 'Кафе')?.color).toBe('#db2777');
    });
  });

  it('«Добавить подкатегорию» в окне родителя: новая подкатегория уже «входит в» него', async () => {
    const td = await openPage();
    const parent = await food(td);
    await user.click(screen.getByText('Еда'));
    await findByRole('dialog', { name: 'Правка категории' });
    await user.click(screen.getByRole('button', { name: 'Добавить подкатегорию' }));
    await findByRole('dialog', { name: 'Новая подкатегория' });
    expect(screen.getByRole('button', { name: 'Входит в: Еда' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Обеды');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await eventually(async () => {
      expect((await store(td).db.categories.toArray()).find((c) => c.name === 'Обеды')?.parentId).toBe(parent.id);
    });
  });

  it('у подкатегории нет кнопки «Добавить подкатегорию» (один уровень); окно называется «Правка подкатегории»', async () => {
    const td = await openPage();
    await addChild(td, 'Обеды', (await food(td)).id);
    await waitFor(() => expect(screen.getByText('Обеды')).toBeInTheDocument());
    await user.click(screen.getByText('Обеды'));
    await findByRole('dialog', { name: 'Правка подкатегории' });
    expect(screen.queryByRole('button', { name: 'Добавить подкатегорию' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Входит в: Еда' })).toBeInTheDocument();
  });

  it('категория с подкатегориями сама ни в какую не входит: поля «Входит в» нет, есть пояснение', async () => {
    const td = await openPage();
    await addChild(td, 'Обеды', (await food(td)).id);
    await waitFor(() => expect(screen.getByText('Обеды')).toBeInTheDocument());
    await user.click(screen.getByText('Еда'));
    await findByRole('dialog', { name: 'Правка категории' });
    expect(screen.queryByRole('button', { name: /^Входит в: / })).toBeNull();
    expect(screen.getByText(/есть подкатегории, поэтому она не может входить в другую/)).toBeInTheDocument();
  });

  it('в «Входит в…» только верхние категории: подкатегории и сама категория не предлагаются', async () => {
    const td = await openPage();
    await addChild(td, 'Обеды', (await food(td)).id);
    await waitFor(() => expect(screen.getByText('Обеды')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /^Входит в: / }));
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names).toContain('Еда');
    expect(names).not.toContain('Обеды');
    expect(names[0]).toContain('Нет, отдельная категория');
  });

  it('подкатегорию можно вынести на верхний уровень', async () => {
    const td = await openPage();
    const child = await addChild(td, 'Обеды', (await food(td)).id);
    await waitFor(() => expect(screen.getByText('Обеды')).toBeInTheDocument());
    await user.click(screen.getByText('Обеды'));
    await findByRole('dialog', { name: 'Правка подкатегории' });
    await user.click(screen.getByRole('button', { name: 'Входит в: Еда' }));
    await user.click(screen.getByRole('option', { name: 'Нет, отдельная категория' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await eventually(async () => {
      expect((await store(td).db.categories.get(child.id))?.parentId).toBeNull();
    });
    await waitFor(() => expect(screen.getByText('Обеды').closest('button')?.className).not.toContain('pl-10'));
  });

  it('архив родителя уводит и подкатегории (подтверждение называет их); возвращаются по одной, подкатегория без родителя в списке — обычная', async () => {
    const td = await openPage();
    const parent = await food(td);
    await addChild(td, 'Обеды', parent.id);
    await addChild(td, 'Кофе', parent.id);
    await waitFor(() => expect(screen.getByText('Кофе')).toBeInTheDocument());
    await user.click(screen.getByText('Еда'));
    await findByRole('dialog', { name: 'Правка категории' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    const ask = await findByRole('alertdialog');
    expect(ask).toHaveTextContent('Вместе с ней в архив уйдут подкатегории (2): Обеды, Кофе');
    await user.click(screen.getByRole('button', { name: 'В архив' }));
    await waitFor(() => expect(screen.queryByText('Обеды')).toBeNull());
    await eventually(async () => {
      const rows = await store(td).db.categories.toArray();
      expect(rows.filter((c) => ['Еда', 'Обеды', 'Кофе'].includes(c.name)).every((c) => c.archivedAt !== null)).toBe(true);
    });

    // живой запрос экрана может отстать от проверки базы выше — ждём, пока кнопка архива появится, а не читаем её сразу
    await user.click(await findByRole('button', { name: /Архив · 3 категории/ }));
    // в архиве у подкатегории подпись с названием родителя
    await waitFor(() => expect(screen.getByText('Обеды').closest('li')).toHaveTextContent('Еда'));
    // «Вернуть» заблокирована, пока идёт архивация (busy); клик по заблокированной кнопке молча ничего не делает — ждём, пока она станет доступна
    await waitFor(() => expect(screen.getByRole('button', { name: 'Вернуть: Обеды' })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Вернуть: Обеды' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Архив · 2 категории/ })).toBeInTheDocument());
    // родитель ещё в архиве: «Обеды» в основном списке — обычная категория, не теряется и без отступа
    const back = (await waitFor(() => screen.getAllByText('Обеды'))).map((el) => el.closest('button')).find((b) => b !== null);
    expect(back?.className).not.toContain('pl-10');
  });

  it('архив категории без подкатегорий — прежний текст подтверждения', async () => {
    await openPage();
    await user.click(screen.getByText('Еда'));
    await findByRole('dialog', { name: 'Правка категории' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    const ask = await findByRole('alertdialog');
    expect(ask).toHaveTextContent('Категория пропадёт из выбора');
    expect(ask).not.toHaveTextContent('подкатегории');
  });
});

describe('экран «Категории»: поиск', () => {
  const search = () => screen.getByRole('textbox', { name: 'Поиск по категориям' }) as HTMLInputElement;
  const visible = (name: string) => screen.queryByText(name) !== null;

  it('поле поиска есть, когда категорий много; находит по части названия без учёта регистра', async () => {
    await openPage();
    expect(search()).toBeInTheDocument();
    await user.type(search(), 'ПРО');
    await waitFor(() => expect(visible('Еда')).toBe(false));
    expect(visible('Продукты')).toBe(true);
    expect(visible('Прочее')).toBe(true);
    expect(visible('Транспорт')).toBe(false);
  });

  it('«Очистить поиск» (крестик) возвращает все категории', async () => {
    await openPage();
    await user.type(search(), 'еда');
    await waitFor(() => expect(visible('Транспорт')).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    await waitFor(() => expect(visible('Транспорт')).toBe(true));
    expect(search().value).toBe('');
  });

  it('ничего не нашлось: «Ничего не найдено» и кнопка «Очистить поиск»', async () => {
    await openPage();
    await user.type(search(), 'космос');
    await waitFor(() => expect(screen.getByText('Ничего не найдено')).toBeInTheDocument());
    expect(visible('Еда')).toBe(false);
    // кнопка в самом экране пустого результата (крестик в поле — отдельная кнопка с тем же именем)
    const empty = screen.getByText('Ничего не найдено').closest('div')?.parentElement as HTMLElement;
    await user.click(Array.from(empty.querySelectorAll('button')).find((b) => b.textContent === 'Очистить поиск') as HTMLElement);
    await waitFor(() => expect(visible('Еда')).toBe(true));
  });

  it('подкатегория находится вместе с родителем; родитель — со всеми подкатегориями', async () => {
    const td = await openPage();
    const housing = (await store(td).db.categories.toArray()).find((c) => c.name === 'Жильё' && c.kind === 'expense');
    await write(() => store(td).categories.create({ name: 'Вода', kind: 'expense', icon: 'i:water', color: '#0891b2', parentId: housing?.id ?? null }));
    await write(() => store(td).categories.create({ name: 'Свет', kind: 'expense', icon: 'i:bolt', color: '#ca8a04', parentId: housing?.id ?? null }));
    await waitFor(() => expect(visible('Вода')).toBe(true));

    await user.type(search(), 'вода');
    await waitFor(() => expect(visible('Еда')).toBe(false));
    expect(visible('Вода')).toBe(true);
    expect(visible('Жильё')).toBe(true); // родитель — для контекста
    expect(visible('Свет')).toBe(false);

    await user.clear(search());
    await user.type(search(), 'жильё');
    await waitFor(() => expect(visible('Свет')).toBe(true));
    expect(visible('Вода')).toBe(true);
    expect(visible('Еда')).toBe(false);
  });

  it('смена вкладки сбрасывает поиск; на «Доходах» поле скрыто, пока категорий меньше шести', async () => {
    await openPage();
    await user.type(search(), 'еда');
    await waitFor(() => expect(visible('Транспорт')).toBe(false));
    await user.click(screen.getByRole('radio', { name: 'Доходы' }));
    await waitFor(() => expect(visible('Зарплата')).toBe(true));
    expect(screen.queryByRole('textbox', { name: 'Поиск по категориям' })).toBeNull(); // доходных категорий мало
    await user.click(screen.getByRole('radio', { name: 'Расходы' }));
    await waitFor(() => expect(visible('Транспорт')).toBe(true)); // запрос не «прилип»
    expect(search().value).toBe('');
  });

  it('архивные ищутся тоже: в архиве показаны только совпавшие', async () => {
    const td = await openPage();
    const taxi = await write(() => store(td).categories.create({ name: 'Такси', kind: 'expense', icon: 'i:car', color: '#ca8a04', parentId: null }));
    const old = await write(() => store(td).categories.create({ name: 'Старая', kind: 'expense', icon: 'i:tag', color: '#64748b', parentId: null }));
    await write(() => store(td).categories.archive(taxi.id));
    await write(() => store(td).categories.archive(old.id));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Архив · 2/ })).toBeInTheDocument());

    await user.type(search(), 'такс');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Архив · 1/ })).toBeInTheDocument());
  });
});
