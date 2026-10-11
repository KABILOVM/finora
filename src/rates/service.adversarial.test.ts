// @vitest-environment node
// Состязательные тесты сервиса курсов: каждый тест пытается доказать поломку. Красный тест = находка.
import { describe, expect, it } from 'vitest';
import type { RateTable } from '@/domain/types';
import { API_MIRRORS, apiProvider, parseCurrencyApiJson } from './api';
import type { ResponseLike } from './http';
import { NOW, makeTable, ok, okResponse, routeFetch, setup, stubProvider } from './__fixtures__/testkit';
import { createRateService } from './service';
import { assessRateTable } from './sanity';
import { createMemoryRateStorage } from './storage';

const day = (n: number): string => new Date(Date.parse('2026-10-10T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

describe('две вкладки / два экземпляра сервиса на одном хранилище', () => {
  it('ручной курс, заданный в одной вкладке, не должен затираться обновлением в другой', async () => {
    const storage = createMemoryRateStorage();
    const tabA = createRateService({ providers: [], storage, now: () => NOW });
    const tabB = createRateService({ providers: [stubProvider('nbt', ok())], storage, now: () => NOW });
    // обе вкладки открыты; пользователь во вкладке A задаёт свой курс 11.5
    tabA.setManualRate('USD', 'TJS', 11.5);
    // вкладка B (открыта раньше, о ручном курсе не знает) обновляет курсы и пишет СВОЁ состояние
    await tabB.refresh();
    // после перезагрузки страницы:
    const reloaded = createRateService({ providers: [], storage, now: () => NOW });
    expect(reloaded.getRate('USD', 'TJS')).toMatchObject({ rate: 11.5, source: 'manual' });
  });

  it('удалённый в одной вкладке ручной курс не должен воскресать из устаревшего состояния другой вкладки', async () => {
    const storage = createMemoryRateStorage();
    const seed = createRateService({ providers: [], storage, now: () => NOW });
    seed.setManualRate('USD', 'TJS', 11.5);
    // обе вкладки загрузились, когда ручной курс ещё был
    const tabA = createRateService({ providers: [], storage, now: () => NOW });
    const tabB = createRateService({ providers: [stubProvider('nbt', ok())], storage, now: () => NOW });
    tabA.clearManualRate('USD', 'TJS'); // пользователь удалил ручной курс
    await tabB.refresh(); // вкладка B записывает своё устаревшее состояние
    const reloaded = createRateService({ providers: [], storage, now: () => NOW });
    expect(reloaded.getRate('USD', 'TJS')?.source).not.toBe('manual');
  });
});

describe('проверка скачков', () => {
  const prevTable = (over: Partial<RateTable> = {}): RateTable =>
    makeTable({ asOf: '2026-10-01', perUnit: { TJS: 1, USD: 10.9, EUR: 12.7, ARS: 0.01 }, ...over });

  it('один обвалившийся экзотический курс (ARS −75%) не должен навсегда замораживать USD/EUR', async () => {
    const storage = createMemoryRateStorage();
    // сохранённая таблица от 1 октября
    const seed = setup([stubProvider('nbt', () => prevTable())], { storage });
    expect((await seed.service.refresh()).ok).toBe(true);

    // каждый день все три источника отдают согласованные данные: ARS упал и остался низким, USD и EUR чуть растут
    let clock = NOW;
    const mk = (n: number, source: string): RateTable =>
      makeTable({ asOf: day(n), source, perUnit: { TJS: 1, USD: 10.95 + n * 0.01, EUR: 12.78 + n * 0.01, ARS: 0.0025 } });
    let today = 0;
    const providers = ['server', 'nbt', 'api'].map((id) => stubProvider(id, () => mk(today, id)));
    const service = createRateService({ providers, storage, now: () => clock });

    let accepted = 0;
    for (today = 0; today < 10; today++) {
      clock = new Date(Date.parse('2026-10-10T12:00:00Z') + today * 86_400_000);
      if ((await service.refresh()).ok) accepted++;
    }
    // ожидание: хотя бы со второго дня новые данные принимаются (курс ARS уже не «скачок» относительно вчерашнего дня)
    expect(accepted).toBeGreaterThan(0);
    expect(service.getRate('USD', 'TJS')?.rate).toBeCloseTo(10.95 + 9 * 0.01, 5);
  });

  it('крипто-коды в таблице currency-api не должны отклонять всю таблицу из-за скачка мелкой монеты', () => {
    const a = parseCurrencyApiJson({ date: '2026-10-09', usd: { tjs: 9.2, eur: 0.92, rub: 95.5, ape: 0.8 } }, 'usd', NOW);
    // фиат не изменился вообще; «ape» (мелкая криптомонета) подорожала на 87% за сутки — для мелких монет это обычное дело
    const b = parseCurrencyApiJson({ date: '2026-10-10', usd: { tjs: 9.2, eur: 0.92, rub: 95.5, ape: 0.43 } }, 'usd', NOW);
    expect(assessRateTable(b, a).ok).toBe(true);
  });

  it('сравнение с прежней таблицей не должно быть слепым к масштабу сомони, если прежняя таблица без TJS', async () => {
    const storage = createMemoryRateStorage();
    const day1 = makeTable({ asOf: '2026-10-09', perUnit: { TJS: 1, USD: 10.95, EUR: 12.78 } });
    // api без tjs: pivot USD
    const apiNoTjs = makeTable({ asOf: '2026-10-10', source: 'api', pivot: 'USD', perUnit: { USD: 1, EUR: 1.167 } });
    let step = 0;
    const nbtP = stubProvider('nbt', () => (step === 0 ? day1 : makeTable({ asOf: '2026-10-10', perUnit: { TJS: 1, USD: 109.5, EUR: 127.8 } })));
    const apiP = stubProvider('api', () => apiNoTjs);
    const svc = setup([nbtP], { storage }).service;
    expect((await svc.refresh()).ok).toBe(true); // nbt 09.10
    const svc2 = createRateService({ providers: [apiP], storage, now: () => NOW });
    expect((await svc2.refresh()).ok).toBe(true); // api без TJS 10.10 стал самой свежей таблицей
    step = 1;
    const svc3 = createRateService({ providers: [nbtP], storage, now: () => NOW });
    const r = await svc3.refresh(); // nbt: USD в 10 раз дороже, чем в таблице за 09.10 (с TJS)
    expect(r.ok).toBe(false);
  });
});

describe('общий запрос refresh', () => {
  it('отмена чужого вызова не должна отменять refresh, который сам отмену не просил', async () => {
    const slow = stubProvider(
      'nbt',
      (signal) =>
        new Promise<RateTable>((resolve, reject) => {
          const t = setTimeout(() => resolve(makeTable()), 50);
          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        }),
    );
    const { service } = setup([slow]);
    const ctrl = new AbortController();
    const p1 = service.refresh(ctrl.signal);
    const p2 = service.refresh(); // второй вызов делит запрос первого и отмены не просил
    ctrl.abort();
    expect((await p1).aborted).toBe(true);
    const r2 = await p2;
    expect(r2.aborted).toBe(false);
  });
});

describe('api-провайдер внутри сервиса: зеркала и общий лимит времени', () => {
  it('зависшее первое зеркало не должно лишать второе шанса (лимит времени сервиса общий на оба зеркала)', async () => {
    const good = JSON.stringify({ date: '2026-10-10', usd: { tjs: 9.2, eur: 0.92 } });
    const fetchImpl = routeFetch((url, init) => {
      if (url === API_MIRRORS[0]) {
        // соединение «подвисло»: ответа нет, пока запрос не отменят
        return new Promise<ResponseLike>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')));
        });
      }
      return okResponse(good, 'application/json');
    });
    const { service } = setup([apiProvider(fetchImpl, { now: () => NOW })], { fetchTimeoutMs: 100 });
    const r = await service.refresh();
    expect(fetchImpl.calls.map((c) => c.url)).toContain(API_MIRRORS[1]); // второе зеркало вообще не опрошено
    expect(r.ok).toBe(true);
  });
});
