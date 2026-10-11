import { describe, expect, it } from 'vitest';
import { wasSkipped } from './useSkipped';

const T = '2026-10-10T16:40:00.123Z';
const row = (over: Partial<Parameters<typeof wasSkipped>[0]>) => ({ createdAt: T, clientUpdatedAt: T, deletedAt: T, ...over });

describe('wasSkipped: «Пропустить» отличается от «провели и удалили»', () => {
  it('создана сразу удалённой и после этого не правилась — пропуск', () => {
    expect(wasSkipped(row({}))).toBe(true);
  });

  it('запись пришла с сервера в другом написании времени — всё равно пропуск', () => {
    expect(wasSkipped(row({ clientUpdatedAt: '2026-10-10T16:40:00.123+00:00', deletedAt: '2026-10-10T16:40:00.123+00:00' }))).toBe(true);
  });

  it('провели и потом удалили: правка позже создания — это удалённая операция', () => {
    const later = '2026-10-10T16:40:00.124Z';
    expect(wasSkipped(row({ clientUpdatedAt: later, deletedAt: later }))).toBe(false);
  });

  it('сервер зажал метки создания и правки (часы телефона убежали вперёд), а метку удаления нет — всё равно пропуск', () => {
    const clamped = '2026-10-10T16:45:00.000Z';
    const phoneClock = '2026-10-10T17:40:00.123Z';
    expect(wasSkipped({ createdAt: clamped, clientUpdatedAt: clamped, deletedAt: phoneClock })).toBe(true);
  });

  it('не удалена — не пропуск', () => {
    expect(wasSkipped(row({ deletedAt: null }))).toBe(false);
  });

  it('метки нечитаемы — не пропуск (лучше «Удалён из операций», чем выдумать пропуск)', () => {
    expect(wasSkipped(row({ createdAt: 'мусор', clientUpdatedAt: 'мусор' }))).toBe(false);
  });
});
