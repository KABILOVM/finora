import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { ChipPicker } from './ChipPicker';
import { EmojiPicker, DEFAULT_EMOJIS } from './EmojiPicker';
import { EmptyState } from './EmptyState';
import { TextArea, TextInput } from './Field';
import { Icon, ICON_NAMES } from './Icon';
import { ListRow } from './ListRow';
import { MoneyText } from './MoneyText';
import { Segmented } from './Segmented';
import { ToastProvider, useToast } from './Toast';
import { act, render, screen, user } from './testUtils';

const NB = ' ';

describe('Button', () => {
  it('loading: заблокирована, aria-busy, повторный тап не вызывает действие', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Сохранить
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Сохранить' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
    await user.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('по умолчанию type="button" (не отправляет форму случайно) и область касания ≥ 44px', () => {
    render(<Button>Ок</Button>);
    const b = screen.getByRole('button', { name: 'Ок' });
    expect(b).toHaveAttribute('type', 'button');
    expect(b.className).toContain('min-h-[44px]');
  });

  it('варианты различаются по стилю', () => {
    render(
      <>
        <Button variant="primary">П</Button>
        <Button variant="secondary">В</Button>
        <Button variant="ghost">Г</Button>
        <Button variant="danger">О</Button>
      </>,
    );
    const classes = ['П', 'В', 'Г', 'О'].map((n) => screen.getByRole('button', { name: n }).className);
    expect(new Set(classes).size).toBe(4);
  });
});

describe('Icon', () => {
  it('все иконки из списка рисуются как svg и декоративные по умолчанию', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(22);
    for (const name of [
      'home', 'list', 'wallet', 'more', 'plus', 'check', 'close', 'chevron', 'trash', 'edit', 'cloud', 'cloud-off',
      'cloud-check', 'refresh', 'lock', 'download', 'upload', 'search', 'calendar', 'transfer', 'alert', 'info',
    ] as const) {
      expect(ICON_NAMES).toContain(name);
    }
    const { container } = render(<Icon name="home" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    for (const name of ICON_NAMES) {
      const v = render(<Icon name={name} />);
      expect(v.container.querySelector('svg')?.children.length).toBeGreaterThan(0);
      v.unmount();
    }
  });

  it('с label — картинка с именем', () => {
    render(<Icon name="alert" label="Внимание" />);
    expect(screen.getByRole('img', { name: 'Внимание' })).toBeInTheDocument();
  });
});

describe('MoneyText', () => {
  it('форматирует через formatMinor: «1 234,50 с.»', () => {
    render(<MoneyText minor={123450} currency="TJS" fraction="always" />);
    expect(screen.getByText(`1${NB}234,50${NB}с.`)).toBeInTheDocument();
  });

  it('цвет по знаку', () => {
    render(
      <>
        <MoneyText minor={500} currency="TJS" />
        <MoneyText minor={-500} currency="TJS" />
        <MoneyText minor={0} currency="TJS" />
      </>,
    );
    expect(screen.getByText(`5${NB}с.`).className).toContain('text-income');
    expect(screen.getByText(`−5${NB}с.`).className).toContain('text-expense');
    expect(screen.getByText(`0${NB}с.`).className).toContain('text-muted');
  });

  it('tone="none" не красит, цифры одной ширины и без переноса', () => {
    render(<MoneyText minor={-500} currency="TJS" tone="none" />);
    const el = screen.getByText(`−5${NB}с.`);
    expect(el.className).not.toContain('text-expense');
    expect(el.className).toContain('money'); // .money = tabular-nums + nowrap (src/index.css)
  });

  it('валюта без дробной части (иена)', () => {
    render(<MoneyText minor={1500} currency="JPY" />);
    expect(screen.getByText(`1${NB}500${NB}JP¥`)).toBeInTheDocument();
  });

  it('битая сумма не роняет экран: «—»', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MoneyText minor={12.5} currency="TJS" />);
    expect(screen.getByText('—')).toHaveAttribute('aria-label', 'Некорректная сумма');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Segmented', () => {
  const OPTIONS = [
    { value: 'expense', label: 'Расход', tone: 'expense' },
    { value: 'income', label: 'Доход', tone: 'income' },
    { value: 'transfer', label: 'Перевод' },
  ] as const;

  function Harness() {
    const [v, setV] = useState<(typeof OPTIONS)[number]['value']>('expense');
    return <Segmented ariaLabel="Тип операции" options={OPTIONS} value={v} onChange={setV} />;
  }

  it('радио-группа: выбранный отмечен, остальные нет; в Tab-порядке только выбранный', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Тип операции' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Расход' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Доход' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Доход' })).toHaveAttribute('tabindex', '-1');
  });

  it('клик и стрелки переключают (по кругу), фокус идёт за выбором', async () => {
    render(<Harness />);
    await user.click(screen.getByRole('radio', { name: 'Доход' }));
    expect(screen.getByRole('radio', { name: 'Доход' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Перевод' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Перевод' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Расход' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Перевод' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('ChipPicker и EmojiPicker', () => {
  it('ChipPicker: выбор по нажатию, aria-pressed у выбранного', async () => {
    const onChange = vi.fn();
    render(
      <ChipPicker
        ariaLabel="Категория"
        value="food"
        onChange={onChange}
        options={[
          { value: 'food', label: 'Еда', icon: '🍔' },
          { value: 'home', label: 'Дом', icon: '🏠' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: /Еда/, pressed: true })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Дом/ }));
    expect(onChange).toHaveBeenCalledWith('home');
  });

  it('EmojiPicker: выбор значка, выбранный отмечен', async () => {
    const onChange = vi.fn();
    render(<EmojiPicker value="🍔" onChange={onChange} />);
    expect(screen.getByRole('button', { name: '🍔', pressed: true })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '🏠' }));
    expect(onChange).toHaveBeenCalledWith('🏠');
  });

  it('в наборе эмодзи нет повторов', () => {
    expect(new Set(DEFAULT_EMOJIS).size).toBe(DEFAULT_EMOJIS.length);
  });
});

describe('Field / TextInput / TextArea', () => {
  it('подпись связана с полем, ошибка объявляется и привязана через aria-describedby', () => {
    render(<TextInput label="Название" error="Введите название" />);
    const input = screen.getByRole('textbox', { name: 'Название' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
    expect(screen.getByRole('alert')).toHaveTextContent('Введите название');
  });

  it('подсказка показывается, пока нет ошибки', () => {
    const { rerender } = render(<TextArea label="Заметка" hint="Необязательно" />);
    expect(screen.getByText('Необязательно')).toBeInTheDocument();
    rerender(<TextArea label="Заметка" hint="Необязательно" error="Слишком длинно" />);
    expect(screen.queryByText('Необязательно')).toBeNull();
  });
});

describe('ListRow и EmptyState', () => {
  it('ListRow с onClick — кнопка на всю строку', async () => {
    const onClick = vi.fn();
    render(<ListRow title="Наличные" subtitle="Кошелёк" trailing="100" onClick={onClick} chevron />);
    await user.click(screen.getByRole('button', { name: /Наличные/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ListRow без onClick — обычная строка', () => {
    render(<ListRow title="Итого" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('EmptyState: заголовок, текст, кнопка действия; эмодзи вместо иконки', () => {
    render(<EmptyState icon="🧾" title="Пусто" text="Добавьте первую операцию" action={<Button>Добавить</Button>} />);
    expect(screen.getByRole('heading', { name: 'Пусто' })).toBeInTheDocument();
    expect(screen.getByText('Добавьте первую операцию')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument();
  });
});

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function Trigger({ onUndo }: { onUndo?: () => void }) {
    const toast = useToast();
    return (
      <>
        <button onClick={() => toast.success('Сохранено')}>ok</button>
        <button onClick={() => toast.error('Не удалось сохранить')}>fail</button>
        <button onClick={() => toast.show('Удалено', { action: { label: 'Отменить', onClick: () => onUndo?.() } })}>del</button>
      </>
    );
  }

  it('показывается и сам исчезает (успех — 4 с, ошибка — 7 с)', async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'ok' }));
    await user.click(screen.getByRole('button', { name: 'fail' }));
    expect(screen.getByRole('status')).toHaveTextContent('Сохранено');
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить');
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('кнопка действия («Отменить») вызывает колбэк и закрывает тост', async () => {
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'del' }));
    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Удалено')).toBeNull();
  });

  it('крестик закрывает; одновременно видно не больше трёх', async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    for (let i = 0; i < 5; i++) await user.click(screen.getByRole('button', { name: 'ok' }));
    expect(screen.getAllByRole('status')).toHaveLength(3);
    await user.click(screen.getAllByRole('button', { name: 'Закрыть уведомление' })[0] as HTMLElement);
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('useToast вне провайдера — понятная ошибка разработчику', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mute = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', mute);
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
    window.removeEventListener('error', mute);
    spy.mockRestore();
  });
});
