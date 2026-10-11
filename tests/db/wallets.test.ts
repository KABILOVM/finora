import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@/db';
import { basics, expense, makeStore } from './helpers';

const base = { name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 5000, color: '#123456', icon: '💳' } as const;

describe('WalletsRepo.create', () => {
  it('создаёт кошелёк: dirty, метка часов, устройство, без карантина, порядок по возрастанию', async () => {
    const store = await makeStore({ deviceId: 'device-wallets-1' });
    const a = await store.wallets.create(base);
    const b = await store.wallets.create({ ...base, name: 'Вторая' });
    expect(a).toMatchObject({ ...base, dirty: 1, syncError: null, serverSeq: null, deviceId: 'device-wallets-1', deletedAt: null, archivedAt: null });
    expect(a.createdAt).toBe(a.clientUpdatedAt);
    expect(b.clientUpdatedAt > a.clientUpdatedAt).toBe(true);
    expect(b.sortOrder).toBe(a.sortOrder + 1);
    expect(await store.db.wallets.get(a.id)).toEqual(a);
  });

  it('принимает отрицательный начальный остаток (кредитная карта) и обрезает пробелы в названии', async () => {
    const store = await makeStore();
    const w = await store.wallets.create({ ...base, name: '  Кредитка  ', openingBalanceMinor: -250_000 });
    expect(w.name).toBe('Кредитка');
    expect(w.openingBalanceMinor).toBe(-250_000);
  });

  it.each([
    ['пустое название', { name: '   ' }],
    ['слишком длинное название', { name: 'я'.repeat(61) }],
    ['валюта строчными', { currency: 'tjs' }],
    ['валюта из двух букв', { currency: 'TJ' }],
    ['неизвестный вид', { kind: 'crypto' }],
    ['дробный остаток', { openingBalanceMinor: 10.5 }],
    ['остаток NaN', { openingBalanceMinor: Number.NaN }],
    ['остаток вне безопасных целых', { openingBalanceMinor: Number.MAX_SAFE_INTEGER + 1 }],
    ['остаток текстом', { openingBalanceMinor: '100' }],
    ['пустой цвет', { color: '' }],
    ['лишнее поле', { dirty: 0 }],
    ['попытка задать id', { id: 'x' }],
  ])('отвергает: %s', async (_name, bad) => {
    const store = await makeStore();
    await expect(store.wallets.create({ ...base, ...bad } as never)).rejects.toBeInstanceOf(ValidationError);
    expect(await store.db.wallets.count()).toBe(0);
  });

  it('ошибки по-русски', async () => {
    const store = await makeStore();
    await expect(store.wallets.create({ ...base, name: '' })).rejects.toThrow(/Название кошелька/);
  });

  it('явный id проверяется: пробелы и пустота не годятся', async () => {
    const store = await makeStore();
    await expect(store.wallets.create(base, { id: 'a b' })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.wallets.create(base, { id: '' })).rejects.toBeInstanceOf(ValidationError);
    expect(await store.db.wallets.count()).toBe(0);
  });

  it('детерминированный id для затравки; повтор с тем же id — ошибка, не дубль', async () => {
    const store = await makeStore();
    const id = 'seed-wallet-1';
    const w = await store.wallets.create(base, { id });
    expect(w.id).toBe(id);
    await expect(store.wallets.create(base, { id })).rejects.toThrow(/уже существует/);
    expect(await store.db.wallets.count()).toBe(1);
  });
});

