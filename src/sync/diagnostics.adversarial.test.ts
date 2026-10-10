import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HEALTHY, checkViolation, U, ctxOf, fakeCloud, rows, type Reply, type Script, type SessionReply } from './__fixtures__/diagKit';
import { formatReport, overallStatus, runCloudCheck, type CheckStepId } from './diagnostics';

/**
 * Состязательные проверки runCloudCheck на поддельном клиенте: мусорные ответы, зависания, ложное «всё хорошо».
 */

const ORDER: CheckStepId[] = ['server', 'session', 'schema', 'read', 'write', 'rates', 'local'];
const TABLES = ['settings', 'wallets', 'categories', 'transactions', 'exchange_rates'] as const;
const BAD_WORDS = /undefined|\[object|NaN|null/;

// безопасные строки: чтобы «undefined» в сообщении означал дефект проверки, а не мусор из ответа
const safeText = fc.stringMatching(/^[a-z ]{0,30}$/);
const garbage: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  safeText,
  fc.array(fc.oneof(fc.constant(null), safeText, fc.record({ id: safeText, user_id: safeText, as_of: safeText }))),
  fc.record({ message: fc.oneof(safeText, fc.integer(), fc.constant(null)), code: fc.oneof(safeText, fc.integer(), fc.constant(null)) }),
);
const reply: fc.Arbitrary<Reply> = fc.oneof(
  { weight: 3, arbitrary: fc.constant(HEALTHY.settings as Reply) },
  { weight: 1, arbitrary: fc.constant('hang' as Reply) },
  { weight: 1, arbitrary: safeText.map((g) => ({ throws: new Error(g) }) as Reply) },
  {
    weight: 6,
    arbitrary: fc
      .record({
        data: garbage,
        error: fc.oneof(garbage, fc.constant(null)),
        status: fc.oneof(fc.constant(undefined), fc.constantFrom(0, 200, 201, 400, 401, 403, 404, 406, 409, 429, 500, 503), fc.integer()),
      })
      .map((r) => r as Reply),
  },
  { weight: 1, arbitrary: garbage.map((g) => g as Reply) },
);
const sessionReply: fc.Arbitrary<SessionReply> = fc.oneof(
  { weight: 4, arbitrary: fc.constant({ user: { id: U } } as SessionReply) },
  { weight: 1, arbitrary: fc.constant(null as SessionReply) },
  { weight: 1, arbitrary: fc.constant('hang' as SessionReply) },
  { weight: 1, arbitrary: fc.record({ user: fc.record({ id: garbage }) }) as fc.Arbitrary<SessionReply> },
  { weight: 1, arbitrary: fc.constant({ error: 'boom' } as SessionReply) },
);

describe('runCloudCheck: мусор от сервера', () => {
  it('на любые ответы возвращает 7 шагов в порядке, не бросает, не пишет в сообщениях undefined/[object]/NaN/null', async () => {
    await fc.assert(
      fc.asyncProperty(fc.record({ settings: reply, wallets: reply, categories: reply, transactions: reply, exchange_rates: reply }), reply, sessionReply, async (tables, insert, session) => {
        const { client } = fakeCloud({ tables, upsert: insert, session });
        const steps = await runCloudCheck(client, ctxOf(), { timeoutMs: 15, newId: () => 'probe' });
        expect(steps.map((s) => s.id)).toEqual(ORDER);
        for (const s of steps) {
          expect(typeof s.message).toBe('string');
          expect(s.message.trim()).not.toBe('');
          expect(s.message, `${s.id}: ${s.message}`).not.toMatch(BAD_WORDS);
        }
        const report = formatReport(steps, { host: 'abcdefgh.supabase.co' });
        expect(report).not.toMatch(BAD_WORDS);
      }),
      { numRuns: 400 },
    );
  }, 120_000);

  it('итог «ok» бывает ТОЛЬКО когда все чтения успешны (массив, без ошибки) и вставка отклонена кодом 23514', async () => {
    await fc.assert(
      fc.asyncProperty(fc.record({ settings: reply, wallets: reply, categories: reply, transactions: reply, exchange_rates: reply }), reply, async (tables, insert) => {
        const { client } = fakeCloud({ tables, upsert: insert });
        const steps = await runCloudCheck(client, ctxOf(), { timeoutMs: 15, newId: () => 'probe' });
        if (overallStatus(steps) !== 'ok') return;
        for (const t of TABLES) {
          const r = tables[t] as { error?: unknown; data?: unknown } | undefined;
          expect(r?.error ?? null, `${t} вернул ошибку, а итог ok`).toBeNull();
          expect(Array.isArray(r?.data), `${t}: data не массив, а итог ok`).toBe(true);
        }
        expect((insert as { error?: { code?: unknown } }).error?.code).toBe('23514');
      }),
      { numRuns: 600 },
    );
  }, 120_000);
});

