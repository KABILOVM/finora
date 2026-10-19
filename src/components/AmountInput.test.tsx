import { act, createRef, useState, type MutableRefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Minor } from '@/domain/types';
import { AmountInput } from './AmountInput';
import { Keypad, type KeypadKey } from './Keypad';
import { fire, render, screen, user } from './testUtils';

const NB = ' ';
const nb = (s: string) => s.replace(/ /g, NB);

/** Управляемая обёртка: хранит значение, как это делает настоящая форма. */
function Harness({
  currency = 'TJS',
  initial = null,
  onValue,
}: {
  currency?: string;
  initial?: Minor | null;
  onValue?: (m: Minor | null) => void;
}) {
  const [v, setV] = useState<Minor | null>(initial);
  return (
    <AmountInput
      currency={currency}
      value={v}
      onChange={(m) => {
        setV(m);
        onValue?.(m);
      }}
    />
  );
}

const input = () => screen.getByRole('textbox', { name: /Сумма/ }) as HTMLInputElement;
const key = (name: string) => screen.getByRole('button', { name });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Keypad', () => {
  it('рисует цифры 0–9, запятую и «стереть»; все кнопки ≥ 56px высотой', () => {
    render(<Keypad onKey={() => {}} />);
    for (const d of '0123456789') expect(key(d)).toBeInTheDocument();
    expect(key('Запятая')).toBeInTheDocument();
    expect(key('Стереть')).toBeInTheDocument();
    expect(key('5').className).toContain('min-h-[56px]');
  });

  it('калькулятор: узкая строка ÷ × − + = над цифрами, «стереть» рядом с нулём, значки нарисованы (не буквами шрифта)', () => {
    render(<Keypad ops canEqual onKey={() => {}} />);
    const buttons = screen.getAllByRole('button');
    const names = buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names.slice(0, 5)).toEqual(['Разделить', 'Умножить', 'Минус', 'Плюс', 'Равно']);
    expect(names.slice(5)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Запятая', '0', 'Стереть']); // одна раскладка с обычной клавиатурой
    for (const n of ['Разделить', 'Умножить', 'Минус', 'Плюс', 'Равно']) {
      const b = key(n);
      expect(b.textContent, `${n}: значок, а не символ шрифта`).toBe('');
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.className, `${n}: область касания 44 px`).toContain('h-11');
    }
    expect(key('5').className).toContain('min-h-[56px]');
  });

  it('цифры идут 1-2-3 сверху и без калькулятора, и с ним — одна раскладка во всём приложении', () => {
    const order = () => screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '').filter((n) => /^\d$/.test(n));
    const { unmount } = render(<Keypad onKey={() => {}} />);
    expect(order()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
    unmount();
    render(<Keypad ops canEqual onKey={() => {}} />);
    expect(order()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
  });

  it('сообщает о нажатиях', async () => {
    const onKey = vi.fn();
    render(<Keypad onKey={onKey} />);
    await user.click(key('7'));
    await user.click(key('Запятая'));
    await user.click(key('Стереть'));
    expect(onKey.mock.calls.map((c) => c[0])).toEqual(['7', ',', 'backspace']);
  });

  it('без запятой (иена) кнопки «Запятая» нет', () => {
    render(<Keypad onKey={() => {}} allowComma={false} />);
    expect(screen.queryByRole('button', { name: 'Запятая' })).toBeNull();
  });
});

