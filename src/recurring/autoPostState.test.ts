import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentFailures,
  onAutoPostRequest,
  publishFailures,
  requestAutoPostRun,
  resetAutoPostState,
  takeNewMissingRates,
} from './autoPostState';

afterEach(() => resetAutoPostState());

const f = (message: string, kind: 'error' | 'no-rate' = 'error') => ({ kind, message });

describe('publishFailures: пометки «не провелось само»', () => {
  it('свежие причины заменяют прежние у разобранных правил', () => {
    publishFailures('u1', new Map([['a', f('плохо')]]), new Set(['a', 'b']), new Set(['a', 'b']));
    expect(currentFailures('u1').get('a')).toEqual(f('плохо'));
    // правило починили — следующий проход его не называет, и пометка исчезает
    publishFailures('u1', new Map(), new Set(['a', 'b']), new Set(['a', 'b']));
    expect(currentFailures('u1').size).toBe(0);
  });

  it('при обрыве по лимиту пометки неразобранных правил остаются', () => {
    publishFailures('u1', new Map([['a', f('1')], ['b', f('2')]]), new Set(['a', 'b', 'c']), new Set(['a', 'b', 'c']));
    publishFailures('u1', new Map([['c', f('3')]]), new Set(['a', 'b', 'c']), new Set(['c']));
    expect([...currentFailures('u1').keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('правило, которое перестало участвовать (архив, «Проводить само» выключили), теряет пометку', () => {
    publishFailures('u1', new Map([['a', f('1')]]), new Set(['a']), new Set(['a']));
    publishFailures('u1', new Map(), new Set(['b']), new Set(['b']));
    expect(currentFailures('u1').size).toBe(0);
  });

  it('чужой пользователь пометок не видит; смена пользователя начинает с нуля', () => {
    publishFailures('u1', new Map([['a', f('1')]]), new Set(['a']), new Set(['a']));
    expect(currentFailures('u2').size).toBe(0);
    publishFailures('u2', new Map([['x', f('2')]]), new Set(['x']), new Set(['x']));
    expect(currentFailures('u1').size).toBe(0);
    expect([...currentFailures('u2').keys()]).toEqual(['x']);
  });
});

describe('takeNewMissingRates: сказать об одном и том же курсе один раз', () => {
  it('первый раз пара «новая», повторно — нет', () => {
    expect(takeNewMissingRates('u1', ['USD → TJS'])).toEqual(['USD → TJS']);
    expect(takeNewMissingRates('u1', ['USD → TJS'])).toEqual([]);
    expect(takeNewMissingRates('u1', ['USD → TJS', 'EUR → TJS'])).toEqual(['EUR → TJS']);
  });

  it('курс появился — о следующей беде скажем заново', () => {
    takeNewMissingRates('u1', ['USD → TJS']);
    expect(takeNewMissingRates('u1', [])).toEqual([]);
    expect(takeNewMissingRates('u1', ['USD → TJS'])).toEqual(['USD → TJS']);
  });

  it('у каждого пользователя своя память', () => {
    takeNewMissingRates('u1', ['USD → TJS']);
    expect(takeNewMissingRates('u2', ['USD → TJS'])).toEqual(['USD → TJS']);
  });
});

describe('requestAutoPostRun', () => {
  it('зовёт подписчиков; отписка работает', () => {
    const l = vi.fn();
    const off = onAutoPostRequest(l);
    requestAutoPostRun();
    expect(l).toHaveBeenCalledTimes(1);
    off();
    requestAutoPostRun();
    expect(l).toHaveBeenCalledTimes(1);
  });

  it('без подписчиков ничего не делает', () => {
    expect(() => requestAutoPostRun()).not.toThrow();
  });
});
