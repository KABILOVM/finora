import { describe, expect, it, vi } from 'vitest';
import { NOW, makeTable, ok, stubProvider } from './__fixtures__/testkit';
import { createRateService } from './service';
import { createMemoryRateStorage } from './storage';
import { MAX_ENTERED_PER_OWNER, normalizeStored } from './state';
import type { RateService, RateStorage } from './types';
import type { RateTable } from '@/domain/types';

/**
 * Курс, введённый в форме операции: отдельный запасной слой по пользователю.
 * Порядок getRate: «Свой курс» → свежий автоматический → ВВЕДЁННЫЙ → устаревший автоматический.
 */

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

/** Документ хранилища с таблицами (и, при желании, с готовыми введёнными курсами). */
const doc = (tables: RateTable[] = [], extra: Record<string, unknown> = {}) => ({
  v: 1,
  tables,
  manual: {},
  lastRefreshAt: null,
  lastAttemptAt: null,
  lastError: null,
  ...extra,
});

/** Сервис на общем хранилище; userId — как после входа этого человека. */
function session(storage: RateStorage, userId?: string, now: Date = NOW): RateService {
  const service = createRateService({ providers: [], storage, now: () => now });
  if (userId !== undefined) service.bindUser?.(userId);
  return service;
}

const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);

/** Таблица nbt за `daysAgo` суток до «сейчас» (дата курса). */
const tableAgo = (daysAgo: number, usd = 10.95): RateTable =>
  makeTable({ asOf: at(daysAgo).toISOString().slice(0, 10), perUnit: { TJS: 1, USD: usd } });

describe('введённый курс: порядок приоритетов getRate', () => {
  it('курсов нет совсем → введённый курс становится единственным и помечен entered', () => {
    const service = session(createMemoryRateStorage());
    expect(service.getRate('USD', 'TJS')).toBeNull();
    service.rememberEnteredRate('USD', 'TJS', 11);
    expect(service.getRate('USD', 'TJS')).toEqual({
      rate: 11,
      source: 'manual', // в операцию попадёт как «вручную» (допустимое значение fxSource)
      asOf: '2026-10-10',
      stale: false, // у него своя подпись с датой, «устарел» не пишем
      manual: false, // это НЕ «Свой курс» из Настроек
      entered: true,
    });
  });

  it('(2) свежий автоматический курс сильнее введённого — даже если введённый новее', () => {
    const service = session(createMemoryRateStorage(doc([tableAgo(0, 10.95)])));
    service.rememberEnteredRate('USD', 'TJS', 99);
    const hit = service.getRate('USD', 'TJS');
    expect(hit?.rate).toBeCloseTo(10.95, 10);
    expect(hit?.entered).toBeUndefined();
    expect(hit?.source).toBe('nbt');
  });

  it('граница свежести: курс трёхсуточной давности ещё свежий (введённый его не перекрывает), четырёхсуточный уже нет', () => {
    const fresh = session(createMemoryRateStorage(doc([tableAgo(3)])));
    fresh.rememberEnteredRate('USD', 'TJS', 99);
    expect(fresh.getRate('USD', 'TJS')).toMatchObject({ rate: 10.95, stale: false });

    const stale = session(createMemoryRateStorage(doc([tableAgo(4)])));
    stale.rememberEnteredRate('USD', 'TJS', 99);
    expect(stale.getRate('USD', 'TJS')).toMatchObject({ rate: 99, entered: true });
  });

  it('(3) введённый курс сильнее УСТАРЕВШЕГО автоматического', () => {
    const service = session(createMemoryRateStorage(doc([tableAgo(10)])));
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 10.95, stale: true }); // пока введённого нет
    service.rememberEnteredRate('USD', 'TJS', 11);
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 11, entered: true, stale: false });
  });

  it('(4) если введённого нет, устаревший автоматический остаётся как был', () => {
    const service = session(createMemoryRateStorage(doc([tableAgo(30)])));
    service.rememberEnteredRate('EUR', 'TJS', 12); // другая пара — USD не затрагивает
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 10.95, stale: true, source: 'nbt' });
  });

  it('(1) «Свой курс» сильнее введённого; убрали «Свой курс» — введённый снова виден', () => {
    const service = session(createMemoryRateStorage());
    service.rememberEnteredRate('USD', 'TJS', 11);
    service.setManualRate('USD', 'TJS', 12);
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 12, manual: true });
    expect(service.getRate('USD', 'TJS')?.entered).toBeUndefined();
    service.clearManualRate('USD', 'TJS');
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 11, entered: true });
  });

  it('«Свой курс» не стирает введённый, а введённый не превращается в «Свой курс»', () => {
    const service = session(createMemoryRateStorage());
    service.rememberEnteredRate('USD', 'TJS', 11);
    service.setManualRate('USD', 'TJS', 12);
    expect(service.listEnteredRates().map((e) => e.rate)).toEqual([11]);
    expect(service.getRate('EUR', 'TJS')).toBeNull();
  });

  it('свежий курс из сети приходит позже: он тут же перекрывает введённый, а сам введённый остаётся про запас', async () => {
    const storage = createMemoryRateStorage(doc([tableAgo(20)]));
    const provider = stubProvider('nbt', ok({ perUnit: { TJS: 1, USD: 10.95 } }));
    const service = createRateService({ providers: [provider], storage, now: () => NOW });
    service.rememberEnteredRate('USD', 'TJS', 11);
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 11, entered: true });
    expect((await service.refresh()).ok).toBe(true);
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 10.95, source: 'nbt' });
    expect(service.listEnteredRates()).toHaveLength(1);
  });

  it('введённый курс направленный: USD→TJS не даёт TJS→USD', () => {
    const service = session(createMemoryRateStorage());
    service.rememberEnteredRate('USD', 'TJS', 11);
    expect(service.getRate('TJS', 'USD')).toBeNull();
  });

  it('одна и та же валюта — всегда 1, введённый слой не нужен', () => {
    const service = session(createMemoryRateStorage());
    expect(service.getRate('TJS', 'TJS')).toMatchObject({ rate: 1, source: 'same' });
  });

  it('день ввода — по часам устройства, а не UTC', () => {
    const service = session(createMemoryRateStorage(), undefined, new Date(2026, 9, 11, 1, 30)); // 11 октября, 01:30 местного
    service.rememberEnteredRate('USD', 'TJS', 11);
    expect(service.getRate('USD', 'TJS')?.asOf).toBe('2026-10-11');
    expect(service.listEnteredRates()[0]?.enteredOn).toBe('2026-10-11');
  });
});

