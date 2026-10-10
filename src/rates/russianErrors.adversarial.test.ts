import { describe, expect, it } from 'vitest';
import { describeRateError } from './http';

/**
 * Заявлено: «английские системные сообщения наружу не выходят». Но любое сообщение, где есть ХОТЬ ОДНА русская буква
 * и нет узкого списка «шума» (failed to fetch, load failed, HTTP 503 ...), возвращается как есть — вместе с английским хвостом.
 */
const SYSTEM_ENGLISH = [
  ['Ошибка сети: ECONNREFUSED 127.0.0.1:443', /ECONNREFUSED/],
  ['Сервер вернул: Internal Server Error', /Internal Server Error/],
  ['Недопустимый ответ: Unexpected token < in JSON at position 0', /Unexpected token/],
  ['Ответ: 503 Service Unavailable', /Service Unavailable/],
] as const;

describe('describeRateError: русская приставка не оправдывает английский хвост', () => {
  it.each(SYSTEM_ENGLISH)('%s', (message, leak) => {
    expect(describeRateError(new Error(message))).not.toMatch(leak);
  });

  it('программная ошибка не выдаётся за «нужен вход»: слово permission внутри текста TypeError', () => {
    const e = new TypeError('Cannot read properties of undefined (reading "permission")');
    expect(describeRateError(e)).not.toMatch(/нужен вход/);
  });
});
