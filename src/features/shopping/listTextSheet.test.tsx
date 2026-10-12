import { describe, expect, it, vi } from 'vitest';
import type { ParsedItem } from '@/domain/shoppingAi';
import type { AiListResult } from './aiList';
import type { ActiveRecorder, Recording, StartRecorder } from './recorder';
import { priceKey } from '@/domain/shopping';
import { act, render, screen, user, waitFor } from '@/components/testUtils';
import { ListTextSheet } from './ListTextSheet';

const MILK: ParsedItem = { name: 'Молоко', qtyMilli: 2000, unit: 'l' };
const BREAD: ParsedItem = { name: 'Хлеб', qtyMilli: 3000, unit: 'pcs' };
const FLOUR: ParsedItem = { name: 'Мука', qtyMilli: 1000, unit: 'pcs' };

/** Каталог: молоко берут литрами, мука — штуками; молоко раньше покупали по 13 с. за литр. */
const CATALOG = [
  { name: 'Молоко', unit: 'l' as const },
  { name: 'Мука', unit: 'pcs' as const },
  { name: 'Масло сливочное', unit: 'pcs' as const },
];
const MEMORY = new Map([[priceKey('Молоко', 'l'), 1300]]);

const REC: Recording = { blob: new Blob(['x'], { type: 'audio/mp4' }), mime: 'audio/mp4' };

function setup(parse: (t: string, k: readonly string[]) => Promise<ParsedItem[]>, onAdd = vi.fn(async () => {})) {
  const onClose = vi.fn();
  render(
    <ListTextSheet
      known={['Хлеб']}
      catalog={CATALOG}
      memory={MEMORY}
      currency="TJS"
      parse={parse}
      listen={vi.fn()}
      canRecord={false}
      onAdd={onAdd}
      onClose={onClose}
    />,
  );
  return { onAdd, onClose };
}

/** Окно с поддельным микрофоном и разбором записи. */
function setupVoice(opts: { listen?: (r: Recording, k: readonly string[]) => Promise<AiListResult>; start?: StartRecorder } = {}) {
  const rec: ActiveRecorder = { stop: vi.fn(async () => REC), cancel: vi.fn() };
  const start: StartRecorder = opts.start ?? vi.fn(async () => rec);
  const listen = opts.listen ?? vi.fn(async () => ({ items: [MILK, BREAD], transcript: 'молоко два литра хлеб три штуки' }));
  const onAdd = vi.fn(async () => {});
  const onClose = vi.fn();
  const ui = render(
    <ListTextSheet
      known={['Хлеб']}
      catalog={CATALOG}
      memory={MEMORY}
      currency="TJS"
      parse={vi.fn()}
      listen={listen}
      startRecording={start}
      canRecord
      onAdd={onAdd}
      onClose={onClose}
    />,
  );
  return { rec, start, listen, onAdd, onClose, ui };
}
const panel = () => document.querySelector('[data-testid="record-panel"]') as HTMLElement | null;
const editor = () => document.querySelector('[data-testid="row-editor"]') as HTMLElement | null;
const field = () => screen.getByRole('textbox', { name: 'Что купить' });
const btn = (name: string | RegExp) => screen.getByRole('button', { name });

