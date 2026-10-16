import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/db';
import { stringifyWeather } from '@/domain/weatherPlaces';
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

describe('SettingsRepo: города для погоды', () => {
  const PLACES = stringifyWeather({
    selected: '38.56,68.79',
    cities: [
      { id: '38.56,68.79', name: 'Душанбе', region: 'Таджикистан', lat: 38.5598, lon: 68.787 },
      { id: '37.50,70.25', name: 'Моё местоположение', region: '', lat: 37.5, lon: 70.25, here: true },
    ],
  });

  it('по умолчанию null; затравка и ensure его не трогают', async () => {
    const store = await makeStore();
    expect((await store.settings.ensure()).weather).toBeNull();
  });

  it('выбор записывается отдельной группой «weather» и снимает карантин; чужие группы не помечаются', async () => {
    const store = await makeStore();
    await store.settings.ensure();
    await store.sync.markPushed('settings', [{ id: store.userId, clientUpdatedAt: (await store.settings.get())!.clientUpdatedAt, deviceId: store.deviceId }]);
    const u = await store.settings.update({ weather: PLACES });
    expect(u).toMatchObject({ weather: PLACES, dirty: 1, dirtyGroups: ['weather'] });
  });

  it('тот же выбор второй раз — ничего не пишет; null сбрасывает', async () => {
    const store = await makeStore();
    const s0 = await store.settings.ensure();
    const a = await store.settings.update({ weather: PLACES });
    const same = await store.settings.update({ weather: PLACES });
    expect(same.clientUpdatedAt).toBe(a.clientUpdatedAt);
    expect(a.clientUpdatedAt >= s0.clientUpdatedAt).toBe(true);
    expect((await store.settings.update({ weather: null })).weather).toBeNull();
  });

  it('текст приводится к каноническому виду: одинаковое содержимое не плодит правок', async () => {
    const store = await makeStore();
    await store.settings.ensure();
    const loose = JSON.stringify({ cities: [{ lon: 70.25, lat: 37.5, region: '', name: ' Дом ', id: '37.50,70.25' }], selected: null, v: 1 });
    const saved = (await store.settings.update({ weather: loose })).weather!;
    expect(saved).toBe('{"v":1,"selected":null,"cities":[{"id":"37.50,70.25","name":"Дом","region":"","lat":37.5,"lon":70.25}]}');
  });

  it.each([
    ['не JSON', '{'],
    ['пустой список', '{"v":1,"selected":null,"cities":[]}'],
    ['выбранного нет в списке', '{"v":1,"selected":"x","cities":[{"id":"y","name":"Н","region":"","lat":1,"lon":1}]}'],
    ['слишком длинный текст', ' '.repeat(8001)],
    ['число', 5],
  ])('отвергает: %s', async (_n, bad) => {
    const store = await makeStore();
    await store.settings.ensure();
    await expect(store.settings.update({ weather: bad as never })).rejects.toBeInstanceOf(ValidationError);
    expect((await store.settings.get())?.weather).toBeNull();
  });

  it('незнакомая запись (например, от более нового приложения) не мешает менять другие настройки и не затирается ими', async () => {
    const store = await makeStore();
    await store.settings.ensure();
    const future = '{"v":2,"что-то":"новое"}';
    await store.db.settings.update(store.userId, { weather: future });
    const u = await store.settings.update({ baseCurrency: 'USD' });
    expect(u).toMatchObject({ baseCurrency: 'USD', weather: future, dirtyGroups: ['baseCurrency'] });
  });

  it('строка без ключа weather (записана прежней вкладкой после обновления) читается как «нет» и правится без ошибок', async () => {
    const store = await makeStore();
    await store.settings.ensure();
    await store.db.settings.where('id').equals(store.userId).modify((s) => {
      delete (s as unknown as Record<string, unknown>)['weather'];
    });
    const u = await store.settings.update({ weekStartsOn: 0 });
    expect(u).toMatchObject({ weekStartsOn: 0, weather: null });
    const same = await store.settings.update({ weather: null });
    expect(same.clientUpdatedAt).toBe(u.clientUpdatedAt);
  });
});
