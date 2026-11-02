import { describe, expect, it, vi } from 'vitest';
import { makeTestDeps, renderAppRoot } from '@/app/testkit';
import type { ChipOption } from '@/components/ChipPicker';
import { screen, user, waitFor } from '@/components/testUtils';
import { buildCategoryOptions } from '@/features/categories/categoryTree';
import { CategoryGrid, type CategoryGridProps } from './CategoryGrid';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const cat = (id: string, name: string, parentId: string | null = null) => ({ id, name, icon: 'i:tag', color: '#2563eb', parentId });

// девять категорий: шесть верхних и три подкатегории; от шести поверх сетки появляется поиск
const OPTIONS: ChipOption[] = buildCategoryOptions([
  cat('eda', 'Еда'),
  cat('zhile', 'Коммунальные услуги'),
  cat('voda', 'Вода', 'zhile'),
  cat('svet', 'Свет', 'zhile'),
  cat('transport', 'Транспорт'),
  cat('taxi', 'Такси', 'transport'),
  cat('health', 'Здоровье'),
  cat('fun', 'Развлечения'),
  cat('gifts', 'Подарки'),
]);

const SELF = 'Без подкатегории';
const searchBox = () => screen.getByRole('textbox', { name: 'Поиск категории' }) as HTMLInputElement;
const grid = () => screen.getByRole('group', { name: 'Категория' });
/** Названия категорий в сетке (без плиток «Новая» и «В шаблон»): название — текст с lang. */
const shown = () => Array.from(grid().querySelectorAll('button[aria-pressed]')).map((b) => (b.querySelector('span[lang]')?.textContent ?? '').trim());
/** Плитка по названию категории (в поиске у подкатегории перед названием стоит подпись родителя, поэтому по имени кнопки её не найти). */
const cell = (name: string): HTMLElement => {
  const hit = Array.from(grid().querySelectorAll<HTMLElement>('button[aria-pressed]')).find((b) => b.querySelector('span[lang]')?.textContent?.trim() === name);
  if (!hit) throw new Error(`Нет плитки «${name}»`);
  return hit;
};

function mount(options: ChipOption[], extra: Partial<CategoryGridProps> = {}) {
  const onPick = vi.fn();
  const onSkip = vi.fn();
  renderAppRoot(<CategoryGrid options={options} value={null} onPick={onPick} onSkip={onSkip} kind="expense" {...extra} />, { deps: makeTestDeps().deps });
  return { onPick, onSkip };
}