describe('«Добавить списком» с ИИ', () => {
  it('пока текста нет, «Разобрать» недоступна; обычного разбора по буквам больше нет', async () => {
    const parse = vi.fn(async () => [MILK]);
    setup(parse);
    expect((btn('Разобрать') as HTMLButtonElement).disabled).toBe(true);
    await user.type(field(), 'молоко два литра');
    expect(parse).not.toHaveBeenCalled();
    expect(screen.queryByText('Будет добавлено · нажмите позицию, чтобы поправить')).toBeNull();
  });

  it('разобрать → показать → добавить; известные названия уходят на разбор', async () => {
    const parse = vi.fn(async () => [MILK, BREAD]);
    const { onAdd, onClose } = setup(parse);
    await user.type(field(), 'молоко два литра хлеб три штуки');
    await user.click(btn('Разобрать'));
    await waitFor(() => expect(screen.getByText('Будет добавлено · нажмите позицию, чтобы поправить')).toBeTruthy());
    expect(parse).toHaveBeenCalledWith('молоко два литра хлеб три штуки', ['Хлеб']);
    expect(screen.getByText('Молоко')).toBeTruthy();
    expect(screen.getByText('2 л')).toBeTruthy();
    expect(screen.getByText('× 3')).toBeTruthy();
    await user.click(btn('Добавить 2 позиции'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onAdd).toHaveBeenCalledWith([MILK, BREAD]);
  });

  it('лишнюю позицию можно убрать до добавления', async () => {
    const { onAdd } = setup(async () => [MILK, BREAD, FLOUR]);
    await user.type(field(), 'что-то');
    await user.click(btn('Разобрать'));
    await waitFor(() => btn('Добавить 3 позиции'));
    await user.click(btn('Убрать: Хлеб'));
    await user.click(btn('Добавить 2 позиции'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith([MILK, FLOUR]));
  });

  it('правка текста сбрасывает результат: добавить старое нельзя, нужно разобрать заново', async () => {
    setup(async () => [MILK]);
    await user.type(field(), 'молоко');
    await user.click(btn('Разобрать'));
    await waitFor(() => btn('Добавить 1 позицию'));
    await user.type(field(), ' и сыр');
    expect(screen.queryByRole('button', { name: /^Добавить \d/ })).toBeNull();
    expect(btn('Разобрать')).toBeTruthy();
  });

  it('ошибка разбора показывается, текст остаётся, можно повторить', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const parse = vi.fn().mockRejectedValueOnce(new Error('Нет связи с сервером.')).mockResolvedValueOnce([MILK]);
    setup(parse);
    await user.type(field(), 'молоко');
    await user.click(btn('Разобрать'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Нет связи'));
    expect((field() as HTMLTextAreaElement).value).toBe('молоко');
    await user.click(btn('Разобрать'));
    await waitFor(() => btn('Добавить 1 позицию'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ИИ не нашёл товаров — подсказка, добавить нечего', async () => {
    setup(async () => []);
    await user.type(field(), 'привет');
    await user.click(btn('Разобрать'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Не нашёл товаров'));
    expect(screen.queryByRole('button', { name: /^Добавить \d/ })).toBeNull();
  });

  it('двойной тап по «Разобрать» шлёт один запрос', async () => {
    let release: (v: ParsedItem[]) => void = () => {};
    const parse = vi.fn(() => new Promise<ParsedItem[]>((r) => (release = r)));
    setup(parse);
    await user.type(field(), 'молоко');
    await user.click(btn('Разобрать'));
    await user.click(screen.getByRole('button', { name: 'Разбираю…' }));
    expect(parse).toHaveBeenCalledTimes(1);
    release([MILK]);
    await waitFor(() => btn('Добавить 1 позицию'));
  });

  it('ошибка добавления остаётся в окне', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onAdd = vi.fn().mockRejectedValue(new Error('Не вышло сохранить'));
    const { onClose } = setup(async () => [MILK], onAdd);
    await user.type(field(), 'молоко');
    await user.click(btn('Разобрать'));
    await user.click(await waitFor(() => btn('Добавить 1 позицию')));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Не вышло сохранить'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('без записи голоса в браузере кнопки «Продиктовать» нет', () => {
    setup(async () => []);
    expect(screen.queryByRole('button', { name: 'Продиктовать' })).toBeNull();
  });
});

describe('«Добавить списком»: микрофон', () => {
  it('«Продиктовать» → видна запись с анимацией → «Остановить» → текст расшифровки и позиции', async () => {
    const { start, listen, rec } = setupVoice();
    await user.click(btn('Продиктовать'));
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(start).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Продиктовать' })).toBeNull();
    await user.click(btn('Остановить'));
    await waitFor(() => expect(screen.getByText('Будет добавлено · нажмите позицию, чтобы поправить')).toBeTruthy());
    expect(rec.stop).toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith(REC, ['Хлеб']);
    expect((field() as HTMLTextAreaElement).value).toBe('молоко два литра хлеб три штуки');
    expect(panel()).toBeNull();
    expect(btn('Добавить 2 позиции')).toBeTruthy();
  });

  it('«Отмена» выключает микрофон и ничего не отправляет', async () => {
    const { rec, listen } = setupVoice();
    await user.click(btn('Продиктовать'));
    await waitFor(() => expect(panel()).not.toBeNull());
    await user.click(btn('Отмена'));
    expect(rec.cancel).toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
    expect(btn('Продиктовать')).toBeTruthy();
  });

  it('нет доступа к микрофону — понятная ошибка, можно набрать текст', async () => {
    const { listen } = setupVoice({
      start: async () => {
        throw new Error('Нет доступа к микрофону.');
      },
    });
    await user.click(btn('Продиктовать'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Нет доступа к микрофону'));
    expect(panel()).toBeNull();
    expect(listen).not.toHaveBeenCalled();
    await user.type(field(), 'молоко');
    expect((btn('Разобрать') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ошибка разбора записи показывается, окно живо, повторить можно', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const listen = vi
      .fn()
      .mockRejectedValueOnce(new Error('Нет связи с сервером.'))
      .mockResolvedValueOnce({ items: [MILK], transcript: 'молоко' });
    setupVoice({ listen });
    await user.click(btn('Продиктовать'));
    await user.click(await waitFor(() => btn('Остановить')));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Нет связи'));
    expect(btn('Продиктовать')).toBeTruthy();
    await user.click(btn('Продиктовать'));
    await user.click(await waitFor(() => btn('Остановить')));
    await waitFor(() => btn('Добавить 1 позицию'));
  });

  it('закрыли окно во время записи — микрофон выключается', async () => {
    const { rec, ui } = setupVoice();
    await user.click(btn('Продиктовать'));
    await waitFor(() => expect(panel()).not.toBeNull());
    ui.unmount();
    expect(rec.cancel).toHaveBeenCalled();
  });

  it('после секунд записи таймер идёт', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setupVoice();
      await user.click(btn('Продиктовать'));
      await waitFor(() => expect(panel()).not.toBeNull());
      await act(async () => {
        vi.advanceTimersByTime(3100);
      });
      expect(panel()?.textContent).toContain('0:03');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('«Добавить списком»: правка позиций и каталог', () => {
  const parseTo = (items: ParsedItem[]) => async () => items;
  async function parsed(items: ParsedItem[]) {
    const ctx = setup(parseTo(items));
    await user.type(field(), 'что-то');
    await user.click(btn('Разобрать'));
    await waitFor(() => screen.getByText('Будет добавлено · нажмите позицию, чтобы поправить'));
    return ctx;
  }

  it('позиция из каталога: название как у вас, единица каталога, отметка и примерная цена', async () => {
    await parsed([
      { name: 'молока', qtyMilli: 2000, unit: 'pcs' },
      { name: 'сыр', qtyMilli: 1000, unit: 'pcs' },
    ]);
    // «молока» 2 шт: количество названо, единицу не меняем, но название — из каталога
    expect(screen.getByText('Молоко')).toBeTruthy();
    expect(screen.getByText('сыр')).toBeTruthy();
    expect(screen.getAllByText('в каталоге')).toHaveLength(1);
  });

  it('количество не названо — единица берётся из каталога, цена считается по памяти цен (13 с. за литр)', async () => {
    await parsed([{ name: 'молоко', qtyMilli: 1000, unit: 'pcs' }]);
    expect(screen.getByText('1 л')).toBeTruthy();
    expect(screen.getByText(/≈\s*13,00/)).toBeTruthy();
    expect(screen.getByText('в каталоге')).toBeTruthy();
  });

  it('нажали позицию — открылась правка; название, количество и единицу можно поменять, цена пересчитывается', async () => {
    const { onAdd } = await parsed([{ name: 'молоко', qtyMilli: 1000, unit: 'pcs' }]);
    await user.click(btn('Изменить: Молоко'));
    expect(editor()).not.toBeNull();
    await user.clear(screen.getByRole('textbox', { name: 'Количество, л' }));
    await user.type(screen.getByRole('textbox', { name: 'Количество, л' }), '2,5');
    expect(screen.getByText('2,5 л')).toBeTruthy();
    expect(screen.getByText(/≈\s*32,50/)).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'кг' }));
    expect(screen.getByText('2,5 кг')).toBeTruthy();
    expect(screen.queryByText(/≈/)).toBeNull(); // за килограмм молока цены нет
    await user.clear(screen.getByRole('textbox', { name: 'Название' }));
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Картошка');
    await user.click(btn('Готово'));
    expect(editor()).toBeNull();
    await user.click(btn('Добавить 1 позицию'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith([{ name: 'Картошка', qtyMilli: 2500, unit: 'kg' }]));
  });

  it('штуки — только целые: переход на «шт» округляет 1,5 вниз', async () => {
    const { onAdd } = await parsed([{ name: 'яблоки', qtyMilli: 1500, unit: 'kg' }]);
    await user.click(btn('Изменить: яблоки'));
    await user.click(screen.getByRole('radio', { name: 'шт' }));
    expect((screen.getByRole('textbox', { name: 'Количество, шт' }) as HTMLInputElement).value).toBe('1');
    await user.click(btn('Добавить 1 позицию'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith([{ name: 'яблоки', qtyMilli: 1000, unit: 'pcs' }]));
  });

  it('неверное количество и пустое название: понятная ошибка, в позиции остаётся прежнее', async () => {
    const { onAdd } = await parsed([{ name: 'хлеб', qtyMilli: 3000, unit: 'pcs' }]);
    await user.click(btn('Изменить: хлеб'));
    await user.clear(screen.getByRole('textbox', { name: 'Количество, шт' }));
    await user.type(screen.getByRole('textbox', { name: 'Количество, шт' }), '1,5');
    expect(screen.getByText('Штуки — целое число, например 3')).toBeTruthy();
    await user.clear(screen.getByRole('textbox', { name: 'Название' }));
    expect(screen.getByText('Впишите название товара')).toBeTruthy();
    await user.click(btn('Добавить 1 позицию'));
    // «1» набрано верно и сохранилось, «1,5» для штук нельзя — осталось последнее верное
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith([{ name: 'хлеб', qtyMilli: 1000, unit: 'pcs' }]));
  });

  it('при правке названия предлагаются позиции из каталога: выбор подставляет название и единицу', async () => {
    const { onAdd } = await parsed([{ name: 'масло', qtyMilli: 1000, unit: 'pcs' }]);
    await user.click(btn('Изменить: масло'));
    const chip = screen.getByRole('button', { name: 'Масло сливочное · шт' });
    await user.click(chip);
    expect((screen.getByRole('textbox', { name: 'Название' }) as HTMLInputElement).value).toBe('Масло сливочное');
    await user.click(btn('Добавить 1 позицию'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith([{ name: 'Масло сливочное', qtyMilli: 1000, unit: 'pcs' }]));
  });

  it('«Убрать» в правке и крестик в строке убирают позицию; убрали все — снова «Разобрать»', async () => {
    await parsed([
      { name: 'хлеб', qtyMilli: 1000, unit: 'pcs' },
      { name: 'соль', qtyMilli: 1000, unit: 'pcs' },
    ]);
    await user.click(btn('Изменить: хлеб'));
    await user.click(btn('Убрать позицию: хлеб'));
    expect(screen.queryByText('хлеб')).toBeNull();
    await user.click(btn('Убрать: соль'));
    expect(btn('Разобрать')).toBeTruthy();
  });
});