describe('AmountInput: экранная клавиатура', () => {
  it('«1», «2», «,», «5» → 1250 для TJS', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    for (const k of ['1', '2', 'Запятая', '5']) await user.click(key(k));
    expect(input().value).toBe('12,5');
    expect(onValue).toHaveBeenLastCalledWith(1250);
    // по шагам: 1 → 100, 12 → 1200, «12,» → 1200, «12,5» → 1250
    expect(onValue.mock.calls.map((c) => c[0])).toEqual([100, 1200, 1200, 1250]);
  });

  it('символ валюты рядом с суммой', () => {
    render(<Harness />);
    expect(screen.getByText('с.')).toBeInTheDocument();
  });

  it('лишние знаки после запятой не вводятся', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    for (const k of ['1', 'Запятая', '2', '5', '9', '9']) await user.click(key(k));
    expect(input().value).toBe('1,25');
    expect(onValue).toHaveBeenLastCalledWith(125);
    expect(onValue).toHaveBeenCalledTimes(4); // лишние нажатия событий не порождают
  });

  it('вторая запятая игнорируется, запятая первой даёт «0,»', async () => {
    render(<Harness />);
    await user.click(key('Запятая'));
    expect(input().value).toBe('0,');
    await user.click(key('Запятая'));
    expect(input().value).toBe('0,');
    await user.click(key('5'));
    expect(input().value).toBe('0,5');
  });

  it('«⌫» стирает по символу, пустое поле → null', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    for (const k of ['1', '2', 'Запятая', '5']) await user.click(key(k));
    await user.click(key('Стереть'));
    expect(input().value).toBe('12,');
    expect(onValue).toHaveBeenLastCalledWith(1200);
    await user.click(key('Стереть'));
    await user.click(key('Стереть'));
    await user.click(key('Стереть'));
    expect(input().value).toBe('');
    expect(onValue).toHaveBeenLastCalledWith(null);
    const calls = onValue.mock.calls.length;
    await user.click(key('Стереть')); // стирать нечего
    expect(onValue).toHaveBeenCalledTimes(calls);
  });

  it('ноль отдаётся как 0 (проверку «> 0» делает форма), без ведущих нулей', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.click(key('0'));
    expect(onValue).toHaveBeenLastCalledWith(0);
    await user.click(key('0'));
    expect(input().value).toBe('0');
    await user.click(key('7'));
    expect(input().value).toBe('7');
    expect(onValue).toHaveBeenLastCalledWith(700);
  });

  it('максимум 15 цифр (иена: 15 цифр целой части)', async () => {
    const onValue = vi.fn();
    render(<Harness currency="JPY" onValue={onValue} />);
    for (let i = 0; i < 20; i++) await user.click(key('1'));
    expect(input().value.replace(/\D/g, '')).toHaveLength(15);
    expect(input().value).toBe(nb('111 111 111 111 111'));
    expect(onValue).toHaveBeenLastCalledWith(111_111_111_111_111);
    expect(onValue).toHaveBeenCalledTimes(15);
  });

  it('максимум 15 цифр в минорных единицах (сомони: 13 до запятой + 2 после)', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    for (let i = 0; i < 20; i++) await user.click(key('9'));
    expect(input().value.replace(/\D/g, '')).toHaveLength(13);
    await user.click(key('Запятая'));
    for (let i = 0; i < 5; i++) await user.click(key('9'));
    expect(input().value).toBe(nb('9 999 999 999 999,99'));
    const last = onValue.mock.calls.at(-1)?.[0] as number;
    expect(last).toBe(999_999_999_999_999);
    expect(Number.isSafeInteger(last)).toBe(true);
  });

  it('иена: без дробной части — кнопки запятой нет, «12,5» не набрать', async () => {
    const onValue = vi.fn();
    render(<Harness currency="JPY" onValue={onValue} />);
    expect(screen.queryByRole('button', { name: 'Запятая' })).toBeNull();
    await user.click(key('1'));
    await user.click(key('2'));
    expect(onValue).toHaveBeenLastCalledWith(12); // у иены минорная единица = 1 иена
    expect(input().value).toBe('12');
  });

  it('тысячи разделены неразрывным пробелом', async () => {
    render(<Harness />);
    for (const d of '1234567') await user.click(key(d));
    expect(input().value).toBe(nb('1 234 567'));
  });
});

