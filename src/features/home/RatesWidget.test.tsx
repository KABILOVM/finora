import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { screen, user } from '@/components/testUtils';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import type { RateTable } from '@/domain/types';
import RatesWidget from './RatesWidget';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const widget = () => document.querySelector('[data-testid="rates-widget"]') as HTMLElement | null;
/** Строка курса: подписи лежат в блоках друг под другом, в тесте склеиваем их через пробел. */
const rows = () =>
  Array.from(document.querySelectorAll('[data-testid="rates-widget-row"]')).map((r) =>
    norm(Array.from(r.querySelectorAll('span > span')).map((x) => x.textContent).join(' ')),
  );

const withRub = (over: Partial<RateTable> = {}) => table({ perUnit: { TJS: 1, USD: 10.9, EUR: 12, RUB: 0.121 }, ...over });

async function open(tables: RateTable[], base = 'TJS') {
  const td = opsDeps(tables);
  await showApp(
    <>
      <RatesWidget base={base} />
      <LocationProbe />
    </>,
    td,
    '/',
  );
  await eventually(() => expect(widget()).not.toBeNull());
  return td;
}

describe('виджет «Курсы» на «Главной»', () => {
  it('доллар за 1 и рубль за 100 к сомони, дата курса', async () => {
    await open([withRub()]);
    expect(rows()).toEqual(['1 USD 10,90 с.', '100 RUB 12,10 с.']);
    // дата курса и «устарел» не занимают места в полосе: они в имени ссылки (и жёлтой точкой у устаревшего)
    expect(widget()?.getAttribute('aria-label')).toContain('на 10.10');
    expect(widget()?.getAttribute('aria-label')).not.toContain('устарел');
    expect(widget()?.querySelector('[title="Курс устарел"]')).toBeNull();
  });

  it('доступное имя ссылки перечисляет курсы и говорит, куда ведёт', async () => {
    await open([withRub()]);
    const link = screen.getByRole('link', { name: /Курсы к Сомони: 1 USD = 10,90 с\.; 100 RUB = 12,10 с\./ });
    expect(norm(link.getAttribute('aria-label'))).toMatch(/Открыть курсы валют$/);
  });

  it('курсу больше 3 суток — пометка «устарел» словами и в имени ссылки', async () => {
    await open([withRub({ asOf: '2026-10-01', fetchedAt: '2026-10-01T08:00:00.000Z' })]);
    expect(widget()?.getAttribute('aria-label')).toContain('на 01.10');
    expect(widget()?.getAttribute('aria-label')).toContain('Курсы устарели');
    expect(widget()?.querySelector('[title="Курс устарел"]')).not.toBeNull(); // жёлтая точка
  });

  it('нет курса рубля — «нет курса» у него, доллар на месте', async () => {
    await open([table()]); // в таблице нет RUB
    expect(rows()).toEqual(['1 USD 10,90 с.', 'RUB нет курса']);
  });

  it('курсов нет совсем — честно «нет курса» и подсказка, без цифр', async () => {
    await open([]);
    expect(rows()).toEqual(['USD нет курса', 'RUB нет курса']);
    expect(widget()?.getAttribute('aria-label')).toBe('Курсы валют: пока нет данных. Открыть курсы валют');
  });

  it('основная валюта — доллар: показываем рубль и евро к доллару', async () => {
    await open([withRub()], 'USD');
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toBe('1 000 RUB 11,10 $');
    expect(rows()[1]).toBe('1 EUR 1,10 $');
    expect(rows().join(' ')).not.toContain('USD');
  });

  it('нажатие открывает раздел «Курсы валют»', async () => {
    await open([withRub()]);
    expect(currentPath()).toBe('/');
    await user.click(widget() as HTMLElement);
    expect(currentPath()).toBe('/rates');
  });
});
