import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/db';
import { basics, makeStore } from './helpers';

describe('SettingsRepo', () => {
  it('до затравки настроек нет (null), обновлять нечего', async () => {
    const store = await makeStore();
    expect(await store.settings.get()).toBeNull();
    await expect(store.settings.update({ baseCurrency: 'USD' })).rejects.toThrow(/ещё не созданы/);
  });

  it('ensure создаёт строку с id = userId и значениями по умолчанию; повтор ничего не меняет', async () => {
    const store = await makeStore();
    const s = await store.settings.ensure();
    expect(s).toMatchObject({ id: store.userId, baseCurrency: 'TJS', locale: 'ru', weekStartsOn: 1, defaultWalletId: null, dirty: 1 });
    const again = await store.settings.ensure({ baseCurrency: 'USD' });
    expect(again.baseCurrency).toBe('TJS');
    expect(again.clientUpdatedAt).toBe(s.clientUpdatedAt);
    expect(await store.db.settings.count()).toBe(1);
  });

  it('update меняет валюту и неделю, снимает карантин', async () => {
    const store = await makeStore();
    await store.settings.ensure();
    await store.sync.quarantine('settings', [store.userId], 'ошибка');
    const u = await store.settings.update({ baseCurrency: 'USD', weekStartsOn: 0 });
    expect(u).toMatchObject({ baseCurrency: 'USD', weekStartsOn: 0, syncError: null, dirty: 1 });
  });

  it.each([
    ['валюта строчными', { baseCurrency: 'usd' }],
    ['неделя 2', { weekStartsOn: 2 }],
    ['неделя дробная', { weekStartsOn: 0.5 }],
    ['язык нельзя менять', { locale: 'en' }],
    ['id нельзя менять', { id: 'x' }],
  ])('отвергает: %s', async (_n, bad) => {
    const store = await makeStore();
    await store.settings.ensure();
    await expect(store.settings.update(bad as never)).rejects.toBeInstanceOf(ValidationError);
  });

  it('кошелёк по умолчанию: должен существовать, быть живым и не в архиве; null допустим', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    expect((await store.settings.update({ defaultWalletId: cash.id })).defaultWalletId).toBe(cash.id);
    await expect(store.settings.update({ defaultWalletId: 'no-such-id' })).rejects.toThrow(/не найден/);
    await store.wallets.archive(usd.id);
    await expect(store.settings.update({ defaultWalletId: usd.id })).rejects.toThrow(/в архиве/);
    expect((await store.settings.update({ defaultWalletId: null })).defaultWalletId).toBeNull();
  });

  it('правка без изменений не пишет', async () => {
    const store = await makeStore();
    const s = await store.settings.ensure();
    const u = await store.settings.update({ baseCurrency: 'TJS' });
    expect(u.clientUpdatedAt).toBe(s.clientUpdatedAt);
  });
});
