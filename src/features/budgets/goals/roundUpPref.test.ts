import { afterEach, describe, expect, it } from 'vitest';
import { roundUpStep, setRoundUpStep } from './roundUpPref';

afterEach(() => {
  window.localStorage.clear();
  setRoundUpStep(5); // сбросить и значение в памяти
  window.localStorage.clear();
});

describe('roundUpPref: шаг копилки на устройстве', () => {
  it('по умолчанию 5', () => {
    expect(roundUpStep()).toBe(5);
  });

  it('запоминает шаг и отдаёт его обратно', () => {
    setRoundUpStep(10);
    expect(roundUpStep()).toBe(10);
    expect(window.localStorage.getItem('finora:round-up-step')).toBe('10');
    setRoundUpStep(1);
    expect(roundUpStep()).toBe(1);
  });

  it('значение по умолчанию не занимает хранилище', () => {
    setRoundUpStep(10);
    setRoundUpStep(5);
    expect(window.localStorage.getItem('finora:round-up-step')).toBeNull();
    expect(roundUpStep()).toBe(5);
  });

  it('мусор в хранилище читается как шаг по умолчанию', () => {
    window.localStorage.setItem('finora:round-up-step', '7');
    expect(roundUpStep()).toBe(5);
    window.localStorage.setItem('finora:round-up-step', 'абв');
    expect(roundUpStep()).toBe(5);
  });
});