describe('AmountInput: системная клавиатура (ПК)', () => {
  it('inputmode=decimal (иена — numeric)', () => {
    const { rerender } = render(<AmountInput currency="TJS" value={null} onChange={() => {}} />);
    expect(input()).toHaveAttribute('inputmode', 'decimal');
    rerender(<AmountInput currency="JPY" value={null} onChange={() => {}} />);
    expect(input()).toHaveAttribute('inputmode', 'numeric');
  });

  it('на телефоне (грубый указатель) системная клавиатура не выскакивает: inputmode=none', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('coarse'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(<AmountInput currency="TJS" value={null} onChange={() => {}} />);
    expect(input()).toHaveAttribute('inputmode', 'none');
  });

  it('без экранной клавиатуры на телефоне остаётся inputmode=decimal', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('coarse'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(<AmountInput currency="TJS" value={null} onChange={() => {}} showKeypad={false} />);
    expect(input()).toHaveAttribute('inputmode', 'decimal');
    expect(screen.queryByRole('group', { name: 'Цифровая клавиатура' })).toBeNull();
  });

  it('печать «12,5» → 1250; точка тоже считается запятой', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.type(input(), '12,5');
    expect(onValue).toHaveBeenLastCalledWith(1250);
    await user.clear(input());
    expect(onValue).toHaveBeenLastCalledWith(null);
    await user.type(input(), '7.25');
    expect(onValue).toHaveBeenLastCalledWith(725);
  });

  it('буквы и минус отбрасываются, лишние знаки не вводятся', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.type(input(), 'abc-1x2,345');
    expect(input().value).toBe('12,34');
    expect(onValue).toHaveBeenLastCalledWith(1234);
  });

  it('вставка из буфера очищается тем же правилом', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.click(input());
    await user.paste('1 234,56 с.');
    expect(onValue).toHaveBeenLastCalledWith(123456);
    expect(input().value).toBe(nb('1 234,56'));
  });

  it('вставка с разделителем тысяч: «1.234,56» и «1,234.56» дают 1 234,56, а не 1,23', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.click(input());
    await user.paste('1.234,56');
    expect(onValue).toHaveBeenLastCalledWith(123456);
    expect(input().value).toBe(nb('1 234,56'));
    await user.clear(input());
    await user.paste('1,234.56');
    expect(onValue).toHaveBeenLastCalledWith(123456);
  });

  it('вставка, которую нельзя прочитать однозначно, отвергается целиком: сумма не меняется, причина видна', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.type(input(), '5');
    onValue.mockClear();
    for (const bad of ['1.234', '12,505', '1e5', 'сумма не указана 7 и 8']) {
      await user.clear(input());
      await user.type(input(), '5');
      onValue.mockClear();
      await user.paste(bad);
      expect(input().value, bad).toBe('5');
      expect(onValue, bad).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('Не удалось прочитать сумму');
    }
    // следующая удачная правка убирает сообщение
    await user.type(input(), '0');
    expect(input().value).toBe('50');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('лишняя цифра после копеек при наборе просто не принимается, без сообщения', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.type(input(), '1,234');
    expect(input().value).toBe('1,23');
    expect(onValue).toHaveBeenLastCalledWith(123);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('иена: «12.5» с клавиатуры ПК не превращается в 125 — после точки цифры не принимаются', async () => {
    const onValue = vi.fn();
    render(<Harness currency="JPY" onValue={onValue} />);
    await user.type(input(), '12.5');
    expect(onValue).toHaveBeenLastCalledWith(12);
    expect(input().value).toBe('12,');
    await user.keyboard('{Backspace}');
    expect(input().value).toBe('12');
  });

  it('Backspace с клавиатуры стирает последнюю цифру', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.type(input(), '123');
    await user.keyboard('{Backspace}');
    expect(onValue).toHaveBeenLastCalledWith(1200);
  });

  it('клавиши экранной клавиатуры не уводят фокус из поля', async () => {
    render(<Harness />);
    input().focus();
    await user.click(key('5'));
    expect(input()).toHaveFocus();
  });
});