describe('WalletsRepo.update / archive / restore', () => {
  it('меняет поля, двигает метку и помечает dirty', async () => {
    const store = await makeStore();
    const w = await store.wallets.create(base);
    await store.db.wallets.update(w.id, { dirty: 0 }); // как будто уже отправлен
    const u = await store.wallets.update(w.id, { name: 'Зарплатная', openingBalanceMinor: 7000 });
    expect(u).toMatchObject({ name: 'Зарплатная', openingBalanceMinor: 7000, dirty: 1 });
    expect(u.clientUpdatedAt > w.clientUpdatedAt).toBe(true);
    expect(u.createdAt).toBe(w.createdAt);
  });

  it('правка без изменений ничего не пишет (нет лишней отправки)', async () => {
    const store = await makeStore();
    const w = await store.wallets.create(base);
    await store.db.wallets.update(w.id, { dirty: 0 });
    const same = await store.wallets.update(w.id, { name: base.name });
    expect(same.dirty).toBe(0);
    expect(same.clientUpdatedAt).toBe(w.clientUpdatedAt);
  });

  it('правка карантинной строки снимает карантин', async () => {
    const store = await makeStore();
    const w = await store.wallets.create(base);
    await store.sync.quarantine('wallets', [w.id], 'нарушено ограничение');
    expect((await store.db.wallets.get(w.id))?.syncError).toBe('нарушено ограничение');
    const u = await store.wallets.update(w.id, { name: 'Исправлено' });
    expect(u.syncError).toBeNull();
    expect(u.dirty).toBe(1);
  });

  it('валюту можно менять, пока нет операций', async () => {
    const store = await makeStore();
    const w = await store.wallets.create(base);
    expect((await store.wallets.update(w.id, { currency: 'USD' })).currency).toBe('USD');
  });

  it('валюту нельзя менять, когда есть живая операция', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    await expense(store, cash.id, 1000);
    await expect(store.wallets.update(cash.id, { currency: 'USD' })).rejects.toThrow(/валюту кошелька/);
    expect((await store.db.wallets.get(cash.id))?.currency).toBe('TJS');
  });

  it('валюту нельзя менять и когда операция только что удалена (иначе восстановление исказит суммы)', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const t = await expense(store, cash.id, 1000);
    await store.transactions.softDelete(t.id);
    await expect(store.wallets.update(cash.id, { currency: 'USD' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('валюту нельзя менять у кошелька-получателя перевода', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    await store.transactions.create({
      kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 1090, toAmountMinor: 100, occurredOn: '2026-10-05',
    });
    await expect(store.wallets.update(usd.id, { currency: 'EUR' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('менять служебные поля через update нельзя', async () => {
    const store = await makeStore();
    const w = await store.wallets.create(base);
    await expect(store.wallets.update(w.id, { deletedAt: '2026-01-01T00:00:00.000Z' } as never)).rejects.toThrow(/менять нельзя/);
    await expect(store.wallets.update(w.id, { archivedAt: null } as never)).rejects.toThrow(/менять нельзя/);
  });

  it('несуществующий кошелёк — понятная ошибка', async () => {
    const store = await makeStore();
    await expect(store.wallets.update('no-such-id', { name: 'x' })).rejects.toThrow(/не найден/);
  });

  it('архив и возврат: остаток и операции сохраняются, повтор безопасен', async () => {
    const store = await makeStore();
    const w = await store.wallets.create(base);
    const a = await store.wallets.archive(w.id);
    expect(a.archivedAt).not.toBeNull();
    const again = await store.wallets.archive(w.id);
    expect(again.clientUpdatedAt).toBe(a.clientUpdatedAt); // повтор не пишет
    const r = await store.wallets.restore(w.id);
    expect(r.archivedAt).toBeNull();
    expect(r.clientUpdatedAt > a.clientUpdatedAt).toBe(true);
  });

  it('удалённый (с сервера) кошелёк не правится', async () => {
    const store = await makeStore();
    const w = await store.wallets.create(base);
    await store.db.wallets.update(w.id, { deletedAt: '2026-10-01T00:00:00.000Z' });
    await expect(store.wallets.update(w.id, { name: 'x' })).rejects.toThrow(/удалён/);
  });
});

describe('onLocalChange', () => {
  it('срабатывает после записи; отписка работает; сбой подписчика не ломает запись', async () => {
    const store = await makeStore();
    const seen = vi.fn();
    const off = store.onLocalChange(seen);
    store.onLocalChange(() => {
      throw new Error('сломанный подписчик');
    });
    const w = await store.wallets.create(base);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(await store.db.wallets.get(w.id)).toBeDefined();
    off();
    await store.wallets.update(w.id, { name: 'Другое' });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('при ошибке валидации не срабатывает и ничего не пишется', async () => {
    const store = await makeStore();
    const seen = vi.fn();
    store.onLocalChange(seen);
    await expect(store.wallets.create({ ...base, name: '' })).rejects.toBeInstanceOf(ValidationError);
    expect(seen).not.toHaveBeenCalled();
  });

  it('markPushed и загрузка с сервера не считаются локальным изменением', async () => {
    const store = await makeStore();
    const w = await store.wallets.create(base);
    const seen = vi.fn();
    store.onLocalChange(seen);
    await store.sync.markPushed('wallets', [{ id: w.id, clientUpdatedAt: w.clientUpdatedAt, deviceId: w.deviceId }]);
    expect(seen).not.toHaveBeenCalled();
  });
});
