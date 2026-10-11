import { describe, expect, it } from 'vitest';
import { wasSkipped } from './useSkipped';

describe('wasSkipped: «Пропустить» отличается от «провели и удалили»', () => {
  it('удалена в тот же миг, когда создана — пропуск', () => {
    expect(wasSkipped({ createdAt: '2026-10-10T16:40:00.123Z', deletedAt: '2026-10-10T16:40:00.123Z' })).toBe(true);
  });

  it('запись пришла с сервера в другом написании времени — всё равно пропуск', () => {
    expect(wasSkipped({ createdAt: '2026-10-10T16:40:00.123Z', deletedAt: '2026-10-10T16:40:00.123+00:00' })).toBe(true);
  });

  it('удалена позже — это удалённая операция', () => {
    expect(wasSkipped({ createdAt: '2026-10-10T16:40:00.123Z', deletedAt: '2026-10-10T16:40:00.124Z' })).toBe(false);
  });

  it('не удалена — не пропуск', () => {
    expect(wasSkipped({ createdAt: '2026-10-10T16:40:00.123Z', deletedAt: null })).toBe(false);
  });
});