describe('сетка категорий: только верхний уровень, подкатегории — по нажатию', () => {
  it('в сетке одни верхние категории; у той, где есть подкатегории, значок «N ›» и подпись для скринридера', async () => {
    mount(OPTIONS);
    await waitFor(searchBox);
    expect(shown()).toEqual(['Еда', 'Коммунальные услуги', 'Транспорт', 'Здоровье', 'Развлечения', 'Подарки']);
    expect(cell('Коммунальные услуги')).toHaveTextContent('подкатегорий: 2');
    expect(cell('Транспорт')).toHaveTextContent('подкатегорий: 1');
    expect(cell('Еда')).not.toHaveTextContent('подкатегорий');
  });

  it('никаких лишних подписей: ни «Выберите категорию», ни мелкой подписи родителя над плитками', async () => {
    mount(OPTIONS);
    await waitFor(searchBox);
    expect(screen.queryByText('Выберите категорию')).toBeNull();
    expect(grid()).not.toHaveTextContent('Транспорт Такси');
  });

  it('категория без подкатегорий выбирается сразу', async () => {
    const { onPick } = mount(OPTIONS);
    await user.click(await waitFor(() => cell('Здоровье')));
    expect(onPick).toHaveBeenCalledWith('health');
  });

  it('категория с подкатегориями открывает их; выбор подкатегории отдаёт её id', async () => {
    const { onPick } = mount(OPTIONS);
    await user.click(await waitFor(() => cell('Коммунальные услуги')));
    expect(onPick).not.toHaveBeenCalled();
    expect(shown()).toEqual([SELF, 'Вода', 'Свет']);
    expect(screen.getByRole('button', { name: 'Назад к категориям' })).toHaveTextContent('Коммунальные услуги');
    await user.click(cell('Свет'));
    expect(onPick).toHaveBeenCalledWith('svet');
  });

  it('плитка «Без подкатегории» выбирает саму категорию, «Назад» возвращает верхний уровень', async () => {
    const { onPick } = mount(OPTIONS);
    await user.click(await waitFor(() => cell('Коммунальные услуги')));
    await user.click(screen.getByRole('button', { name: 'Назад к категориям' }));
    expect(shown()).toHaveLength(6);
    await user.click(cell('Коммунальные услуги'));
    await user.click(cell(SELF));
    expect(onPick).toHaveBeenCalledWith('zhile');
  });

  it('выбрана подкатегория — панель открывается сразу на её соседях, а в верхнем уровне подсвечена её категория', async () => {
    mount(OPTIONS, { value: 'voda' });
    await waitFor(searchBox);
    expect(shown()).toEqual([SELF, 'Вода', 'Свет']);
    expect(cell('Вода').getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Назад к категориям' }));
    expect(cell('Коммунальные услуги').getAttribute('aria-pressed')).toBe('true');
    expect(cell('Еда').getAttribute('aria-pressed')).toBe('false');
  });

  it('родителя нет среди вариантов (в архиве): подкатегория показывается как обычная и выбирается сразу', async () => {
    const orphan: ChipOption[] = [...OPTIONS.filter((o) => o.value !== 'zhile'), ];
    const { onPick } = mount(orphan);
    await waitFor(searchBox);
    expect(shown()).toContain('Вода');
    await user.click(cell('Вода'));
    expect(onPick).toHaveBeenCalledWith('voda');
  });

  it('подсказка (напоминание при «Сохранить») — отдельной строкой, и только когда она есть', async () => {
    mount(OPTIONS, { hint: 'Выберите категорию или оставьте без неё' });
    expect(await waitFor(() => screen.getByRole('alert'))).toHaveTextContent('Выберите категорию или оставьте без неё');
  });

  it('«В шаблон» — плитка верхнего уровня: в открытой категории и в поиске её нет', async () => {
    const onSaveTemplate = vi.fn();
    mount(OPTIONS, { onSaveTemplate });
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Сохранить как шаблон' })));
    expect(onSaveTemplate).toHaveBeenCalledTimes(1);
    await user.click(cell('Коммунальные услуги'));
    expect(screen.queryByRole('button', { name: 'Сохранить как шаблон' })).toBeNull();
  });

  it('«Без категории» работает на любом уровне', async () => {
    const { onSkip } = mount(OPTIONS);
    await user.click(await waitFor(() => cell('Транспорт')));
    await user.click(screen.getByRole('button', { name: 'Без категории' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe('поиск в панели категорий (новая операция)', () => {
  it('в коротком списке поля нет', async () => {
    mount(OPTIONS.slice(0, 5));
    await waitFor(() => screen.getByRole('group', { name: 'Категория' }));
    expect(screen.queryByRole('textbox', { name: 'Поиск категории' })).toBeNull();
  });

  it('набор сужает список; подкатегория находится прямо из поиска, с подписью родителя; выбор отдаёт её id', async () => {
    const { onPick } = mount(OPTIONS);
    await user.type(await waitFor(searchBox), 'такс');
    expect(shown()).toEqual(['Такси']);
    expect(grid()).toHaveTextContent('Транспорт'); // подпись: где она лежит
    await user.click(cell('Такси'));
    expect(onPick).toHaveBeenCalledWith('taxi');
  });

  it('регистр и «ё» не важны, лишние пробелы по краям тоже', async () => {
    mount([...OPTIONS, { value: 'yolka', label: 'Ёлка' }]);
    await user.type(await waitFor(searchBox), '  ЕЛК ');
    expect(shown()).toEqual(['Ёлка']);
  });

  it('запрос по родителю показывает его самого и все подкатегории; нажатие на родителя в поиске выбирает его, а не открывает', async () => {
    const { onPick } = mount(OPTIONS);
    await user.type(await waitFor(searchBox), 'коммун');
    expect(shown()).toEqual(['Коммунальные услуги', 'Вода', 'Свет']);
    await user.click(cell('Коммунальные услуги'));
    expect(onPick).toHaveBeenCalledWith('zhile');
  });

  it('Enter выбирает лучшее совпадение (с начала слова — раньше, чем из середины)', async () => {
    const { onPick } = mount([...OPTIONS, { value: 'avto', label: 'Автотранспорт' }]);
    await user.type(await waitFor(searchBox), 'транс');
    expect(shown()[0]).toBe('Транспорт');
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('transport');
  });

  it('Enter при пустом запросе или без совпадений ничего не выбирает', async () => {
    const { onPick } = mount(OPTIONS);
    await waitFor(searchBox);
    await user.keyboard('{Enter}');
    await user.type(searchBox(), 'космос');
    await user.keyboard('{Enter}');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('ничего не нашлось — подсказка, а «Новая» подставляет набранное название', async () => {
    mount(OPTIONS);
    await user.type(await waitFor(searchBox), 'Кофе');
    expect(shown()).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent('Такой категории нет');
    await user.click(screen.getByRole('button', { name: 'Новая категория' }));
    expect((await waitFor(() => screen.getByRole('textbox', { name: 'Название новой категории' })) as HTMLInputElement).value).toBe('Кофе');
  });

  it('«Очистить поиск» возвращает то, что было: открытая категория остаётся открытой', async () => {
    mount(OPTIONS);
    await user.click(await waitFor(() => cell('Коммунальные услуги')));
    await user.type(searchBox(), 'здор');
    expect(shown()).toEqual(['Здоровье']);
    expect(screen.queryByRole('button', { name: 'Назад к категориям' })).toBeNull(); // в поиске — плоский список по всем
    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    expect(shown()).toEqual([SELF, 'Вода', 'Свет']);
    expect(searchBox().value).toBe('');
  });

  it('на ПК курсор в поле поиска сразу', async () => {
    mount(OPTIONS);
    const box = await waitFor(searchBox);
    expect(document.activeElement).toBe(box);
  });

  it('на телефоне (грубый указатель) курсор не ставится: экранная клавиатура закрыла бы сетку', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('coarse'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    try {
      mount(OPTIONS);
      const box = await waitFor(searchBox);
      expect(document.activeElement).not.toBe(box);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