describe('runCloudCheck: время и хвосты', () => {
  it('сервер молчит на всё: весь прогон укладывается в один-два лимита, вставка не отправляется, лишних вызовов нет', async () => {
    const hang: Script = { tables: { settings: 'hang', wallets: 'hang', categories: 'hang', transactions: 'hang', exchange_rates: 'hang' }, upsert: 'hang', session: 'hang' };
    const { client, calls } = fakeCloud(hang);
    const t0 = Date.now();
    const steps = await runCloudCheck(client, ctxOf(), { timeoutMs: 80 });
    expect(Date.now() - t0).toBeLessThan(800);
    expect(steps).toHaveLength(7);
    expect(calls.upserts).toHaveLength(0); // связи нет — писать вслепую нельзя
    expect(overallStatus(steps)).toBe('fail');
  });

  it('связь есть, а запись зависла: шаг «Запись» — ошибка (не «ok»), прогон завершается', async () => {
    const { client } = fakeCloud({ upsert: 'hang' });
    const steps = await runCloudCheck(client, ctxOf(), { timeoutMs: 60 });
    expect(steps.find((s) => s.id === 'write')?.status).toBe('fail');
    expect(steps).toHaveLength(7);
  });

  it('поздний отказ после таймаута не даёт необработанного исключения', async () => {
    const late = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('поздно')), 120));
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const { client } = fakeCloud({ tables: { settings: { later: late } as unknown as Reply }, upsert: { later: late } as unknown as Reply, session: { throws: new Error('x') } });
      await runCloudCheck(client, ctxOf(), { timeoutMs: 30 });
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it('обработчик onStep, который бросает, не ломает проверку и не меняет результат', async () => {
    const { client } = fakeCloud();
    const steps = await runCloudCheck(client, ctxOf(), {
      onStep: () => {
        throw new Error('слушатель сломался');
      },
    });
    expect(steps).toHaveLength(7);
    expect(overallStatus(steps)).toBe('ok');
  });
});

describe('runCloudCheck: клиент бросает не Error', () => {
  it('клиент бросает обычный объект {message}: в сообщении для человека не должно быть «[object Object]»', async () => {
    const { client } = fakeCloud();
    const broken: typeof client = {
      ...client,
      from: () => {
        throw { message: 'что-то сломалось', hint: 'x' };
      },
    };
    const steps = await runCloudCheck(broken, ctxOf(), { timeoutMs: 50 });
    for (const s of steps) expect(s.message, `${s.id}: ${s.message}`).not.toMatch(/\[object/);
  });
});

describe('runCloudCheck: пробная запись', () => {
  it('отправляет ровно по одной строке в каждую из четырёх таблиц, каждая заведомо неверна и уже «удалена»; user_id не присылает', async () => {
    const { client, calls } = fakeCloud();
    await runCloudCheck(client, ctxOf(), { newId: () => 'probe-1' });
    expect(calls.upserts.map((u) => u.table).sort()).toEqual(['categories', 'settings', 'transactions', 'wallets']);
    for (const ins of calls.upserts) {
      expect(ins.row['deleted_at'], ins.table).not.toBeNull();
      expect('user_id' in ins.row, ins.table).toBe(false);
    }
    expect(calls.upserts.find((u) => u.table === 'categories')!.row['name']).toBe('');
    expect(calls.upserts.find((u) => u.table === 'wallets')!.row['name']).toBe('');
    expect(calls.upserts.find((u) => u.table === 'transactions')!.row['amount_minor']).toBe(0);
  });

  it('если вставка прошла (ограничение пропало), проверка НЕ говорит «ok» и называет id созданной строки', async () => {
    const { client } = fakeCloud({ upsert: { data: null, error: null, status: 201 } });
    const steps = await runCloudCheck(client, ctxOf(), { newId: () => 'probe-xyz' });
    const w = steps.find((s) => s.id === 'write')!;
    expect(w.status).toBe('fail');
    expect(w.message).toContain('probe-xyz');
  });

  it('любая ошибка класса 23 кроме 23514 — не «ok»', async () => {
    for (const code of ['23502', '23503', '23505', '23000', '23P01']) {
      const { client } = fakeCloud({ upsert: { data: null, error: { code, message: 'x' }, status: 409 } });
      const w = (await runCloudCheck(client, ctxOf())).find((s) => s.id === 'write')!;
      expect(w.status, code).not.toBe('ok');
    }
  });

  it('23514 с НЕ тем ограничением (например, categories_ts_sane при неверных часах телефона) — проверка не имеет права утверждать, что защита от пустых имён работает', async () => {
    const other = { data: null, error: { code: '23514', message: 'new row for relation "categories" violates check constraint "categories_ts_sane"' }, status: 400 };
    const { client } = fakeCloud({ upsert: other });
    const w = (await runCloudCheck(client, ctxOf())).find((s) => s.id === 'write')!;
    expect(w.status === 'ok' && /защита данных работает/.test(w.message), w.message).toBe(false);
  });
});

describe('runCloudCheck: чужие данные', () => {
  it('чужие строки в любой из четырёх таблиц — ошибка, даже если свои тоже есть', async () => {
    for (const t of ['settings', 'wallets', 'categories', 'transactions']) {
      const { client } = fakeCloud({ tables: { [t]: rows([{ id: 'a', user_id: U }, { id: 'b', user_id: '22222222-2222-4222-8222-222222222222' }]) } });
      const steps = await runCloudCheck(client, ctxOf());
      expect(steps.find((s) => s.id === 'read')?.status, t).toBe('fail');
      expect(overallStatus(steps)).toBe('fail');
    }
  });

  it('контроль: здоровый ответ даёт ok и «нарушено правило пробной строки» по умолчанию', async () => {
    const { client } = fakeCloud({ upsert: checkViolation });
    expect(overallStatus(await runCloudCheck(client, ctxOf()))).toBe('ok');
  });
});
