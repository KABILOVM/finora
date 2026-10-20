import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_PAYOFF_PAYMENTS, payoffPlan, planEndFor } from './payoff';

describe('payoffPlan: когда закроется долг при платеже раз в месяц', () => {
  it('делится нацело: 1 000 по 250 → 4 платежа, последний 15 января', () => {
    expect(payoffPlan(100_000, 25_000, '2026-10-15')).toEqual({ ok: true, payoff: { payments: 4, lastOn: '2027-01-15', lastAmountMinor: 25_000 } });
  });

  it('не делится: 1 000 по 300 → 4 платежа, последний на 100', () => {
    const r = payoffPlan(100_000, 30_000, '2026-10-15');
    expect(r).toEqual({ ok: true, payoff: { payments: 4, lastOn: '2027-01-15', lastAmountMinor: 10_000 } });
  });

  it('платёж не меньше остатка — один платёж, в день первого', () => {
    expect(payoffPlan(5_000, 5_000, '2026-10-15')).toEqual({ ok: true, payoff: { payments: 1, lastOn: '2026-10-15', lastAmountMinor: 5_000 } });
    expect(payoffPlan(5_000, 90_000, '2026-10-15')).toEqual({ ok: true, payoff: { payments: 1, lastOn: '2026-10-15', lastAmountMinor: 5_000 } });
  });

  it('31-е число в коротком месяце — последний день месяца; от якоря, без накопления сдвига', () => {
    const r = payoffPlan(100_000, 25_000, '2026-10-31');
    expect(r).toEqual({ ok: true, payoff: { payments: 4, lastOn: '2027-01-31', lastAmountMinor: 25_000 } });
    const feb = payoffPlan(100_000, 20_000, '2026-12-31'); // 5 платежей: дек, янв, фев (28), мар, апр
    expect(feb).toEqual({ ok: true, payoff: { payments: 5, lastOn: '2027-04-30', lastAmountMinor: 20_000 } });
  });

  it('копейка остатка — отдельный платёж', () => {
    expect(payoffPlan(100_001, 25_000, '2026-10-15')).toEqual({ ok: true, payoff: { payments: 5, lastOn: '2027-02-15', lastAmountMinor: 1 } });
  });

  it('нечего платить, плохая сумма, слишком долго, плохая дата', () => {
    expect(payoffPlan(0, 100, '2026-10-15')).toEqual({ ok: false, reason: 'nothing-left' });
    expect(payoffPlan(100, 0, '2026-10-15')).toEqual({ ok: false, reason: 'bad-amount' });
    expect(payoffPlan(100, -5, '2026-10-15')).toEqual({ ok: false, reason: 'bad-amount' });
    expect(payoffPlan(100, 1.5, '2026-10-15')).toEqual({ ok: false, reason: 'bad-amount' });
    expect(payoffPlan(100 * (MAX_PAYOFF_PAYMENTS + 1), 100, '2026-10-15')).toEqual({ ok: false, reason: 'too-long' });
    expect(payoffPlan(100, 10, 'не дата')).toEqual({ ok: false, reason: 'bad-date' });
  });

  it('ровно MAX платежей — можно (последний через 599 месяцев), на один больше — «too-long»', () => {
    expect(payoffPlan(100 * MAX_PAYOFF_PAYMENTS, 100, '2026-10-15')).toEqual({ ok: true, payoff: { payments: MAX_PAYOFF_PAYMENTS, lastOn: '2076-09-15', lastAmountMinor: 100 } });
    expect(payoffPlan(100 * MAX_PAYOFF_PAYMENTS + 1, 100, '2026-10-15')).toEqual({ ok: false, reason: 'too-long' });
  });

  it('первый платёж ближе к 2100 году, чем нужно месяцев: «too-long», а не обрезанная дата', () => {
    expect(payoffPlan(1_000_000, 100, '2099-12-15')).toEqual({ ok: false, reason: 'too-long' });
  });

  it('огромные суммы не ломают потолок деления', () => {
    expect(payoffPlan(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, '2026-10-15')).toEqual({
      ok: true,
      payoff: { payments: 1, lastOn: '2026-10-15', lastAmountMinor: Number.MAX_SAFE_INTEGER },
    });
    const r = payoffPlan(Number.MAX_SAFE_INTEGER, 2, '2026-10-15');
    expect(r).toEqual({ ok: false, reason: 'too-long' });
  });

  it('свойство: платежи × сумма покрывают остаток, а без последнего — нет; последний ≤ обычной суммы и > 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000 }), fc.integer({ min: 1, max: 1_000_000 }), (remaining, per) => {
        const r = payoffPlan(remaining, per, '2026-10-15');
        if (!r.ok) {
          expect(r.reason).toBe('too-long');
          expect(Math.ceil(remaining / per)).toBeGreaterThan(MAX_PAYOFF_PAYMENTS);
          return;
        }
        const { payments, lastAmountMinor, lastOn } = r.payoff;
        expect(payments * per).toBeGreaterThanOrEqual(remaining);
        expect((payments - 1) * per).toBeLessThan(remaining);
        expect(lastAmountMinor).toBeGreaterThan(0);
        expect(lastAmountMinor).toBeLessThanOrEqual(per);
        expect((payments - 1) * per + lastAmountMinor).toBe(remaining);
        expect(lastOn >= '2026-10-15').toBe(true);
      }),
    );
  });
});

