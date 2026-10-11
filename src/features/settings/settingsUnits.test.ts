import { describe, expect, it } from 'vitest';
import { isForeignBackup, withoutSettings } from './backupAccount';
import { formatRate, formatRateExact, parseRateInput, rateSourceLabel } from './rateInput';
import { describeSync, formatDateTime } from './syncText';
import type { SyncStatus } from '@/sync/transport';

describe('parseRateInput', () => {
  it.each([
    ['10,9', 10.9],
    ['10.9', 10.9],
    ['  1 000  ', 1000],
    ['0,00085', 0.00085],
    ['12', 12],
    ['.5', 0.5],
    ['0,000000001', 1e-9], // ровно минимум, который принимает сервис курсов
  ])('%j → %j', (input, expected) => {
    expect(parseRateInput(input)).toBeCloseTo(expected, 12);
  });

  it('меньше допустимого минимума сервиса курсов — отказ', () => {
    expect(parseRateInput('0,0000000001')).toBeNull();
  });

  it.each([[''], ['abc'], ['-5'], ['0'], ['0,0'], ['1e3'], ['1,2,3'], ['1.2.3'], ['10,9 с.'], ['Infinity'], ['NaN'], ['1,00000000001'], ['9999999999'], ['١٢']])(
    'отвергает %j',
    (input) => {
      expect(parseRateInput(input)).toBeNull();
    },
  );
});

describe('formatRate', () => {
  it('курсы побольше — до 4 знаков без хвостовых нулей', () => {
    expect(formatRate(10.9)).toBe('10,9');
    expect(formatRate(10.90001)).toBe('10,9');
    expect(formatRate(1)).toBe('1');
    expect(formatRate(1234.5678)).toBe('1 234,5678');
  });
  it('маленькие курсы сохраняют значащие цифры', () => {
    expect(formatRate(0.00085)).toBe('0,00085');
    expect(formatRate(0.000123456)).toBe('0,00012346');
  });
  it('мусор → тире', () => {
    expect(formatRate(0)).toBe('—');
    expect(formatRate(NaN)).toBe('—');
    expect(formatRate(-1)).toBe('—');
  });
  it('подписи источников', () => {
    expect(rateSourceLabel('nbt')).toContain('Нацбанк');
    expect(rateSourceLabel('manual')).toBe('задан вручную');
    expect(rateSourceLabel('неизвестный')).toBe('неизвестный');
  });
});

describe('formatRateExact — значение для поля ввода без округления', () => {
  it.each([
    [10.123456, '10,123456'],
    [10.9, '10,9'],
    [1, '1'],
    [1234.5678, '1234,5678'],
    [0.00085, '0,00085'],
    [1e-9, '0,000000001'],
    [1e9, '1000000000'],
  ])('%j → %j', (rate, text) => {
    expect(formatRateExact(rate)).toBe(text);
  });

  it('мусор → пустая строка', () => {
    for (const bad of [0, -1, NaN, Infinity]) expect(formatRateExact(bad)).toBe('');
  });

  it('то, что принял parseRateInput, возвращается тем же числом (сохранить без правок курс не меняет)', () => {
    for (const s of ['10,123456', '0,0000000123', '99999,9999999999', '123456789,1234567891', '0,333333333', '1000000000', '0,000000001']) {
      const n = parseRateInput(s);
      expect(n, s).not.toBeNull();
      expect(parseRateInput(formatRateExact(n as number)), s).toBe(n);
    }
  });
});

describe('isForeignBackup / withoutSettings', () => {
  const ME = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';

  it('чужой UUID в настройках — чужая копия; свой (в любом регистре) — своя', () => {
    expect(isForeignBackup({ settings: { id: OTHER } }, ME)).toBe(true);
    expect(isForeignBackup({ settings: { id: ME } }, ME)).toBe(false);
    expect(isForeignBackup({ settings: { id: ME.toUpperCase() } }, ME)).toBe(false);
  });

  it('нет настроек, не UUID, мусор — не «чужая копия» (дальше решает сама проверка файла)', () => {
    for (const data of [null, 5, 'x', [], {}, { settings: null }, { settings: [] }, { settings: { id: 'abc' } }, { settings: { id: 7 } }]) {
      expect(isForeignBackup(data, ME), JSON.stringify(data)).toBe(false);
    }
  });

  it('withoutSettings убирает только блок настроек и не мутирует исходник', () => {
    const src = { format: 'finora-backup', settings: { id: OTHER }, wallets: [1] };
    expect(withoutSettings(src)).toEqual({ format: 'finora-backup', settings: null, wallets: [1] });
    expect(src.settings).toEqual({ id: OTHER });
    expect(withoutSettings('не объект')).toBe('не объект');
  });
});

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  phase: 'idle',
  pending: 0,
  quarantined: 0,
  lastSyncedAt: '2026-10-10T10:00:00.000Z',
  lastError: null,
  ...over,
});

