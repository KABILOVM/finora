import { describe, expect, it, vi } from 'vitest';
import type { ParsedItem } from '@/domain/shoppingAi';
import type { AiListResult } from './aiList';
import type { ActiveRecorder, Recording, StartRecorder } from './recorder';
import { act, render, screen, user, waitFor } from '@/components/testUtils';
import { ListTextSheet } from './ListTextSheet';

const MILK: ParsedItem = { name: 'Молоко', qtyMilli: 2000, unit: 'l' };
const BREAD: ParsedItem = { name: 'Хлеб', qtyMilli: 3000, unit: 'pcs' };
const FLOUR: ParsedItem = { name: 'Мука', qtyMilli: 1000, unit: 'pcs' };

const REC: Recording = { blob: new Blob(['x'], { type: 'audio/mp4' }), mime: 'audio/mp4' };

function setup(parse: (t: string, k: readonly string[]) => Promise<ParsedItem[]>, onAdd = vi.fn(async () => {})) {
  const onClose = vi.fn();
  render(<ListTextSheet known={['Хлеб']} parse={parse} listen={vi.fn()} canRecord={false} onAdd={onAdd} onClose={onClose} />);
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
    <ListTextSheet known={['Хлеб']} parse={vi.fn()} listen={listen} startRecording={start} canRecord onAdd={onAdd} onClose={onClose} />,
  );
  return { rec, start, listen, onAdd, onClose, ui };
}
const panel = () => document.querySelector('[data-testid="record-panel"]') as HTMLElement | null;
const field = () => screen.getByRole('textbox', { name: 'Что купить' });
const btn = (name: string | RegExp) => screen.getByRole('button', { name });

describe('«Добавить списком» с ИИ', () => {
  it('пока текста нет, «Разобрать» недоступна; обычного разбора по буквам больше нет', async () => {
    const parse = vi.fn(async () => [MILK]);
    setup(parse);
    expect((btn('Разобрать') as HTMLButtonElement).disabled).toBe(true);
    await user.type(field(), 'молоко два литра');
    expect(parse).not.toHaveBeenCalled();
    expect(screen.queryByText('Будет добавлено · проверьте')).toBeNull();
  });

  it('разобрать → показать → добавить; известные названия уходят на разбор', async () => {
    const parse = vi.fn(async () => [MILK, BREAD]);
    const { onAdd, onClose } = setup(parse);
    await user.type(field(), 'молоко два литра хлеб три штуки');
    await user.click(btn('Разобрать'));
    await waitFor(() => expect(screen.getByText('Будет добавлено · проверьте')).toBeTruthy());
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
    await waitFor(() => expect(screen.getByText('Будет добавлено · проверьте')).toBeTruthy());
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
