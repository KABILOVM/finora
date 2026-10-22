import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetActiveTripCache, readActiveTrip, setActiveTrip } from './activeTrip';

beforeEach(() => {
  localStorage.clear();
  forgetActiveTripCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  forgetActiveTripCache();
});

describe('активная поездка (на этом устройстве)', () => {
  it('по умолчанию не начата; начатая помнится после перезагрузки и закрывается', () => {
    expect(readActiveTrip('u1')).toBeNull();
    setActiveTrip('u1', 'Самарканд');
    expect(readActiveTrip('u1')).toBe('Самарканд');
    forgetActiveTripCache(); // «перезагрузка»: читаем из localStorage
    expect(readActiveTrip('u1')).toBe('Самарканд');
    expect(localStorage.getItem('finora:active-trip:u1')).toBe('Самарканд');
    setActiveTrip('u1', null);
    expect(readActiveTrip('u1')).toBeNull();
    expect(localStorage.getItem('finora:active-trip:u1')).toBeNull();
  });

  it('у каждого человека своя поездка', () => {
    setActiveTrip('u1', 'Самарканд');
    expect(readActiveTrip('u2')).toBeNull();
  });

  it('негодная метка (в хранилище или при начале) — как «поездки нет»', () => {
    localStorage.setItem('finora:active-trip:u1', 'не метка!');
    expect(readActiveTrip('u1')).toBeNull();
    setActiveTrip('u1', 'а');
    expect(readActiveTrip('u1')).toBeNull();
    setActiveTrip('u1', 'я'.repeat(41));
    expect(readActiveTrip('u1')).toBeNull();
  });

  it('хранилище недоступно: поездка помнится до перезагрузки страницы', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readActiveTrip('u1')).toBeNull();
    setActiveTrip('u1', 'Баку');
    expect(readActiveTrip('u1')).toBe('Баку');
  });
});