describe('введённый курс: у каждого пользователя свой', () => {
  it('курс Алисы Бобу не виден, и наоборот', () => {
    const storage = createMemoryRateStorage();
    session(storage, ALICE).rememberEnteredRate('USD', 'TJS', 11);

    const bob = session(storage, BOB);
    expect(bob.getRate('USD', 'TJS')).toBeNull();
    expect(bob.listEnteredRates()).toEqual([]);
    bob.rememberEnteredRate('USD', 'TJS', 12);

    expect(session(storage, ALICE).getRate('USD', 'TJS')).toMatchObject({ rate: 11, entered: true });
    expect(session(storage, BOB).getRate('USD', 'TJS')).toMatchObject({ rate: 12, entered: true });
    const saved = storage.get() as { enteredByUser: Record<string, Record<string, { rate: number }>> };
    expect(saved.enteredByUser[ALICE]?.['USD>TJS']?.rate).toBe(11);
    expect(saved.enteredByUser[BOB]?.['USD>TJS']?.rate).toBe(12);
  });

  it('сброс у Боба не трогает Алису', () => {
    const storage = createMemoryRateStorage();
    session(storage, ALICE).rememberEnteredRate('USD', 'TJS', 11);
    const bob = session(storage, BOB);
    bob.rememberEnteredRate('USD', 'TJS', 12);
    bob.forgetEnteredRate('USD', 'TJS');
    expect(bob.getRate('USD', 'TJS')).toBeNull();
    expect(session(storage, ALICE).getRate('USD', 'TJS')).toMatchObject({ rate: 11 });
    const saved = storage.get() as { enteredByUser: Record<string, unknown> };
    expect(Object.keys(saved.enteredByUser)).toEqual([ALICE]); // пустая корзина Боба не хранится
  });

  it('автоматические курсы общие, введённые — личные', () => {
    const storage = createMemoryRateStorage(doc([tableAgo(0)]));
    expect(session(storage, ALICE).getRate('USD', 'TJS')?.rate).toBeCloseTo(10.95, 10);
    expect(session(storage, BOB).getRate('USD', 'TJS')?.rate).toBeCloseTo(10.95, 10);
  });

  it('сервису без пользователя достаётся «ничья» корзина; назвали пользователя — она переезжает к нему', () => {
    const storage = createMemoryRateStorage();
    session(storage).rememberEnteredRate('USD', 'TJS', 11);
    expect((storage.get() as { entered: Record<string, unknown> }).entered['USD>TJS']).toMatchObject({ rate: 11 });

    const alice = session(storage, ALICE);
    expect(alice.getRate('USD', 'TJS')).toMatchObject({ rate: 11, entered: true });
    expect((storage.get() as { entered: Record<string, unknown> }).entered).toEqual({});
    expect(session(storage, BOB).getRate('USD', 'TJS')).toBeNull(); // второму пользователю не достаётся
  });

  it('при переезде свой курс пользователя побеждает «ничей»', () => {
    const storage = createMemoryRateStorage();
    session(storage, ALICE).rememberEnteredRate('USD', 'TJS', 11);
    session(storage).rememberEnteredRate('USD', 'TJS', 99);
    expect(session(storage, ALICE).getRate('USD', 'TJS')?.rate).toBe(11);
  });
});

