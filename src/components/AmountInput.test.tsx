import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Minor } from '@/domain/types';
import { AmountInput } from './AmountInput';
import { Keypad } from './Keypad';
import { render, screen, user } from './testUtils';

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
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<AmountInput currency="TJS" value={null} onChange={() => {}} />);
    expect(input()).toHaveAttribute('inputmode', 'none');
  });

  it('без экранной клавиатуры на телефоне остаётся inputmode=decimal', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} }));
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
