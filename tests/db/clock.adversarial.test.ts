import { describe, expect, it } from 'vitest';
import { createClock } from '@/db';
import { makeStore, remoteWallet, stamp } from './helpers';

const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);
const MIN = 60_000;

describe('часы устройства, отстающие от остальных', () => {
  it('правка ПОСЛЕ получения чужой версии должна быть новее этой версии (отстающие на 6 минут часы)', async () => {
    // телефон «живёт» на 6 минут позади: ручная установка времени, сбитый часовой пояс и т.п.
    const phone = await makeStore({ now: () => T0 - 6 * MIN, deviceId: 'device-phone-1' });
    await phone.wallets.create({ name: 'Нал', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' }, { id: 'w-1' });
    // ПК с верными часами правит кошелёк и отправляет. Метка — «сейчас» по настоящему времени (в пределах разрешённых сервером).
    const remote = remoteWallet({ id: 'w-1', name: 'С ПК', clientUpdatedAt: stamp(T0), deviceId: 'device-pc-0001', createdAt: stamp(T0 - 10 * MIN) });
    await phone.sync.applyRemotePage('wallets', [{ entity: remote, serverSeq: 1 }], 1);
    expect((await phone.db.wallets.get('w-1'))?.name).toBe('С ПК');
    // человек видит имя «С ПК» и переименовывает его на телефоне
    const mine = await phone.wallets.update('w-1', { name: 'Переименовал позже' });
    // правка сделана ПОЗЖЕ чужой, которую человек уже видел на экране; она обязана победить при слиянии
    expect(mine.clientUpdatedAt > remote.clientUpdatedAt, `метка правки ${mine.clientUpdatedAt} не новее виденной ${remote.clientUpdatedAt}`).toBe(true);
  });

  it('то же на уровне чистых часов: observe(метка) отвергает метку, которую сервер уже принял как «сейчас»', () => {
    let wall = T0 - 6 * MIN;
    const clock = createClock({ deviceId: 'd', now: () => wall, load: () => null, save: () => undefined });
    const seen = stamp(T0); // метка с сервера, законная для сервера (≤ его «сейчас»+5 мин)
    clock.observe(seen);
    wall += 1;
    expect(clock.tick() > seen).toBe(true);
  });

  it('часы устройства сброшены на 1970 год: метки не должны уходить туда, где сервер их отвергает (CHECK: 2000–2100)', async () => {
    const dead = await makeStore({ now: () => 0, deviceId: 'device-dead-rtc1' });
    await dead.settings.ensure();
    const w = await dead.wallets.create({ name: 'Нал', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    expect(w.clientUpdatedAt >= '2000-01-01T00:00:00.000Z' && w.createdAt >= '2000-01-01T00:00:00.000Z', `метка ${w.clientUpdatedAt}`).toBe(true);
  });
});