describe('введённый курс: запоминание, сброс, список', () => {
  it('переживает перезапуск (новый сервис на том же хранилище)', () => {
    const storage = createMemoryRateStorage();
    session(storage, ALICE).rememberEnteredRate('USD', 'TJS', 10.9);
    expect(session(storage, ALICE).getRate('USD', 'TJS')).toMatchObject({ rate: 10.9, entered: true });
  });

  it('повторный ввод той же пары заменяет прежний и обновляет день', () => {
    const storage = createMemoryRateStorage();
    session(storage, ALICE, at(2)).rememberEnteredRate('USD', 'TJS', 11);
    const later = session(storage, ALICE, NOW);
    later.rememberEnteredRate('USD', 'TJS', 12);
    expect(later.listEnteredRates()).toEqual([
      { from: 'USD', to: 'TJS', rate: 12, enteredAt: NOW.toISOString(), enteredOn: '2026-10-10' },
    ]);
  });

  it('«Сбросить» убирает только эту пару; сброс несуществующего ничего не делает', () => {
    const service = session(createMemoryRateStorage(), ALICE);
    service.rememberEnteredRate('USD', 'TJS', 11);
    service.rememberEnteredRate('EUR', 'TJS', 12);
    service.forgetEnteredRate('USD', 'TJS');
    expect(service.getRate('USD', 'TJS')).toBeNull();
    expect(service.getRate('EUR', 'TJS')).toMatchObject({ rate: 12 });
    expect(() => service.forgetEnteredRate('RUB', 'TJS')).not.toThrow();
    expect(service.listEnteredRates().map((e) => e.from)).toEqual(['EUR']);
  });

  it('список: сначала самые новые; коды валют нормализуются', () => {
    const storage = createMemoryRateStorage();
    session(storage, ALICE, at(3)).rememberEnteredRate('eur', 'tjs', 12);
    session(storage, ALICE, at(1)).rememberEnteredRate('USD', 'TJS', 11);
    expect(session(storage, ALICE).listEnteredRates().map((e) => `${e.from}>${e.to}`)).toEqual(['USD>TJS', 'EUR>TJS']);
  });

  it('некорректные курс и пара — RangeError, ничего не записано', () => {
    const storage = createMemoryRateStorage();
    const service = session(storage, ALICE);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e12, 1e-12]) {
      expect(() => service.rememberEnteredRate('USD', 'TJS', bad), String(bad)).toThrow(RangeError);
    }
    expect(() => service.rememberEnteredRate('USD', 'USD', 1)).toThrow(RangeError);
    expect(() => service.rememberEnteredRate('US', 'TJS', 1)).toThrow(RangeError);
    expect(() => service.rememberEnteredRate('USD', 'TJS', '11' as unknown as number)).toThrow(RangeError);
    expect(service.listEnteredRates()).toEqual([]);
    expect(storage.get()).toBeNull();
  });

  it('у одного пользователя не больше MAX_ENTERED_PER_OWNER курсов: старейшие вытесняются', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const codes = Array.from({ length: MAX_ENTERED_PER_OWNER + 5 }, (_, i) => `A${letters[Math.floor(i / 26)]}${letters[i % 26]}`);
    const storage = createMemoryRateStorage();
    codes.forEach((code, i) => {
      // каждый курс введён на секунду позже предыдущего
      const s = createRateService({ providers: [], storage, now: () => new Date(NOW.getTime() + i * 1000) });
      s.bindUser?.(ALICE);
      s.rememberEnteredRate(code, 'TJS', 2);
    });
    const reader = createRateService({ providers: [], storage, now: () => NOW });
    reader.bindUser?.(ALICE);
    const kept = reader.listEnteredRates();
    expect(kept).toHaveLength(MAX_ENTERED_PER_OWNER);
    expect(kept[0]?.from).toBe(codes[codes.length - 1]); // самый новый остался
    expect(kept.some((e) => e.from === codes[0])).toBe(false); // самый старый вытеснен
  });

  it('подписчики узнают и о запоминании, и о сбросе', () => {
    const service = session(createMemoryRateStorage(), ALICE);
    const listener = vi.fn();
    service.subscribe(listener);
    service.rememberEnteredRate('USD', 'TJS', 11);
    expect(listener).toHaveBeenCalledTimes(1);
    service.forgetEnteredRate('USD', 'TJS');
    expect(listener).toHaveBeenCalledTimes(2);
    service.forgetEnteredRate('USD', 'TJS'); // уже нет — молча
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('введённый курс: хранилище', () => {
  it('две вкладки на одном хранилище не затирают друг друга', () => {
    const storage = createMemoryRateStorage();
    const a = session(storage, ALICE);
    const b = session(storage, ALICE);
    a.rememberEnteredRate('USD', 'TJS', 11);
    b.rememberEnteredRate('EUR', 'TJS', 12); // b про USD не знал
    expect(session(storage, ALICE).listEnteredRates().map((e) => e.from).sort()).toEqual(['EUR', 'USD']);
    // и сброс в одной вкладке виден в другой
    a.forgetEnteredRate('EUR', 'TJS');
    expect(session(storage, ALICE).listEnteredRates().map((e) => e.from)).toEqual(['USD']);
  });

  it('обновление курсов из сети не стирает введённые', async () => {
    const storage = createMemoryRateStorage();
    const service = createRateService({ providers: [stubProvider('nbt', ok())], storage, now: () => NOW });
    service.bindUser?.(ALICE);
    service.rememberEnteredRate('GBP', 'TJS', 14);
    await service.refresh();
    expect(service.getRate('GBP', 'TJS')).toMatchObject({ rate: 14, entered: true });
  });

  it('старый документ без введённых курсов читается как пустой слой', () => {
    const state = normalizeStored(doc());
    expect(state.entered).toEqual({});
    expect(Object.keys(state.enteredByUser)).toEqual([]);
    expect(session(createMemoryRateStorage(doc()), ALICE).listEnteredRates()).toEqual([]);
  });

  it('мусор в документе отбрасывается, годное остаётся', () => {
    const good = { rate: 11, enteredAt: NOW.toISOString() };
    const state = normalizeStored(
      doc([], {
        entered: {
          'USD>TJS': good,
          'USD>USD': good, // сама в себя
          'usd>tjs': good, // не заглавными
          '__proto__>TJS': good,
          'EUR>TJS': { rate: -1, enteredAt: NOW.toISOString() },
          'RUB>TJS': { rate: 0.1, enteredAt: 'не дата' },
          'GBP>TJS': { rate: '14', enteredAt: NOW.toISOString() },
          'CNY>TJS': 5,
        },
        enteredByUser: { '': { 'USD>TJS': good }, [ALICE]: { 'USD>TJS': good, 'XXX>YYY': { rate: 1e12, enteredAt: NOW.toISOString() } }, [BOB]: 'мусор' },
      }),
    );
    expect(Object.keys(state.entered)).toEqual(['USD>TJS']);
    expect(Object.keys(state.enteredByUser)).toEqual([ALICE]);
    expect(Object.keys(state.enteredByUser[ALICE] ?? {})).toEqual(['USD>TJS']);
  });

  it('хранилище целиком сломано: сервис работает, введённый курс держится в памяти', () => {
    const broken: RateStorage = {
      get: () => {
        throw new Error('нет доступа');
      },
      set: () => {
        throw new Error('нет места');
      },
    };
    const service = createRateService({ providers: [], storage: broken, now: () => NOW });
    service.bindUser?.(ALICE);
    expect(() => service.rememberEnteredRate('USD', 'TJS', 11)).not.toThrow();
    expect(service.getRate('USD', 'TJS')).toMatchObject({ rate: 11, entered: true });
  });
});