describe('AmountInput: внешнее значение и валюта', () => {
  it('подхватывает внешнее значение (редактирование операции, сброс формы)', () => {
    const { rerender } = render(<AmountInput currency="TJS" value={1250} onChange={() => {}} />);
    expect(input().value).toBe('12,5');
    rerender(<AmountInput currency="TJS" value={null} onChange={() => {}} />);
    expect(input().value).toBe('');
    rerender(<AmountInput currency="TJS" value={100_000} onChange={() => {}} />);
    expect(input().value).toBe(nb('1 000'));
  });

  it('набранное «12,» не затирается эхом значения 1200 от родителя', async () => {
    render(<Harness />);
    await user.click(key('1'));
    await user.click(key('2'));
    await user.click(key('Запятая'));
    expect(input().value).toBe('12,');
  });

  it('смена валюты на иену отбрасывает дробную часть (12,5 → 12, не 125) и сообщает родителю новую сумму', async () => {
    const onValue = vi.fn();
    const { rerender } = render(<Harness currency="TJS" onValue={onValue} />);
    await user.type(input(), '12,5');
    expect(onValue).toHaveBeenLastCalledWith(1250);
    onValue.mockClear();
    rerender(<Harness currency="JPY" onValue={onValue} />);
    expect(input().value).toBe('12');
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue).toHaveBeenCalledWith(12);
  });

  it('смена валюты, при которой сумма не помещается в предел, очищает поле', async () => {
    const onValue = vi.fn();
    const { rerender } = render(<Harness currency="JPY" onValue={onValue} />);
    await user.type(input(), '1'.repeat(15));
    onValue.mockClear();
    rerender(<Harness currency="TJS" onValue={onValue} />);
    expect(input().value).toBe('');
    expect(onValue).toHaveBeenCalledWith(null);
  });

  it('ошибка показывается и привязана к полю', () => {
    render(<AmountInput currency="TJS" value={null} onChange={() => {}} error="Введите сумму" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Введите сумму');
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(input().getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  });

  it('autoFocus ставит фокус в поле', () => {
    render(<AmountInput currency="TJS" value={null} onChange={() => {}} autoFocus />);
    expect(input()).toHaveFocus();
  });
});

describe('AmountInput: калькулятор', () => {
  const Calc = ({ onValue }: { onValue?: (m: Minor | null) => void }) => {
    const [v, setV] = useState<Minor | null>(null);
    return (
      <AmountInput
        currency="TJS"
        value={v}
        calculator
        onChange={(m) => {
          setV(m);
          onValue?.(m);
        }}
      />
    );
  };

  it('без calculator кнопок знаков нет', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Плюс' })).toBeNull();
  });

  it('экранная клавиатура: 12 × 3 → результат сразу, «=» заменяет выражение суммой', async () => {
    const onValue = vi.fn();
    render(<Calc onValue={onValue} />);
    for (const k of ['1', '2', 'Умножить', '3']) await user.click(key(k));
    expect(onValue).toHaveBeenLastCalledWith(3600);
    await user.click(screen.getByRole('button', { name: /^= 36/ }));
    expect(input().value).toBe('36');
    expect(onValue).toHaveBeenLastCalledWith(3600);
  });

  it('пока выражение не дописано, суммы нет (null)', async () => {
    const onValue = vi.fn();
    render(<Calc onValue={onValue} />);
    for (const k of ['5', 'Плюс']) await user.click(key(k));
    expect(onValue).toHaveBeenLastCalledWith(null);
  });

  it('деление на ноль — сообщение и null', async () => {
    const onValue = vi.fn();
    render(<Calc onValue={onValue} />);
    for (const k of ['5', 'Разделить', '0']) await user.click(key(k));
    expect(screen.getByRole('alert').textContent).toContain('На ноль делить нельзя');
    expect(onValue).toHaveBeenLastCalledWith(null);
  });

  it('стёрли знак — обычное число', async () => {
    const onValue = vi.fn();
    render(<Calc onValue={onValue} />);
    for (const k of ['7', 'Плюс', 'Стереть']) await user.click(key(k));
    expect(input().value).toBe('7');
    expect(onValue).toHaveBeenLastCalledWith(700);
  });

  it('клавиатура ПК: «10/4» и Enter → 2,5', async () => {
    const onValue = vi.fn();
    render(<Calc onValue={onValue} />);
    await user.type(input(), '10/4');
    expect(onValue).toHaveBeenLastCalledWith(250);
    await user.keyboard('{Enter}');
    expect(input().value).toBe('2,5');
  });

  it('клавиатура ПК: «x» между числами — умножение', async () => {
    const onValue = vi.fn();
    render(<Calc onValue={onValue} />);
    await user.type(input(), '12x3');
    expect(onValue).toHaveBeenLastCalledWith(3600);
  });

  it('вставка из СМС банка («-150,00 TJS», «Расход 150 TJS», «-150,00») читается как сумма, а не как выражение', async () => {
    const onValue = vi.fn();
    render(<Calc onValue={onValue} />);
    for (const [text, minor, shown] of [
      ['-150,00 TJS', 15_000, '150,00'],
      ['Расход 150 TJS', 15_000, '150'],
      ['−150,00', 15_000, '150,00'],
      ['Оплата: 1 234,56 TJS', 123_456, nb('1 234,56')],
    ] as const) {
      await user.clear(input());
      onValue.mockClear();
      await user.paste(text);
      expect(onValue, text).toHaveBeenLastCalledWith(minor);
      expect(input().value, text).toBe(shown);
    }
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('буква в слове не становится умножением: «150 TJS Taxi 2» не превращается в 300', async () => {
    const onValue = vi.fn();
    render(<Calc onValue={onValue} />);
    await user.type(input(), '5');
    onValue.mockClear();
    await user.paste('150 TJS Taxi 2');
    expect(onValue).not.toHaveBeenCalled();
    expect(input().value).toBe('5');
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось прочитать сумму');
  });

  it('текст со словами, вставленный вместо выражения, заменяет его суммой; лишний знак в выражении просто не принимается', async () => {
    const onValue = vi.fn();
    render(<Calc onValue={onValue} />);
    await user.type(input(), '5+');
    expect(onValue).toHaveBeenLastCalledWith(null);
    await user.type(input(), '+');
    expect(input().value.replace(/\s/g, '')).toBe('5+');
    await user.clear(input());
    await user.type(input(), '5+');
    input().setSelectionRange(0, input().value.length); // выделили всё выражение
    await user.paste('Расход 150 TJS');
    expect(onValue).toHaveBeenLastCalledWith(15_000);
    expect(input().value).toBe('150');
    expect(screen.queryByRole('button', { name: /^=/ })).toBeNull();
  });

  it('набранная буква внутри выражения — опечатка: «12+» остаётся, следующая цифра продолжает выражение (12+3 = 15, а не 123)', async () => {
    const onValue = vi.fn();
    render(<Calc onValue={onValue} />);
    await user.type(input(), '12+');
    await user.type(input(), 'б');
    expect(input().value.replace(/\s/g, '')).toBe('12+');
    expect(onValue).toHaveBeenLastCalledWith(null);
    await user.type(input(), '3');
    expect(onValue).toHaveBeenLastCalledWith(1500);
  });

  it('число со знаком из банка («-150,00»), вставленное поверх выражения, заменяет его суммой', async () => {
    const onValue = vi.fn();
    render(<Calc onValue={onValue} />);
    await user.type(input(), '5+2');
    input().setSelectionRange(0, input().value.length);
    await user.paste('-150,00');
    expect(onValue).toHaveBeenLastCalledWith(15_000);
    expect(input().value).toBe('150,00');
  });
});

describe('AmountInput: клавиши из чужой клавиатуры (keyRef)', () => {
  const Fee = ({ keyRef, onValue }: { keyRef: MutableRefObject<((k: KeypadKey) => void) | null>; onValue: (m: Minor | null) => void }) => {
    const [v, setV] = useState<Minor | null>(null);
    return (
      <AmountInput
        currency="TJS"
        label="Комиссия"
        value={v}
        showKeypad={false}
        keyRef={keyRef}
        onChange={(m) => {
          setV(m);
          onValue(m);
        }}
      />
    );
  };
  const press = (ref: MutableRefObject<((k: KeypadKey) => void) | null>, keys: KeypadKey[]) => {
    for (const k of keys) act(() => ref.current!(k));
  };
  const feeInput = () => screen.getByRole('textbox', { name: /Комиссия/ }) as HTMLInputElement;

  it('«2», «,», «5» → в поле 2,5 и 250; запятая видна сразу; «⌫» стирает по знаку', () => {
    const ref = createRef<((k: KeypadKey) => void) | null>() as MutableRefObject<((k: KeypadKey) => void) | null>;
    const onValue = vi.fn();
    render(<Fee keyRef={ref} onValue={onValue} />);
    press(ref, ['2', ',']);
    expect(feeInput().value).toBe('2,');
    press(ref, ['5']);
    expect(feeInput().value).toBe('2,5');
    expect(onValue).toHaveBeenLastCalledWith(250);
    press(ref, ['backspace']);
    expect(feeInput().value).toBe('2,');
    expect(onValue).toHaveBeenLastCalledWith(200);
    press(ref, ['0', '5']);
    expect(feeInput().value).toBe('2,05');
    expect(onValue).toHaveBeenLastCalledWith(205);
  });

  it('без калькулятора знаки и «=» ничего не делают; поле ушло с экрана — обработчика нет', () => {
    const ref = createRef<((k: KeypadKey) => void) | null>() as MutableRefObject<((k: KeypadKey) => void) | null>;
    const onValue = vi.fn();
    const { unmount } = render(<Fee keyRef={ref} onValue={onValue} />);
    press(ref, ['0', ',', '5', '+', '×', '=']);
    expect(feeInput().value).toBe('0,5');
    expect(onValue).toHaveBeenLastCalledWith(50);
    unmount();
    expect(ref.current).toBeNull();
  });
});

describe('AmountInput: невысокий экран (compact)', () => {
  const MEDIA = '[@media(max-height:700px)]:text-4xl';

  it('короткая сумма: на невысоком экране шрифт на ступень мельче (text-4xl), символ валюты тоже', () => {
    render(<AmountInput currency="TJS" value={1250} onChange={() => {}} compact />);
    expect(input().className).toContain('text-5xl');
    expect(input().className).toContain(MEDIA);
    expect(screen.getByText('с.').className).toContain('[@media(max-height:700px)]:text-xl');
  });

  it('длинная сумма мельчает по длине, как и без compact: принудительного text-4xl нет', () => {
    render(<AmountInput currency="TJS" value={12_345_678_901} onChange={() => {}} compact />); // «123 456 789,01»
    expect(input().className).toContain('text-3xl');
    expect(input().className).not.toContain('text-4xl');
  });

  it('без compact (поле комиссии и другие) шрифт не зависит от высоты экрана', () => {
    render(<AmountInput currency="TJS" value={1250} onChange={() => {}} />);
    expect(input().className).toContain('text-5xl');
    expect(input().className).not.toContain('max-height');
  });
});

describe('Keypad: раскладка калькулятора', () => {
  it('кнопка «=» неактивна без выражения и считает по нажатию', async () => {
    const Calc = () => {
      const [v, setV] = useState<Minor | null>(null);
      return <AmountInput currency="TJS" value={v} calculator onChange={setV} />;
    };
    render(<Calc />);
    expect((key('Равно') as HTMLButtonElement).disabled).toBe(true);
    for (const k of ['9', 'Минус', '4']) await user.click(key(k));
    expect((key('Равно') as HTMLButtonElement).disabled).toBe(false);
    await user.click(key('Равно'));
    expect(input().value).toBe('5');
  });
});

describe('Enter в поле суммы (ПК)', () => {
  const Submit = ({ onSubmit, calculator = true }: { onSubmit: (more: boolean) => void; calculator?: boolean }) => {
    const [v, setV] = useState<Minor | null>(null);
    return <AmountInput currency="TJS" value={v} onChange={setV} calculator={calculator} onSubmit={onSubmit} />;
  };

  it('Enter — сохранить (more = false), Ctrl/⌘+Enter — сохранить и добавить ещё (more = true)', async () => {
    const onSubmit = vi.fn();
    render(<Submit onSubmit={onSubmit} />);
    await user.type(input(), '25');
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenLastCalledWith(false);
    fire(input(), new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onSubmit).toHaveBeenLastCalledWith(true);
    fire(input(), new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    expect(onSubmit).toHaveBeenLastCalledWith(true);
    expect(onSubmit).toHaveBeenCalledTimes(3);
  });

  it('пока в поле выражение, Enter его считает, а не отправляет форму; следующий Enter — отправляет', async () => {
    const onSubmit = vi.fn();
    render(<Submit onSubmit={onSubmit} />);
    await user.type(input(), '10/4');
    await user.keyboard('{Enter}');
    expect(input().value).toBe('2,5');
    expect(onSubmit).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('зажатый Enter (автоповтор) не отправляет форму снова и снова', async () => {
    const onSubmit = vi.fn();
    render(<Submit onSubmit={onSubmit} />);
    await user.type(input(), '5');
    fire(input(), new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fire(input(), new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }));
    fire(input(), new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('без onSubmit Enter ничего не делает', async () => {
    render(<Harness />);
    await user.type(input(), '5');
    await user.keyboard('{Enter}');
    expect(input().value).toBe('5');
  });
});
