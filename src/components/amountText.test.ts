import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exponentOf } from '@/domain/currency';
import { parseAmountToMinor } from '@/domain/money';
import { applyKey, clampToCurrency, draftToMinor, formatDraft, minorToDraft, sanitizeAmountText, type AmountKey } from './amountText';

const KEYS: AmountKey[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ',', 'backspace'];

function press(keys: string, currency: string, start = ''): string {
  let t = start;
  for (const k of keys) t = applyKey(t, (k === '<' ? 'backspace' : k) as AmountKey, currency);
  return t;
}

describe('applyKey', () => {
  it('набор «1 2 , 5» даёт черновик 12,5', () => {
    expect(press('12,5', 'TJS')).toBe('12,5');
  });

  it('не даёт ввести больше знаков, чем у валюты', () => {
    expect(press('12,555', 'TJS')).toBe('12,55');
    expect(press('12,5', 'JPY')).toBe('125'); // у иены запятой нет — цифры просто продолжаются
  });

  it('запятая: одна, у иены нет, в пустом поле даёт «0,»', () => {
    expect(press('1,2,3', 'TJS')).toBe('1,23');
    expect(press(',', 'TJS')).toBe('0,');
    expect(press('12,', 'JPY')).toBe('12');
    expect(press(',', 'JPY')).toBe('');
  });

  it('без ведущих нулей', () => {
    expect(press('00', 'TJS')).toBe('0');
    expect(press('005', 'TJS')).toBe('5');
    expect(press('0,05', 'TJS')).toBe('0,05');
  });

  it('стирание: по символу, пустое остаётся пустым', () => {
    expect(press('12,5<', 'TJS')).toBe('12,');
    expect(press('12,5<<', 'TJS')).toBe('12');
    expect(press('1<<<', 'TJS')).toBe('');
    expect(press('0,<', 'TJS')).toBe('0');
  });

  it('предел: 15 цифр в минорных единицах', () => {
    // иена: 15 цифр целой части
    expect(press('1'.repeat(20), 'JPY')).toBe('1'.repeat(15));
    // сомони: 13 цифр до запятой + 2 после = 15
    expect(press('9'.repeat(20), 'TJS')).toBe('9'.repeat(13));
    expect(press('9'.repeat(20) + ',999', 'TJS')).toBe('9'.repeat(13) + ',99');
  });
});

