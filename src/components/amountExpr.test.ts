import { describe, expect, it } from 'vitest';
import { acceptExpr, applyExprKey, evalExpr, formatExpr, hasWords } from './amountExpr';

const ok = (minor: number) => ({ kind: 'ok', minor });

describe('evalExpr', () => {
  it('сложение и вычитание без float-ошибок', () => {
    expect(evalExpr('0,1+0,2', 'TJS')).toEqual(ok(30));
    expect(evalExpr('100−25,5', 'TJS')).toEqual(ok(7450));
  });

  it('умножение и деление раньше сложения', () => {
    expect(evalExpr('2+3×4', 'TJS')).toEqual(ok(1400));
    expect(evalExpr('20−10÷2', 'TJS')).toEqual(ok(1500));
  });

  it('деление округляется до копейки, .5 — вверх', () => {
    expect(evalExpr('10÷3', 'TJS')).toEqual(ok(333));
    expect(evalExpr('1÷8', 'TJS')).toEqual(ok(13)); // 0,125 → 0,13
    expect(evalExpr('10÷3', 'JPY')).toEqual(ok(3));
  });

  it('курс с несколькими знаками: 150×10,8525', () => {
    expect(evalExpr('150×10,8525', 'TJS')).toEqual(ok(162788)); // 1627,875 → 1627,88
  });

  it('не дописано — incomplete', () => {
    for (const e of ['12+', '12×', '12+,', '12+3−']) expect(evalExpr(e, 'TJS')).toEqual({ kind: 'incomplete' });
  });

  it('ошибки: ноль в делителе, ниже нуля, слишком много', () => {
    expect(evalExpr('5÷0', 'TJS')).toMatchObject({ kind: 'error' });
    expect(evalExpr('5÷0,0', 'TJS')).toMatchObject({ kind: 'error' });
    expect(evalExpr('5−6', 'TJS')).toMatchObject({ kind: 'error', message: 'Результат меньше нуля' });
    expect(evalExpr('9999999999999×9999999999999', 'TJS')).toMatchObject({ kind: 'error' });
  });

  it('ровный ноль допустим', () => {
    expect(evalExpr('5−5', 'TJS')).toEqual(ok(0));
  });
});

describe('acceptExpr (набор с клавиатуры ПК)', () => {
  it('приводит знаки: * x / - . → × × ÷ − ,', () => {
    expect(acceptExpr('12.5*3')).toBe('12,5×3');
    expect(acceptExpr('9x2/3-1')).toBe('9×2÷3−1');
  });
  it('пробелы и «=» убираются', () => {
    expect(acceptExpr('1 234 + 5 =')).toBe('1234+5');
  });
  it('знак в начале, два знака подряд, лишний разделитель, слишком длинное — отказ', () => {
    expect(acceptExpr('+5')).toBeNull();
    expect(acceptExpr('5++3')).toBeNull();
    expect(acceptExpr('1,2,3+1')).toBeNull();
    expect(acceptExpr('1,23456+1')).toBeNull();
    expect(acceptExpr('1111111111+2222222222+33333')).toBeNull();
  });
  it('ведущие нули убираются, «,5» → «0,5»', () => {
    expect(acceptExpr('007+,5')).toBe('7+0,5');
  });
});

describe('hasWords (вставка текста, а не выражения)', () => {
  it('одиночная «x» или «х» между числами — знак умножения, не слово', () => {
    for (const s of ['12x3', '12 X 3', '12х3', '5 Х 2', '1 250 + 340', '-150,00', '']) expect(hasWords(s), s).toBe(false);
  });
  it('слова из СМС банка — текст: буква «х» в «Расход» не умножение', () => {
    for (const s of ['Расход 150 TJS', '-150,00 TJS', '150 с.', 'Taxi 150', '150 TJS Taxi 2', 'abc12.5q']) expect(hasWords(s), s).toBe(true);
  });
});

describe('applyExprKey (экранная клавиатура)', () => {
  it('знак заменяется знаком; в начале и после пустого — ничего', () => {
    expect(applyExprKey('12+', '×')).toBe('12×');
    expect(applyExprKey('', '+')).toBe('');
  });
  it('висящая запятая перед знаком отбрасывается', () => {
    expect(applyExprKey('12,', '+')).toBe('12+');
  });
  it('запятая: одна на число; после знака — «0,»', () => {
    expect(applyExprKey('12+', ',')).toBe('12+0,');
    expect(applyExprKey('12+0,5', ',')).toBe('12+0,5');
  });
  it('цифры: без ведущих нулей, не больше 4 знаков после запятой', () => {
    expect(applyExprKey('5+0', '7')).toBe('5+7');
    expect(applyExprKey('5+0', '0')).toBe('5+0');
    expect(applyExprKey('5+0,1234', '9')).toBe('5+0,1234');
  });
  it('стереть', () => {
    expect(applyExprKey('5+3', 'backspace')).toBe('5+');
  });
});

describe('formatExpr', () => {
  it('тысячи в числах, знаки с пробелами', () => {
    expect(formatExpr('1234,5+3')).toBe('1 234,5 + 3');
  });
});
