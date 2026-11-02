import { describe, expect, it, vi } from 'vitest';
import { makeTestDeps, renderAppRoot } from '@/app/testkit';
import type { ChipOption } from '@/components/ChipPicker';
import { screen, user, waitFor } from '@/components/testUtils';
import { buildCategoryOptions } from '@/features/categories/categoryTree';
import { CategoryGrid } from './CategoryGrid';
import type { FrequentChoice } from './FrequentPanel';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

const cat = (id: string, name: string, parentId: string | null = null) => ({ id, name, icon: 'i:tag', color: '#2563eb', parentId });

// девять категорий: этого достаточно, чтобы над сеткой появился поиск (от 6)
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

const searchBox = () => screen.getByRole('textbox', { name: 'Поиск категории' }) as HTMLInputElement;
const grid = () => screen.getByRole('group', { name: 'Категория' });
/** Подписи категорий в сетке (без плитки «Новая»): название — последний текст кнопки. */
const shown = () => Array.from(grid().querySelectorAll('button[aria-pressed]')).map((b) => (b.querySelector('span[lang]')?.textContent ?? '').trim());

function mount(options: ChipOption[], extra: Partial<React.ComponentProps<typeof CategoryGrid>> = {}) {
  const onPick = vi.fn();
  const onSkip = vi.fn();
  renderAppRoot(<CategoryGrid options={options} value={null} onPick={onPick} onSkip={onSkip} kind="expense" {...extra} />, { deps: makeTestDeps().deps });
  return { onPick, onSkip };
}

describe('поиск в панели категорий (новая операция)', () => {
  it('в коротком списке поля нет', async () => {
    mount(OPTIONS.slice(0, 5));
    await waitFor(() => screen.getByRole('group', { name: 'Категория' }));
    expect(screen.queryByRole('textbox', { name: 'Поиск категории' })).toBeNull();
  });

  it('в длинном — поле есть, и все категории на месте', async () => {
    mount(OPTIONS);
    await waitFor(searchBox);
    expect(shown()).toHaveLength(OPTIONS.length);
  });

  it('набор сужает список; выбор отдаёт id найденной категории', async () => {
    const { onPick } = mount(OPTIONS);
    await user.type(await waitFor(searchBox), 'такс');
    expect(shown()).toEqual(['Такси']);
    // у найденной подкатегории видно, где она лежит
    expect(grid()).toHaveTextContent('Транспорт');
    await user.click(screen.getByRole('button', { name: /Такси/ }));
    expect(onPick).toHaveBeenCalledWith('taxi');
  });

  it('регистр и «ё» не важны, лишние пробелы по краям тоже', async () => {
    mount([...OPTIONS, { value: 'yolka', label: 'Ёлка' }]);
    await user.type(await waitFor(searchBox), '  ЕЛК ');
    expect(shown()).toEqual(['Ёлка']);
  });

  it('запрос по родителю показывает его самого и все подкатегории', async () => {
    mount(OPTIONS);
    await user.type(await waitFor(searchBox), 'коммун');
    expect(shown()).toEqual(['Коммунальные услуги', 'Вода', 'Свет']);
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

  it('«Очистить поиск» возвращает весь список', async () => {
    mount(OPTIONS);
    await user.type(await waitFor(searchBox), 'вод');
    expect(shown()).toEqual(['Вода']);
    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    expect(shown()).toHaveLength(OPTIONS.length);
    expect(searchBox().value).toBe('');
  });

  it('пока ищут, полоса «Частые» спрятана; сотрёшь запрос — вернётся', async () => {
    const frequent: FrequentChoice[] = [{ key: 'k', title: 'Кофе', subtitle: 'Еда · Наличные · 3 раза', amount: '15 с.', icon: 'i:tag' }];
    mount(OPTIONS, { frequent, onPickFrequent: () => undefined });
    await waitFor(searchBox);
    expect(screen.getByRole('group', { name: 'Частые операции' })).toBeTruthy();
    await user.type(searchBox(), 'вод');
    expect(screen.queryByRole('group', { name: 'Частые операции' })).toBeNull();
    await user.clear(searchBox());
    expect(screen.getByRole('group', { name: 'Частые операции' })).toBeTruthy();
  });

  it('«Без категории» работает и во время поиска', async () => {
    const { onSkip } = mount(OPTIONS);
    await user.type(await waitFor(searchBox), 'вод');
    await user.click(screen.getByRole('button', { name: 'Без категории' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
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
