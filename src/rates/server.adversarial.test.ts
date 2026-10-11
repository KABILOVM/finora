// @vitest-environment node
// Состязательные тесты провайдера server и его связки с сервисом.
import { describe, expect, it } from 'vitest';
import { SERVER_ROW_NBT, SERVER_ROW_YESTERDAY } from './__fixtures__/server.fixtures';
import { NOW, setup } from './__fixtures__/testkit';
import { serverProvider, type RatesClient, type RatesQueryResult } from './server';

function clientWith(data: unknown[]): RatesClient {
  const result: RatesQueryResult = { data, error: null };
  return { from: () => ({ select: () => ({ order: () => ({ limit: () => Promise.resolve(result) }) }) }) };
}

describe('server: связка с Edge-функцией при сбое НБТ', () => {
  it('самая свежая строка api БЕЗ tjs не должна лишать свежую установку курса к сомони, если на сервере есть строка НБТ за вчера', async () => {
    // Edge-функция при падении НБТ записала api-таблицу без tjs (pivot USD) за сегодня; вчерашняя строка НБТ с TJS лежит рядом.
    const apiNoTjs = {
      as_of: '2026-10-10',
      source: 'api',
      pivot: 'USD',
      per_unit: { USD: 1, EUR: 1.167, RUB: 0.0109 },
      fetched_at: '2026-10-10T06:00:00+00:00',
    };
    const client = clientWith([apiNoTjs, SERVER_ROW_YESTERDAY]);
    // чистая установка: в хранилище ничего нет
    const { service } = setup([serverProvider(client, { now: () => NOW })]);
    const r = await service.refresh();
    expect(r.ok).toBe(true);
    // пользователь с базовой валютой TJS и кошельком в USD должен получить курс (пусть и вчерашний), а не null
    expect(service.getRate('USD', 'TJS')).not.toBeNull();
  });

  it('контроль: если свежая строка содержит TJS, курс доступен', async () => {
    const { service } = setup([serverProvider(clientWith([SERVER_ROW_NBT]), { now: () => NOW })]);
    await service.refresh();
    expect(service.getRate('USD', 'TJS')?.rate).toBe(10.95);
  });
});