describe('planEndFor: когда закончится план, если долг вырос', () => {
  const rule = { frequency: 'monthly', intervalN: 1, startOn: '2026-11-15', amountMinor: 10_000 } as const;

  it('последний платёж — по датам самого правила: остаток 25 000 при 10 000 в месяц — три платежа', () => {
    expect(planEndFor(rule, 25_000, '2026-11-01')).toBe('2027-01-15');
    expect(planEndFor(rule, 30_000, '2026-11-01')).toBe('2027-01-15'); // ровно делится
    expect(planEndFor(rule, 30_001, '2026-11-01')).toBe('2027-02-15');
  });
  it('считает с даты from: прошедшие платежи не входят', () => {
    expect(planEndFor(rule, 20_000, '2026-12-16')).toBe('2027-02-15'); // 15 декабря уже было, дальше 15 янв и 15 фев
  });
  it('день 31: в коротком месяце — последний день месяца, дальше снова 31-е', () => {
    expect(planEndFor({ ...rule, startOn: '2026-10-31' }, 30_000, '2026-10-01')).toBe('2026-12-31');
  });
  it('платёж на сегодня уже проведён и считаем со следующего дня: остаток 300 при 100 в месяц — три платежа (15.11, 15.12, 15.01)', () => {
    expect(planEndFor({ ...rule, startOn: '2026-10-15', amountMinor: 10_000 }, 30_000, '2026-10-16')).toBe('2027-01-15');
  });
  it('ежедневный и еженедельный план: горизонт ограничен числом платежей, дата верная', () => {
    expect(planEndFor({ frequency: 'daily', intervalN: 1, startOn: '2026-10-01', amountMinor: 100 }, 1_000, '2026-10-16')).toBe('2026-10-25');
    expect(planEndFor({ frequency: 'weekly', intervalN: 2, startOn: '2026-10-01', amountMinor: 100 }, 300, '2026-10-16')).toBe('2026-11-26'); // 29 окт, 12 ноя, 26 ноя
  });
  it('нет остатка, нулевой платёж, платежей больше предела — null', () => {
    expect(planEndFor(rule, 0, '2026-11-01')).toBeNull();
    expect(planEndFor({ ...rule, amountMinor: 0 }, 1_000, '2026-11-01')).toBeNull();
    expect(planEndFor({ ...rule, amountMinor: 1 }, 10_000_000, '2026-11-01')).toBeNull();
  });
});
