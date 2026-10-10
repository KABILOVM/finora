/*
 * ОБРАЗЦЫ, ЧИСЛА ВЫДУМАНЫ. Структура строки взята из supabase/schema.sql (public.exchange_rates):
 * as_of date, source text, pivot text, per_unit jsonb, fetched_at timestamptz.
 * Метка времени в виде '...123456+00:00' — так PostgREST отдаёт timestamptz (по аналогии с sync/tables.ts); на живой базе НЕ проверено.
 */

export const SERVER_ROW_NBT = {
  as_of: '2026-10-10',
  source: 'nbt',
  pivot: 'TJS',
  per_unit: { TJS: 1, USD: 10.95, EUR: 12.78, RUB: 0.1189 },
  fetched_at: '2026-10-10T05:00:00.123456+00:00',
};

export const SERVER_ROW_API = {
  as_of: '2026-10-10',
  source: 'api',
  pivot: 'TJS',
  per_unit: { TJS: 1, USD: 9.2, EUR: 10, RUB: 0.0963 },
  fetched_at: '2026-10-10T06:00:00+00:00',
};

export const SERVER_ROW_YESTERDAY = {
  as_of: '2026-10-09',
  source: 'nbt',
  pivot: 'TJS',
  per_unit: { TJS: 1, USD: 10.9, EUR: 12.7 },
  fetched_at: '2026-10-09T05:00:00+00:00',
};
