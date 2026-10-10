import { describe, expect, it, vi } from 'vitest';
import { createClock } from '@/db';
import { basics, makeStore, stamp, USER_A } from './helpers';
import { IDBFactory } from 'fake-indexeddb';

const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);

function memoryClock(now: () => number, initial: string | null = null) {
  let saved: string | null = initial;
  const clock = createClock({ deviceId: 'device-clock-1', now, load: () => saved, save: (s) => void (saved = s) });
  return { clock, saved: () => saved };
}

describe('createClock', () => {
  it('метки идут в ISO UTC с миллисекундами', () => {
    const { clock } = memoryClock(() => T0);
    expect(clock.tick()).toBe('2026-10-10T12:00:00.000Z');
  });

  it('несколько правок в одну миллисекунду — всё равно строго возрастают', () => {
    const { clock } = memoryClock(() => T0);
    const ticks = Array.from({ length: 50 }, () => clock.tick());
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]! > ticks[i - 1]!).toBe(true);
    expect(new Set(ticks).size).toBe(50);
  });

  it('часы устройства откатились назад — метки не уменьшаются', () => {
    let now = T0;
    const { clock } = memoryClock(() => now);
    const a = clock.tick();
    now = T0 - 3_600_000; // час назад
    const b = clock.tick();
    const c = clock.tick();
    expect(b > a).toBe(true);
    expect(c > b).toBe(true);
    now = T0 + 10_000_000; // часы пошли дальше — догоняют нормально
    expect(clock.tick()).toBe(stamp(T0 + 10_000_000));
  });

  it('переживает перезапуск: новый экземпляр с откатившимися часами продолжает после сохранённой метки', () => {
    const first = memoryClock(() => T0);
    const last = [first.clock.tick(), first.clock.tick(), first.clock.tick()].at(-1)!;
    expect(first.saved()).toBe(last);
    const second = memoryClock(() => T0 - 86_400_000, first.saved());
    expect(second.clock.tick() > last).toBe(true);
  });

  it('мусор в сохранённой метке игнорируется', () => {
    for (const junk of ['abc', '2026-10-10', '', '2026-13-45T00:00:00.000Z']) {
      const { clock } = memoryClock(() => T0, junk);
      expect(clock.tick()).toBe(stamp(T0));
    }
  });

  it('сбой сохранения (исключение или отклонённый промис) не ломает tick', async () => {
    const thrower = createClock({
      deviceId: 'device-clock-2', now: () => T0, load: () => null,
      save: () => {
        throw new Error('диск полон');
      },
    });
    expect(thrower.tick()).toBe(stamp(T0));
    const rejecter = createClock({ deviceId: 'device-clock-3', now: () => T0, load: () => null, save: () => Promise.reject(new Error('нет места')) });
    expect(rejecter.tick()).toBe(stamp(T0));
    await Promise.resolve();
  });

  it('now() вернул мусор — используется 0, но порядок сохраняется', () => {
    const { clock } = memoryClock(() => Number.NaN);
    const a = clock.tick();
    expect(clock.tick() > a).toBe(true);
  });

  it('observe: следующая метка больше увиденной чужой; метки из далёкого будущего и мусор игнорируются', () => {
    const { clock } = memoryClock(() => T0);
    clock.observe(stamp(T0 + 60_000)); // на минуту впереди — правдоподобно
    expect(clock.tick() > stamp(T0 + 60_000)).toBe(true);

    const other = memoryClock(() => T0);
    other.clock.observe(stamp(T0 + 3_600_000)); // час вперёд — сервер всё равно обрежет, часы не «отравляем»
    expect(other.clock.observe(stamp(T0 + 3_600_000))).toBe(false);
    expect(other.clock.observe('не метка')).toBe(false);
    expect(other.clock.observe(stamp(T0 - 1000))).toBe(true); // правдоподобная, но старая — принята, часы не откатываются
    expect(other.clock.tick()).toBe(stamp(T0));
  });

  it('observe: отстающие часы — метка сервера «на 6 минут вперёд» принимается, граница правдоподобия — 30 минут', () => {
    const { clock } = memoryClock(() => T0);
    expect(clock.observe(stamp(T0 + 6 * 60_000))).toBe(true);
    expect(clock.tick() > stamp(T0 + 6 * 60_000)).toBe(true);
    const other = memoryClock(() => T0);
    expect(other.clock.observe(stamp(T0 + 30 * 60_000))).toBe(true);
    expect(other.clock.observe(stamp(T0 + 30 * 60_000 + 1))).toBe(false);
  });

  it('observe(own=true): метка этого же устройства принимается даже из «будущего» (часы откатили назад, другая вкладка успела выдать метки)', () => {
    const { clock } = memoryClock(() => T0);
    expect(clock.observe(stamp(T0 + 3_600_000), true)).toBe(true);
    expect(clock.tick() > stamp(T0 + 3_600_000)).toBe(true);
  });

  it('save вызывается при каждом росте метки', () => {
    const save = vi.fn();
    const clock = createClock({ deviceId: 'device-clock-4', now: () => T0, load: () => null, save });
    clock.tick();
    clock.tick();
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('часы в хранилище', () => {
  it('последняя метка сохраняется атомарно с записью и переживает перезапуск при откатившихся часах', async () => {
    const factory = new IDBFactory();
    let now = T0;
    const s1 = await makeStore({ factory, now: () => now, deviceId: 'device-restart-1' });
    const { cash } = await basics(s1);
    const lastBefore = (await s1.db.wallets.get(cash.id))!.clientUpdatedAt;
    const persisted = (await s1.db.meta.get('lastStamp'))?.value;
    expect(typeof persisted).toBe('string');
    expect((persisted as string) >= lastBefore).toBe(true);
    s1.close();

    now = T0 - 7 * 86_400_000; // после «перезапуска» часы отстают на неделю
    const s2 = await makeStore({ factory, now: () => now, deviceId: 'device-restart-1' });
    const edited = await s2.wallets.update(cash.id, { name: 'Переименован' });
    expect(edited.clientUpdatedAt > (persisted as string)).toBe(true);
  });

  it('две вкладки одного устройства (два Store на одну базу) не выдают одинаковых меток', async () => {
    const factory = new IDBFactory();
    const frozen = () => T0;
    const tabA = await makeStore({ factory, now: frozen, deviceId: 'device-tabs-1' });
    const tabB = await makeStore({ factory, now: frozen, deviceId: 'device-tabs-1', userId: USER_A });
    await tabA.settings.ensure();
    const stamps = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const w1 = await tabA.wallets.create({ name: `A${i}`, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
      const w2 = await tabB.wallets.create({ name: `B${i}`, currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
      stamps.add(w1.clientUpdatedAt);
      stamps.add(w2.clientUpdatedAt);
    }
    expect(stamps.size).toBe(10);
  });
});
