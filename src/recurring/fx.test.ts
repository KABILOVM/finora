import { describe, expect, it } from 'vitest';
import type { RateLookup } from '@/rates/types';
import { fxViewFor, needsFx, pairText, pickAutoRate, resolveFxInput } from './fx';

const lookup = (over: Partial<RateLookup> = {}): RateLookup => ({
  rate: 10.9,
  source: 'nbt',
  asOf: '2026-10-10',
  stale: false,
  manual: false,
  ...over,
});

describe('needsFx: зеркало правил репозитория операций', () => {
  const tjs = { currency: 'TJS' };
  const usd = { currency: 'USD' };
  it('расход и доход: курс нужен, только если кошелёк не в базовой валюте', () => {
    expect(needsFx({ kind: 'expense', amountMinor: 100, toAmountMinor: null }, tjs, null, 'TJS')).toBe(false);
    expect(needsFx({ kind: 'expense', amountMinor: 100, toAmountMinor: null }, usd, null, 'TJS')).toBe(true);
    expect(needsFx({ kind: 'income', amountMinor: 100, toAmountMinor: null }, usd, null, 'TJS')).toBe(true);
  });

  it('перевод: курс нужен только для комиссии в одной небазовой валюте', () => {
    // без комиссии
    expect(needsFx({ kind: 'transfer', amountMinor: 100, toAmountMinor: 100 }, usd, usd, 'TJS')).toBe(false);
    // с комиссией в небазовой валюте
    expect(needsFx({ kind: 'transfer', amountMinor: 100, toAmountMinor: 90 }, usd, usd, 'TJS')).toBe(true);
    // комиссия в базовой валюте — курс не нужен
    expect(needsFx({ kind: 'transfer', amountMinor: 100, toAmountMinor: 90 }, tjs, tjs, 'TJS')).toBe(false);
    // обмен между валютами — это не комиссия
    expect(needsFx({ kind: 'transfer', amountMinor: 1090, toAmountMinor: 100 }, tjs, usd, 'TJS')).toBe(false);
    expect(needsFx({ kind: 'transfer', amountMinor: 100, toAmountMinor: 1090 }, usd, tjs, 'TJS')).toBe(false);
  });

  it('нет кошелька или суммы зачисления — курс не нужен (ошибку скажет репозиторий)', () => {
    expect(needsFx({ kind: 'expense', amountMinor: 100, toAmountMinor: null }, undefined, null, 'TJS')).toBe(false);
    expect(needsFx({ kind: 'transfer', amountMinor: 100, toAmountMinor: null }, usd, usd, 'TJS')).toBe(false);
    expect(needsFx({ kind: 'transfer', amountMinor: 100, toAmountMinor: 90 }, usd, undefined, 'TJS')).toBe(false);
  });
});

describe('pickAutoRate: автоплатёж верит только свежему курсу и «Своему курсу»', () => {
  it('свежий автоматический курс — годится, источник известный', () => {
    expect(pickAutoRate(lookup())).toEqual({ ok: true, fx: { rate: 10.9, source: 'nbt' } });
    expect(pickAutoRate(lookup({ source: 'server' }))).toEqual({ ok: true, fx: { rate: 10.9, source: 'server' } });
  });

  it('неизвестный источник записывается как «cached» (репозиторий другие не принимает)', () => {
    expect(pickAutoRate(lookup({ source: 'странный' }))).toEqual({ ok: true, fx: { rate: 10.9, source: 'cached' } });
  });

  it('«Свой курс» годится всегда', () => {
    expect(pickAutoRate(lookup({ manual: true, source: 'manual' }))).toEqual({ ok: true, fx: { rate: 10.9, source: 'manual' } });
  });

  it('устаревший курс — не годится (stale)', () => {
    expect(pickAutoRate(lookup({ stale: true }))).toEqual({ ok: false, reason: 'stale' });
  });

  it('введённый в операции курс — не годится: ему нельзя верить без человека', () => {
    expect(pickAutoRate(lookup({ entered: true, source: 'manual' }))).toEqual({ ok: false, reason: 'missing' });
  });

  it('курса нет или он нечитаем — missing', () => {
    expect(pickAutoRate(null)).toEqual({ ok: false, reason: 'missing' });
    expect(pickAutoRate(lookup({ rate: 0 }))).toEqual({ ok: false, reason: 'missing' });
    expect(pickAutoRate(lookup({ rate: Number.NaN }))).toEqual({ ok: false, reason: 'missing' });
    expect(pickAutoRate(lookup({ rate: -1 }))).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('fxViewFor / resolveFxInput: курс в окнах «Провести» и «Пропустить»', () => {
  const usd = { currency: 'USD' };

  it('курс не нужен — ничего не показываем', () => {
    expect(fxViewFor(false, usd, 'TJS', () => lookup())).toEqual({ kind: 'none' });
    expect(fxViewFor(true, undefined, 'TJS', () => lookup())).toEqual({ kind: 'none' });
    expect(resolveFxInput({ kind: 'none' }, '')).toEqual({});
  });

  it('курс найден — берём его; устаревший тоже (с предупреждением на экране), решает человек', () => {
    const fresh = fxViewFor(true, usd, 'TJS', () => lookup());
    expect(fresh.kind).toBe('rate');
    expect(resolveFxInput(fresh, '')).toEqual({ fx: { rate: 10.9, source: 'nbt' } });
    const stale = fxViewFor(true, usd, 'TJS', () => lookup({ stale: true }));
    expect(resolveFxInput(stale, '')).toEqual({ fx: { rate: 10.9, source: 'nbt' } });
  });

  it('курса нет — без ввода нельзя (ошибка по-русски), с вводом — курс «вручную» и запомнить', () => {
    const missing = fxViewFor(true, usd, 'TJS', () => null);
    expect(missing).toEqual({ kind: 'missing', from: 'USD', to: 'TJS' });
    expect(resolveFxInput(missing, '').error).toMatch(/Курса пока нет/);
    expect(resolveFxInput(missing, 'abc').error).toMatch(/число больше нуля/);
    expect(resolveFxInput(missing, '0').error).toMatch(/число больше нуля/);
    expect(resolveFxInput(missing, '-5').error).toMatch(/число больше нуля/);
    expect(resolveFxInput(missing, '10,9')).toEqual({
      fx: { rate: 10.9, source: 'manual' },
      typed: { from: 'USD', to: 'TJS', rate: 10.9 },
    });
  });

  it('введённый ранее курс: пустое поле — как есть; поправили — «вручную»; опечатка — ошибка', () => {
    const entered = fxViewFor(true, usd, 'TJS', () => lookup({ entered: true, source: 'manual', rate: 11 }));
    expect(resolveFxInput(entered, '')).toEqual({ fx: { rate: 11, source: 'manual' } });
    expect(resolveFxInput(entered, '11')).toEqual({ fx: { rate: 11, source: 'manual' } });
    expect(resolveFxInput(entered, '12').fx).toEqual({ rate: 12, source: 'manual' });
    expect(resolveFxInput(entered, '12').typed).toEqual({ from: 'USD', to: 'TJS', rate: 12 });
    expect(resolveFxInput(entered, 'x').error).toMatch(/число больше нуля/);
  });
});

describe('pairText', () => {
  it('«USD → TJS»', () => {
    expect(pairText('USD', 'TJS')).toBe('USD → TJS');
  });
});