describe('sanitizeAmountText (вставка и системная клавиатура)', () => {
  it('убирает пробелы всех видов, буквы, знак и символ валюты вокруг числа; точку считает запятой', () => {
    expect(sanitizeAmountText('1 234,5', 'TJS')).toBe('1234,5');
    expect(sanitizeAmountText('1 234.5', 'TJS')).toBe('1234,5');
    expect(sanitizeAmountText('1\u00A0234\u202F567', 'TJS')).toBe('1234567');
    expect(sanitizeAmountText('сумма 12abc', 'TJS')).toBe('12');
    expect(sanitizeAmountText('-12', 'TJS')).toBe('12'); // минус не принимается
    expect(sanitizeAmountText('1 234,56 с.', 'TJS')).toBe('1234,56'); // точка в «с.» — не разделитель
    expect(sanitizeAmountText('$12.50', 'USD')).toBe('12,50');
  });

  it('понимает разделитель тысяч: «1.234,56», «1,234.56», «1.234.567», «1,234,567.89»', () => {
    expect(sanitizeAmountText('1.234,56', 'TJS')).toBe('1234,56');
    expect(sanitizeAmountText('1,234.56', 'TJS')).toBe('1234,56');
    expect(sanitizeAmountText('1.234.567', 'TJS')).toBe('1234567');
    expect(sanitizeAmountText('1,234,567.89', 'TJS')).toBe('1234567,89');
    expect(sanitizeAmountText("1'234'567,5", 'TJS')).toBe('1234567,5');
  });

  it('отказ (пустая строка), если число нельзя прочитать однозначно или без потери копеек', () => {
    expect(sanitizeAmountText('1.234', 'TJS')).toBe(''); // 1,234 с тремя знаками — копейки пропали бы
    expect(sanitizeAmountText('1,000', 'TJS')).toBe(''); // тысяча или единица? не гадаем
    expect(sanitizeAmountText('5,000', 'JPY')).toBe(''); // «5,000 ₩» — не 5
    expect(sanitizeAmountText('12,345', 'TJS')).toBe('');
    expect(sanitizeAmountText('12.505', 'TJS')).toBe('');
    expect(sanitizeAmountText('0.001', 'TJS')).toBe('');
    expect(sanitizeAmountText('12,5', 'JPY')).toBe(''); // у иены дробной части нет
    expect(sanitizeAmountText('1.250', 'JPY')).toBe('');
    expect(sanitizeAmountText('1e5', 'TJS')).toBe(''); // два числа
    expect(sanitizeAmountText('12 abc 34', 'TJS')).toBe('');
    expect(sanitizeAmountText('12\n34', 'TJS')).toBe('');
    expect(sanitizeAmountText('12.03.2026', 'TJS')).toBe(''); // дата
    expect(sanitizeAmountText('1,2,3', 'TJS')).toBe('');
    expect(sanitizeAmountText('1.234,56,7', 'TJS')).toBe('');
    expect(sanitizeAmountText('9'.repeat(40), 'JPY')).toBe(''); // не усекаем молча до 15 цифр
    expect(sanitizeAmountText('9'.repeat(14), 'TJS')).toBe('');
  });

  it('нули в хвосте дробной части не мешают, лишние ведущие нули убираются', () => {
    expect(sanitizeAmountText('12,5000', 'TJS')).toBe('12,50');
    expect(sanitizeAmountText('12.00', 'JPY')).toBe('12');
    expect(sanitizeAmountText('007', 'TJS')).toBe('7');
    expect(sanitizeAmountText('000', 'TJS')).toBe('0');
    expect(sanitizeAmountText('9'.repeat(15), 'JPY')).toBe('9'.repeat(15));
    expect(sanitizeAmountText('9'.repeat(13) + ',99', 'TJS')).toBe('9'.repeat(13) + ',99');
  });

  it('набор по шагам: висящий разделитель и пустое поле остаются, лишний разделитель в конце игнорируется', () => {
    expect(sanitizeAmountText('12.', 'TJS')).toBe('12,');
    expect(sanitizeAmountText(',5', 'TJS')).toBe('0,5');
    expect(sanitizeAmountText('.', 'TJS')).toBe('0,');
    expect(sanitizeAmountText(',', 'JPY')).toBe('');
    expect(sanitizeAmountText('', 'TJS')).toBe('');
    expect(sanitizeAmountText('abc', 'TJS')).toBe('');
    expect(sanitizeAmountText('1,5.', 'TJS')).toBe('1,5');
    expect(sanitizeAmountText('12.', 'JPY')).toBe('12,'); // дальше цифры не принимаются (см. «12,5» → отказ)
  });

  it('согласован с parseAmountToMinor: отказ строгого разбора — отказ, а принятая сумма — та же', () => {
    const sep = fc.constantFrom('.', ',', ' ', '');
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999 }), sep, fc.integer({ min: 0, max: 999 }), fc.constantFrom('TJS', 'JPY'), (a, s, b, cur) => {
        const raw = `${a}${s}${String(b).padStart(3, '0')}`;
        const strict = parseAmountToMinor(raw, cur);
        const got = draftToMinor(sanitizeAmountText(raw, cur), cur);
        if (strict === null) expect(got).toBeNull();
        else if (got !== null) expect(got).toBe(strict); // отказ при неоднозначности («5,000») разрешён
      }),
      { numRuns: 400 },
    );
  });
});