describe('describeSync — «Всё отправлено» только когда это правда', () => {
  it('idle, ничего не ждёт, синхронизация была → «Всё отправлено в облако»', () => {
    expect(describeSync(status())).toMatchObject({ headline: 'Всё отправлено в облако', tone: 'ok' });
  });
  it('idle, но синхронизации ещё не было → НЕ «Всё отправлено»', () => {
    const d = describeSync(status({ lastSyncedAt: null }));
    expect(d.headline).toBe('Ещё не синхронизировалось');
    expect(d.tone).not.toBe('ok');
  });
  it('есть неотправленные → показываем число, не «Всё отправлено»', () => {
    const d = describeSync(status({ pending: 3 }));
    expect(d.headline).toBe('Ждут отправки: 3 записи');
    expect(d.tone).not.toBe('ok');
  });
  it('склонение: 1 запись, 2 записи, 5 записей, 21 запись', () => {
    expect(describeSync(status({ pending: 1 })).headline).toContain('1 запись');
    expect(describeSync(status({ pending: 2 })).headline).toContain('2 записи');
    expect(describeSync(status({ pending: 5 })).headline).toContain('5 записей');
    expect(describeSync(status({ pending: 21 })).headline).toContain('21 запись');
  });
  it('отвергнутые сервером видны в любой фазе и не дают «Всё отправлено»', () => {
    expect(describeSync(status({ quarantined: 2 })).headline).toBe('Сервер не принял 2 записи');
    expect(describeSync(status({ phase: 'offline', quarantined: 2 })).detail).toContain('Сервер не принял 2 записи');
    expect(describeSync(status({ phase: 'error', quarantined: 1 })).detail).toContain('Сервер не принял 1 запись');
    expect(describeSync(status({ phase: 'syncing', quarantined: 1 })).detail).toContain('Сервер не принял 1 запись');
    expect(describeSync(status({ phase: 'auth-required', quarantined: 5 })).detail).toContain('Сервер не принял 5 записей');
  });
  it('нет сети: сообщает, что всё сохранено на устройстве и сколько ждёт', () => {
    const d = describeSync(status({ phase: 'offline', pending: 4 }));
    expect(d.headline).toBe('Нет связи с облаком');
    expect(d.detail).toContain('Ждут отправки: 4 записи');
    expect(d.detail).toContain('сохранено на устройстве');
  });
  it('ошибка: причина из статуса', () => {
    const d = describeSync(status({ phase: 'error', lastError: 'сервер перегружен' }));
    expect(d.headline).toBe('Не удалось синхронизировать');
    expect(d.detail).toContain('сервер перегружен');
    expect(d.tone).toBe('bad');
  });
  it('нужен вход', () => {
    const d = describeSync(status({ phase: 'auth-required', pending: 2 }));
    expect(d.headline).toBe('Нужно войти заново');
    expect(d.detail).toContain('Ждут отправки: 2 записи');
  });
  it('идёт синхронизация', () => {
    expect(describeSync(status({ phase: 'syncing' })).headline).toBe('Идёт синхронизация…');
  });
});

describe('formatDateTime', () => {
  const now = new Date(2026, 9, 10, 18, 0, 0);
  it('сегодня и вчера по местному времени', () => {
    expect(formatDateTime(new Date(2026, 9, 10, 9, 5).toISOString(), now)).toBe('Сегодня, 09:05');
    expect(formatDateTime(new Date(2026, 9, 9, 23, 59).toISOString(), now)).toBe('Вчера, 23:59');
  });
  it('давнее — с датой', () => {
    expect(formatDateTime(new Date(2026, 9, 5, 16, 40).toISOString(), now)).toBe('пн, 5 окт, 16:40');
  });
  it('мусор и null не роняют', () => {
    expect(formatDateTime(null, now)).toBe('неизвестно');
    expect(formatDateTime('вчера вечером', now)).toBe('неизвестно');
  });
});
