// @vitest-environment node
// Edge-функция: скачок экзотической валюты не блокирует запись; сравнение идёт с таблицей, где есть сомони.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW } from './__fixtures__/testkit';
import * as edge from '../../supabase/functions/fetch-rates/index';

const BASE = 'https://proj.supabase.co';
const ENV: Record<string, string> = { CRON_SECRET: 'cron-secret-0123456789-abcdef', SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-XYZ-987654321' };

const valute = (code: string, value: string): string => `<Valute><CharCode>${code}</CharCode><Nominal>1</Nominal><Value>${value}</Value></Valute>`;
const nbtXml = (...records: string[]): string => `<?xml version="1.0" encoding="UTF-8"?><ValCurs Date="10.10.2026">${records.join('')}</ValCurs>`;
const row = (asOf: string, pivot: string, perUnit: Record<string, number>, source = 'nbt') => ({
  as_of: asOf,
  source,
  pivot,
  per_unit: perUnit,
  fetched_at: `${asOf}T05:00:00+00:00`,
});

interface Outcome {
  status: number;
  body: Record<string, any>;
  saved: Record<string, any> | null;
}

async function run(dbRows: unknown[], nbt: string, api = '{"date":"2026-10-10","usd":{"tjs":9.2,"eur":0.92}}'): Promise<Outcome> {
  let saved: Record<string, any> | null = null;
  const fetchImpl: edge.FetchFn = async (url, init) => {
    if (url.startsWith(`${BASE}/rest/v1/exchange_rates`)) {
      if (init?.method === 'POST') {
        saved = (JSON.parse(init.body as string) as Record<string, any>[])[0] ?? null;
        return new Response(null, { status: 201 });
      }
      return Response.json(dbRows);
    }
    if (url === edge.NBT_URL) return new Response(nbt, { headers: { 'content-type': 'application/xml' } });
    if (edge.API_MIRRORS.includes(url)) return new Response(api, { headers: { 'content-type': 'application/json' } });
    throw new Error(`неожиданный адрес ${url}`);
  };
  const req = new Request('https://proj.supabase.co/functions/v1/fetch-rates', { method: 'POST', headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } });
  const res = await edge.handler(req, { env: (n) => ENV[n], fetchImpl, now: () => NOW });
  return { status: res.status, body: (await res.json()) as Record<string, any>, saved };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('handler: скачок валюты, которой нет в списке приложения', () => {
  const prev = row('2026-10-09', 'TJS', { TJS: 1, USD: 10.9, EUR: 12.7, ARS: 0.01 });

  it('обвал ARS: запись делается БЕЗ ARS, остальные курсы обновлены, в ответе excluded и предупреждение', async () => {
    const out = await run([prev], nbtXml(valute('USD', '10,95'), valute('EUR', '12,78'), valute('ARS', '0,0025')));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, source: 'nbt', excluded: ['ARS'], failures: [] });
    expect(out.body.warnings.join(' ')).toContain('ARS: 0.01 → 0.0025 (−75%)');
    expect(out.saved?.per_unit).toEqual({ TJS: 1, USD: 10.95, EUR: 12.78 });
  });

  it('без скачков excluded пуст, ARS записывается', async () => {
    const out = await run([prev], nbtXml(valute('USD', '10,95'), valute('EUR', '12,78'), valute('ARS', '0,0102')));
    expect(out.body).toMatchObject({ ok: true, excluded: [] });
    expect(out.saved?.per_unit.ARS).toBeCloseTo(0.0102, 10);
  });

  it('скачок USD вместе с ARS: НБТ отвергнут целиком, берётся запасной источник', async () => {
    const out = await run([prev], nbtXml(valute('USD', '25,00'), valute('EUR', '12,78'), valute('ARS', '0,0025')));
    expect(out.body.source).toBe('api');
    expect(out.body.failures[0]).toMatchObject({ source: 'nbt' });
    expect(out.body.failures[0].message).toContain('USD: 10.9 → 25');
    expect(out.body.excluded).toEqual([]);
  });
});

describe('handler: с чем сравнивается новая таблица', () => {
  const nbtYesterday = row('2026-10-09', 'TJS', { TJS: 1, USD: 10.95, EUR: 12.78 });
  // запасной источник без tjs записал свежую строку; она «слепа» к масштабу сомони
  const apiNoTjs = row('2026-10-10', 'USD', { USD: 1, EUR: 1.167 }, 'api');

  it('ошибка масштаба в курсе сомони ловится по вчерашней строке НБТ, хотя самая свежая строка без TJS', async () => {
    const out = await run([apiNoTjs, nbtYesterday], nbtXml(valute('USD', '109,5'), valute('EUR', '127,8')), '{"date":"2026-10-10","usd":{"eur":0.857}}');
    // НБТ отвергнут как подозрительный (×10); запасной источник без tjs согласован с прежними (EUR/USD) и записывается
    expect(out.body.failures[0]).toMatchObject({ source: 'nbt' });
    expect(out.body.failures[0].message).toContain('USD: 10.95 → 109.5');
    expect(out.body.source).toBe('api');
  });

  it('нормальный курс НБТ при такой же базе проходит', async () => {
    const out = await run([apiNoTjs, nbtYesterday], nbtXml(valute('USD', '10,96'), valute('EUR', '12,79')));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ source: 'nbt', failures: [] });
  });
});