describe('clampToCurrency', () => {
  it('иена: дробная часть отбрасывается, а не склеивается', () => {
    expect(clampToCurrency('12,5', 'JPY')).toBe('12');
    expect(clampToCurrency('12,', 'JPY')).toBe('12');
    expect(clampToCurrency('0,5', 'JPY')).toBe('0');
  });
  it('сомони: лишние знаки обрезаются, допустимое остаётся', () => {
    expect(clampToCurrency('12,5', 'TJS')).toBe('12,5');
    expect(clampToCurrency('12,', 'TJS')).toBe('12,');
    expect(clampToCurrency('12', 'TJS')).toBe('12');
  });
  it('не помещается в предел новой валюты — очищает', () => {
    expect(clampToCurrency('1'.repeat(15), 'TJS')).toBe('');
    expect(clampToCurrency('1'.repeat(13), 'TJS')).toBe('1'.repeat(13));
  });
});

describe('draftToMinor / minorToDraft / formatDraft', () => {
  it('разбор идёт через parseAmountToMinor', () => {
    expect(draftToMinor('12,5', 'TJS')).toBe(1250);
    expect(draftToMinor('12,', 'TJS')).toBe(1200);
    expect(draftToMinor('0', 'TJS')).toBe(0);
    expect(draftToMinor('', 'TJS')).toBeNull();
    expect(draftToMinor('12', 'JPY')).toBe(12);
  });

  it('minorToDraft: 1250 → «12,5»; отрицательные и мусор → пусто', () => {
    expect(minorToDraft(1250, 'TJS')).toBe('12,5');
    expect(minorToDraft(100, 'TJS')).toBe('1');
    expect(minorToDraft(0, 'TJS')).toBe('0');
    expect(minorToDraft(-5, 'TJS')).toBe('');
    expect(minorToDraft(1.5, 'TJS')).toBe('');
    expect(minorToDraft(null, 'TJS')).toBe('');
    expect(minorToDraft(Number.MAX_SAFE_INTEGER, 'TJS')).toBe(''); // длиннее предела ввода
  });

  it('formatDraft группирует тысячи неразрывным пробелом и сохраняет хвостовую запятую', () => {
    const nb = '\u00A0';
    expect(formatDraft('1234567,5')).toBe(`1${nb}234${nb}567,5`);
    expect(formatDraft('12,')).toBe('12,');
    expect(formatDraft('999')).toBe('999');
    expect(formatDraft('')).toBe('');
  });
});

describe('свойства (fast-check)', () => {
  const currencyArb = fc.constantFrom('TJS', 'USD', 'JPY', 'KRW');
  const keysArb = fc.array(fc.constantFrom(...KEYS), { maxLength: 60 });

  it('любая последовательность нажатий даёт допустимый черновик, который всегда разбирается', () => {
    fc.assert(
      fc.property(currencyArb, keysArb, (currency, keys) => {
        let t = '';
        for (const k of keys) t = applyKey(t, k, currency);
        expect(t).toMatch(/^(\d+(,\d*)?)?$/);
        const [int = '', frac = ''] = t.split(',');
        expect(frac.length).toBeLessThanOrEqual(exponentOf(currency));
        expect(int.length + exponentOf(currency)).toBeLessThanOrEqual(15);
        if (t !== '') {
          const m = draftToMinor(t, currency);
          expect(m).not.toBeNull();
          expect(Number.isSafeInteger(m)).toBe(true);
        }
        if (/^0\d/.test(t)) throw new Error(`ведущий ноль: ${t}`);
      }),
      { numRuns: 300 },
    );
  });

  it('очистка черновика не меняет его (идемпотентность), а число → черновик → число сохраняется', () => {
    fc.assert(
      fc.property(currencyArb, keysArb, (currency, keys) => {
        let t = '';
        for (const k of keys) t = applyKey(t, k, currency);
        expect(sanitizeAmountText(t, currency)).toBe(t);
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(currencyArb, fc.integer({ min: 0, max: 999_999_999_999_999 }), (currency, minor) => {
        const d = minorToDraft(minor, currency);
        if (d === '') return; // длиннее предела ввода — не редактируется
        expect(draftToMinor(d, currency)).toBe(minor);
      }),
      { numRuns: 300 },
    );
  });
});
