import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAmountToMinor } from '@/domain/money';
import { applyKey, clampToCurrency, draftToMinor, minorToDraft, sanitizeAmountText, type AmountKey } from './amountText';

const KEYS: AmountKey[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ',', 'backspace'];

describe('ATTACK: вставка суммы в чужом формате (sanitizeAmountText)', () => {
  it('«1.234,56» (точка — тысячи, запятая — копейки) не превращается молча в 1,23', () => {
    const out = sanitizeAmountText('1.234,56', 'TJS');
    // Правильные исходы: 1 234,56 либо отказ (пустая строка). Тихая потеря на три порядка — недопустима.
    expect(['1234,56', '']).toContain(out);
  });

  it('«1,234.56» (американский формат) не превращается молча в 1,23', () => {
    const out = sanitizeAmountText('1,234.56', 'TJS');
    expect(['1234,56', '']).toContain(out);
  });

  it('«12.505» — парсер контракта отвергает (null), а вставка молча усекает до 12,50', () => {
    expect(parseAmountToMinor('12.505', 'TJS')).toBeNull();
    const out = sanitizeAmountText('12.505', 'TJS');
    expect(draftToMinor(out, 'TJS')).toBeNull();
  });

  it('иена: «12.5» не превращается в 125 (в 10 раз больше)', () => {
    const out = sanitizeAmountText('12.5', 'JPY');
    expect(out).not.toBe('125');
  });

  it('согласованность: если parseAmountToMinor отвергает строку, очищенная строка не должна давать другое число', () => {
    const grouped = fc
      .tuple(fc.integer({ min: 0, max: 999999 }), fc.constantFrom('.', ',', ' '), fc.integer({ min: 0, max: 999 }))
      .map(([a, sep, b]) => `${a}${sep}${String(b).padStart(3, '0')}`);
    fc.assert(
      fc.property(grouped, (raw) => {
        const strict = parseAmountToMinor(raw, 'TJS');
        const lenient = draftToMinor(sanitizeAmountText(raw, 'TJS'), 'TJS');
        // Если строгий разбор сказал «нет», лениво получить из неё какое-то число нельзя.
        if (strict === null) expect(lenient).toBeNull();
      }),
      { numRuns: 300 },
    );
  });
});

describe('ПРОВЕРКА инвариантов клавиатуры (ожидаются зелёными)', () => {
  it('любая последовательность нажатий даёт либо пусто, либо число, которое разбирается в безопасный Minor', () => {
    for (const cur of ['TJS', 'JPY', 'USD', 'KRW']) {
      fc.assert(
        fc.property(fc.array(fc.constantFrom(...KEYS), { maxLength: 60 }), (seq) => {
          let t = '';
          for (const k of seq) t = applyKey(t, k, cur);
          if (t === '') return;
          const m = draftToMinor(t, cur);
          expect(m).not.toBeNull();
          expect(Number.isSafeInteger(m)).toBe(true);
          expect(t).toMatch(/^(0|[1-9]\d*)(,\d*)?$/);
        }),
        { numRuns: 400 },
      );
    }
  });

  it('minorToDraft ↔ draftToMinor: круг без потерь для сумм в пределах лимита', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999_999_999_999_999 }), fc.constantFrom('TJS', 'JPY'), (v, cur) => {
        const d = minorToDraft(v, cur);
        if (d !== '') expect(draftToMinor(d, cur)).toBe(v);
      }),
      { numRuns: 500 },
    );
  });

  it('смена валюты не увеличивает сумму в 10 раз («12,5» → иена)', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...KEYS), { maxLength: 30 }), (seq) => {
        let t = '';
        for (const k of seq) t = applyKey(t, k, 'TJS');
        const c = clampToCurrency(t, 'JPY');
        const whole = t.split(',')[0] ?? '';
        if (c !== '') expect(c).toBe(whole);
      }),
      { numRuns: 300 },
    );
  });
});
