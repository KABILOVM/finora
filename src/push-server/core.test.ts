// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { computeDebtState, debtPlanStop, type DebtTx } from '../domain/debts';
import {
  DEBT_OVERDUE_DAYS,
  MAX_PAYMENT_CANDIDATES,
  daysFromTo,
  debtDueKind,
  debtRemainingMinor,
  inSendWindow,
  localMoment,
  paymentCandidates,
  paymentRef,
  shiftIso,
  stoppedPlanIds,
  type DebtLite,
  type DebtTxLite,
  type PlanDebtLite,
  type RuleLite,
} from '../../supabase/functions/send-reminders/index';

const at = (iso: string) => new Date(iso);
const RULE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rule = (o: Partial<RuleLite> = {}): RuleLite => ({ id: RULE, note: 'Аренда', frequency: 'monthly', intervalN: 1, startOn: '2026-01-15', endOn: null, ...o });

describe('локальные дата и час по часовому поясу', () => {
  it('Душанбе (UTC+5, без перехода на летнее время): граница суток', () => {
    expect(localMoment(at('2026-10-10T04:05:00Z'), 'Asia/Dushanbe')).toEqual({ date: '2026-10-10', hour: 9 });
    expect(localMoment(at('2026-10-10T18:59:59Z'), 'Asia/Dushanbe')).toEqual({ date: '2026-10-10', hour: 23 });
    expect(localMoment(at('2026-10-10T19:00:00Z'), 'Asia/Dushanbe')).toEqual({ date: '2026-10-11', hour: 0 });
    expect(localMoment(at('2026-12-31T20:00:00Z'), 'Asia/Dushanbe')).toEqual({ date: '2027-01-01', hour: 1 });
  });

  it('одна и та же минута UTC — разные локальные даты в разных зонах', () => {
    const t = at('2026-10-10T20:30:00Z');
    expect(localMoment(t, 'Asia/Dushanbe')).toEqual({ date: '2026-10-11', hour: 1 });
    expect(localMoment(t, 'America/New_York')).toEqual({ date: '2026-10-10', hour: 16 });
    expect(localMoment(t, 'Asia/Tokyo')).toEqual({ date: '2026-10-11', hour: 5 });
    expect(localMoment(t, 'Pacific/Kiritimati')).toEqual({ date: '2026-10-11', hour: 10 }); // UTC+14
    expect(localMoment(t, 'Pacific/Pago_Pago')).toEqual({ date: '2026-10-10', hour: 9 }); // UTC-11
    expect(localMoment(t, 'UTC')).toEqual({ date: '2026-10-10', hour: 20 });
  });

  it('Токио (UTC+9): полночь — час 0, а не 24', () => {
    expect(localMoment(at('2026-10-10T15:00:00Z'), 'Asia/Tokyo')).toEqual({ date: '2026-10-11', hour: 0 });
    expect(localMoment(at('2026-10-10T00:00:00Z'), 'UTC')).toEqual({ date: '2026-10-10', hour: 0 });
  });

  it('Катманду (UTC+5:45): дробное смещение, час считается по настоящему местному времени', () => {
    expect(localMoment(at('2026-10-10T03:15:00Z'), 'Asia/Kathmandu')).toEqual({ date: '2026-10-10', hour: 9 });
    expect(localMoment(at('2026-10-10T03:14:59Z'), 'Asia/Kathmandu')).toEqual({ date: '2026-10-10', hour: 8 });
    expect(localMoment(at('2026-10-10T18:15:00Z'), 'Asia/Kathmandu')).toEqual({ date: '2026-10-11', hour: 0 });
    expect(localMoment(at('2026-10-10T18:14:59Z'), 'Asia/Kathmandu')).toEqual({ date: '2026-10-10', hour: 23 });
  });

  it('Нью-Йорк: весной час 2:00 пропадает, осенью час 1:00 повторяется', () => {
    // 8 марта 2026: в 02:00 EST часы переводят на 03:00 EDT (07:00 UTC)
    expect(localMoment(at('2026-03-08T06:59:00Z'), 'America/New_York')).toEqual({ date: '2026-03-08', hour: 1 });
    expect(localMoment(at('2026-03-08T07:00:00Z'), 'America/New_York')).toEqual({ date: '2026-03-08', hour: 3 });
    // 1 ноября 2026: в 02:00 EDT часы переводят на 01:00 EST (06:00 UTC), час 1 бывает дважды
    expect(localMoment(at('2026-11-01T05:30:00Z'), 'America/New_York')).toEqual({ date: '2026-11-01', hour: 1 });
    expect(localMoment(at('2026-11-01T06:30:00Z'), 'America/New_York')).toEqual({ date: '2026-11-01', hour: 1 });
    expect(localMoment(at('2026-11-01T07:00:00Z'), 'America/New_York')).toEqual({ date: '2026-11-01', hour: 2 });
  });

  it('високосный день и конец года', () => {
    expect(localMoment(at('2028-02-29T12:00:00Z'), 'Asia/Dushanbe')).toEqual({ date: '2028-02-29', hour: 17 });
    expect(localMoment(at('2028-02-28T19:00:00Z'), 'Asia/Dushanbe')).toEqual({ date: '2028-02-29', hour: 0 });
    expect(localMoment(at('2027-02-28T19:00:00Z'), 'Asia/Dushanbe')).toEqual({ date: '2027-03-01', hour: 0 });
  });

  it('неверная зона, не строка, слишком длинная или неверный момент — null, без исключения', () => {
    for (const tz of ['Mars/Phobos', '', ' ', 'Asia/Dushanbe ', 'x'.repeat(65), 'Asia/Душанбе', null, undefined, 5, {}, ['UTC']]) {
      expect(localMoment(at('2026-10-10T12:00:00Z'), tz), String(tz)).toBeNull();
    }
    expect(localMoment(new Date('мусор'), 'UTC')).toBeNull();
  });

  it('регистр названия зоны не важен (Intl его принимает), а пустое значение по умолчанию не подставляется', () => {
    expect(localMoment(at('2026-10-10T04:05:00Z'), 'asia/dushanbe')).toEqual({ date: '2026-10-10', hour: 9 });
    expect(localMoment(at('2026-10-10T04:05:00Z'), undefined)).toBeNull();
  });
});

describe('окно отправки: час ≤ локальный час < час + 6, без перехода через полночь', () => {
  it('граничные часы', () => {
    for (let h = 0; h < 24; h++) expect(inSendWindow(9, h), `9/${h}`).toBe(h >= 9 && h <= 14);
    for (let h = 0; h < 24; h++) expect(inSendWindow(0, h), `0/${h}`).toBe(h <= 5);
    for (let h = 0; h < 24; h++) expect(inSendWindow(23, h), `23/${h}`).toBe(h === 23);
    for (let h = 0; h < 24; h++) expect(inSendWindow(22, h), `22/${h}`).toBe(h === 22 || h === 23);
    expect(inSendWindow(20, 0)).toBe(false); // окно не переходит на следующие сутки
  });

  it('мусор на входе — нет', () => {
    for (const [a, b] of [[24, 24], [-1, 0], [9.5, 10], [9, 9.5], [NaN, 9], [9, NaN], [9, 24], [9, -1]] as const) expect(inSendWindow(a, b)).toBe(false);
  });

  it('пропущенный запуск cron не теряет напоминание: опоздание до 5 часов в окне', () => {
    // Душанбе, hour_local = 9: cron мог не сработать в 09:xx, но сработал в 13:05 по местному
    const at1305 = localMoment(at('2026-10-10T08:05:00Z'), 'Asia/Dushanbe')!;
    expect(at1305.hour).toBe(13);
    expect(inSendWindow(9, at1305.hour)).toBe(true);
    const at1505 = localMoment(at('2026-10-10T10:05:00Z'), 'Asia/Dushanbe')!;
    expect(inSendWindow(9, at1505.hour)).toBe(false);
  });

  it('Нью-Йорк, час 2 в день перевода часов: 2:00 нет, но окно 2…7 покрывает 03:00', () => {
    const m = localMoment(at('2026-03-08T07:05:00Z'), 'America/New_York')!;
    expect(m).toEqual({ date: '2026-03-08', hour: 3 });
    expect(inSendWindow(2, m.hour)).toBe(true);
  });
});

describe('даты', () => {
  it('shiftIso / daysFromTo: месяцы, високосный год', () => {
    expect(shiftIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftIso('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftIso('2026-10-10', -7)).toBe('2026-10-03');
    expect(daysFromTo('2026-10-10', '2026-10-11')).toBe(1);
    expect(daysFromTo('2026-10-10', '2026-09-10')).toBe(-30);
    expect(daysFromTo('2028-02-28', '2028-03-01')).toBe(2);
  });
});

describe('платежи по расписанию: что подошло', () => {
  it('ежемесячный платёж сегодня', () => {
    expect(paymentCandidates([rule()], '2026-10-15')).toEqual([{ ruleId: RULE, date: '2026-10-15', note: 'Аренда', overdue: false }]);
    expect(paymentCandidates([rule()], '2026-10-14')).toEqual([]);
  });

  it('просроченные за последние 7 суток включительно: ровно 7 — да, 8 — нет', () => {
    const r = rule({ startOn: '2026-10-01' });
    expect(paymentCandidates([r], '2026-10-08').map((c) => c.date)).toEqual(['2026-10-01']); // 7 суток назад
    expect(paymentCandidates([r], '2026-10-09')).toEqual([]); // 8 суток назад
    const both = paymentCandidates([r], '2026-10-04');
    expect(both).toEqual([{ ruleId: RULE, date: '2026-10-01', note: 'Аренда', overdue: true }]);
  });

  it('конец месяца: 31-е число в коротких месяцах срабатывает в последний день месяца', () => {
    const r = rule({ startOn: '2026-01-31' });
    expect(paymentCandidates([r], '2026-02-28').map((c) => c.date)).toEqual(['2026-02-28']);
    expect(paymentCandidates([r], '2026-04-30').map((c) => c.date)).toEqual(['2026-04-30']);
    expect(paymentCandidates([r], '2026-03-31').map((c) => c.date)).toEqual(['2026-03-31']);
    // 30 апреля уже прошло, а сегодня 3 мая: платёж «просрочен», а 31-го числа мая ещё нет
    expect(paymentCandidates([r], '2026-05-03')).toEqual([{ ruleId: RULE, date: '2026-04-30', note: 'Аренда', overdue: true }]);
  });

  it('29, 30, 31 числа и високосный год', () => {
    expect(paymentCandidates([rule({ startOn: '2026-01-29' })], '2026-02-28').map((c) => c.date)).toEqual(['2026-02-28']);
    expect(paymentCandidates([rule({ startOn: '2028-01-29' })], '2028-02-29').map((c) => c.date)).toEqual(['2028-02-29']);
    expect(paymentCandidates([rule({ startOn: '2028-01-30' })], '2028-02-29').map((c) => c.date)).toEqual(['2028-02-29']);
    expect(paymentCandidates([rule({ startOn: '2028-01-31' })], '2028-02-29').map((c) => c.date)).toEqual(['2028-02-29']);
    // ежегодный платёж 29 февраля: в обычный год — 28 февраля
    const yearly = rule({ frequency: 'yearly', startOn: '2024-02-29' });
    expect(paymentCandidates([yearly], '2027-02-28').map((c) => c.date)).toEqual(['2027-02-28']);
    expect(paymentCandidates([yearly], '2028-02-29').map((c) => c.date)).toEqual(['2028-02-29']);
    expect(paymentCandidates([yearly], '2027-03-01').map((c) => c.date)).toEqual(['2027-02-28']); // вчера, просрочен
  });

  it('через границу года', () => {
    const r = rule({ startOn: '2026-12-31' });
    expect(paymentCandidates([r], '2027-01-03')).toEqual([{ ruleId: RULE, date: '2026-12-31', note: 'Аренда', overdue: true }]);
  });

  it('ежедневное правило даёт 8 дат (7 просроченных + сегодня), раньше начала и после конца — нет', () => {
    const daily = rule({ frequency: 'daily', startOn: '2026-01-01' });
    const c = paymentCandidates([daily], '2026-10-10');
    expect(c).toHaveLength(8);
    expect(c.filter((x) => x.overdue)).toHaveLength(7);
    expect(c.at(-1)).toMatchObject({ date: '2026-10-10', overdue: false });
    expect(paymentCandidates([rule({ frequency: 'daily', startOn: '2026-10-09' })], '2026-10-10').map((x) => x.date)).toEqual(['2026-10-09', '2026-10-10']);
    expect(paymentCandidates([rule({ frequency: 'daily', endOn: '2026-10-08', startOn: '2026-01-01' })], '2026-10-10').map((x) => x.date)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
    expect(paymentCandidates([rule({ startOn: '2026-11-15' })], '2026-10-15')).toEqual([]);
  });

  it('несколько правил: порядок по дате, потом по id; id приводится к строчным буквам; сломанное правило пропускается', () => {
    const a = rule({ id: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB', note: 'Б', startOn: '2026-10-10' });
    const b = rule({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', note: 'А', startOn: '2026-10-10' });
    const old = rule({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', note: 'Раньше', startOn: '2026-10-08' });
    const broken = rule({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', intervalN: 0 });
    const got = paymentCandidates([a, b, old, broken], '2026-10-10').map((c) => `${c.date} ${c.ruleId.slice(0, 2)}`);
    // «Раньше» ежемесячное с 8 числа: 8 октября (просрочено), затем две записи за 10 октября
    expect(got).toEqual(['2026-10-08 cc', '2026-10-10 aa', '2026-10-10 bb']);
  });

  it('не больше MAX_PAYMENT_CANDIDATES: остаются самые свежие', () => {
    const many = Array.from({ length: 200 }, (_, i) => rule({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, frequency: 'daily', startOn: '2026-01-01' }));
    const c = paymentCandidates(many, '2026-10-10');
    expect(c).toHaveLength(MAX_PAYMENT_CANDIDATES);
    expect(c.at(-1)!.date).toBe('2026-10-10');
    expect(c.filter((x) => x.date === '2026-10-10')).toHaveLength(200);
  });

  it('неверная «сегодняшняя» дата — пусто', () => {
    for (const t of ['', '2026-13-01', '2026-02-30', 'вчера', '1999-12-31', '2100-01-02']) expect(paymentCandidates([rule()], t), t).toEqual([]);
  });

  it('ссылка журнала: правило:дата, строчными буквами', () => {
    expect(paymentRef('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', '2026-10-10')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:2026-10-10');
  });
});

describe('долги: срок и остаток', () => {
  it('срок: сегодня, завтра, просрочен до 30 суток; раньше и позже — нет', () => {
    const t = '2026-10-10';
    expect(debtDueKind('2026-10-10', t)).toBe('today');
    expect(debtDueKind('2026-10-11', t)).toBe('tomorrow');
    expect(debtDueKind('2026-10-12', t)).toBeNull();
    expect(debtDueKind('2026-10-09', t)).toBe('overdue');
    expect(debtDueKind(shiftIso(t, -DEBT_OVERDUE_DAYS), t)).toBe('overdue');
    expect(debtDueKind(shiftIso(t, -DEBT_OVERDUE_DAYS - 1), t)).toBeNull();
    for (const bad of [null, undefined, '', '2026-02-30', 5, 'завтра']) expect(debtDueKind(bad, t)).toBeNull();
  });

  it('«завтра» через конец месяца и в високосный год', () => {
    expect(debtDueKind('2026-03-01', '2026-02-28')).toBe('tomorrow');
    expect(debtDueKind('2028-02-29', '2028-02-28')).toBe('tomorrow');
    expect(debtDueKind('2028-03-01', '2028-02-29')).toBe('tomorrow');
    expect(debtDueKind('2027-01-01', '2026-12-31')).toBe('tomorrow');
  });

  const debt = (o: Partial<DebtLite> = {}): DebtLite => ({ id: 'd1', direction: 'lent', counterparty: 'Рустам', principalMinor: 100_000, currency: 'TJS', dueOn: '2026-10-10', ...o });
  const tx = (o: Partial<DebtTxLite> = {}): DebtTxLite => ({ debtId: 'd1', kind: 'income', walletId: 'w-tjs', amountMinor: 30_000, ...o });
  const wallets = new Map([
    ['w-tjs', 'TJS'],
    ['w-usd', 'USD'],
  ]);

  it('остаток = долг − платежи (мне должны: платёж — доход)', () => {
    expect(debtRemainingMinor(debt(), [], wallets)).toBe(100_000n);
    expect(debtRemainingMinor(debt(), [tx(), tx({ amountMinor: 20_000 })], wallets)).toBe(50_000n);
  });

  it('я должен: платёж — расход; доход по такому долгу — это получение, а не платёж', () => {
    const d = debt({ direction: 'borrowed' });
    expect(debtRemainingMinor(d, [tx({ kind: 'expense', amountMinor: 40_000 })], wallets)).toBe(60_000n);
    expect(debtRemainingMinor(d, [tx({ kind: 'income', amountMinor: 40_000 })], wallets)).toBe(100_000n);
    expect(debtRemainingMinor(debt(), [tx({ kind: 'expense' })], wallets)).toBe(100_000n); // выдача долга
  });

  it('проценты по долгу входят в остаток (как в приложении): сумма + проценты − платежи', () => {
    const credit = debt({ direction: 'borrowed', principalMinor: 100_000, interestMinor: 13_000 });
    expect(debtRemainingMinor(credit, [], wallets)).toBe(113_000n);
    expect(debtRemainingMinor(credit, [tx({ kind: 'expense', amountMinor: 100_000 })], wallets)).toBe(13_000n); // вернули только сумму — проценты остались
    expect(debtRemainingMinor(credit, [tx({ kind: 'expense', amountMinor: 113_000 })], wallets)).toBe(0n);
    expect(debtRemainingMinor(credit, [tx({ kind: 'expense', amountMinor: 120_000 })], wallets)).toBe(0n);
    // нет процентов, ноль или мусор вместо числа — считаем как «процентов нет»
    for (const interestMinor of [undefined, 0, -5, 1.5, Number.NaN]) {
      expect(debtRemainingMinor(debt({ interestMinor }), [], wallets), String(interestMinor)).toBe(100_000n);
    }
  });

  it('переплата и ровное погашение: остаток 0, не отрицательный', () => {
    expect(debtRemainingMinor(debt(), [tx({ amountMinor: 100_000 })], wallets)).toBe(0n);
    expect(debtRemainingMinor(debt(), [tx({ amountMinor: 150_000 })], wallets)).toBe(0n);
    expect(debtRemainingMinor(debt(), [tx({ amountMinor: 99_999 })], wallets)).toBe(1n);
  });

  it('операция в другой валюте или в неизвестном кошельке в остаток не входит', () => {
    expect(debtRemainingMinor(debt(), [tx({ walletId: 'w-usd', amountMinor: 100_000 })], wallets)).toBe(100_000n);
    expect(debtRemainingMinor(debt(), [tx({ walletId: 'нет такого', amountMinor: 100_000 })], wallets)).toBe(100_000n);
    expect(debtRemainingMinor(debt({ currency: 'USD' }), [tx({ walletId: 'w-usd', amountMinor: 100_000 })], wallets)).toBe(0n);
  });

  it('чужие операции, переводы, нулевые и дробные суммы игнорируются', () => {
    expect(debtRemainingMinor(debt(), [tx({ debtId: 'd2' }), tx({ kind: 'transfer' }), tx({ amountMinor: 0 }), tx({ amountMinor: -5 }), tx({ amountMinor: 1.5 })], wallets)).toBe(100_000n);
  });

  it('огромные суммы считаются точно (за пределом безопасного целого в сумме)', () => {
    const big = 1_000_000_000_000_000; // предел базы, 1e15
    const d = debt({ principalMinor: big });
    const many = Array.from({ length: 20 }, () => tx({ amountMinor: big - 1 }));
    expect(debtRemainingMinor(d, many, wallets)).toBe(0n);
    expect(debtRemainingMinor(d, [tx({ amountMinor: big - 1 })], wallets)).toBe(1n);
  });

  it('сломанная исходная сумма — остаток 0 (напоминать нечего)', () => {
    for (const p of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 2]) expect(debtRemainingMinor(debt({ principalMinor: p }), [], wallets), String(p)).toBe(0n);
  });
});

describe('план платежей по долгу: когда стоит (stoppedPlanIds — как debtPlanStop в приложении)', () => {
  const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const TS = '2026-10-01T10:00:00+00:00';
  const plan = (o: Partial<RuleLite> = {}): RuleLite => rule({ kind: 'income', debtId: D, ...o });
  const pdebt = (o: Partial<PlanDebtLite> = {}): PlanDebtLite => ({ id: D, direction: 'lent', principalMinor: 100_000, currency: 'TJS', deletedAt: null, archivedAt: null, closedAt: null, ...o });
  const pay = (o: Partial<DebtTxLite> = {}): DebtTxLite => ({ debtId: D, kind: 'income', walletId: 'w-tjs', amountMinor: 30_000, ...o });
  const wallets = new Map([
    ['w-tjs', 'TJS'],
    ['w-usd', 'USD'],
  ]);
  const stopped = (r: RuleLite, d: PlanDebtLite | null, txs: DebtTxLite[] = []): boolean => stoppedPlanIds([r], d === null ? [] : [d], txs, wallets).has(r.id);

  it('открытый долг с остатком — план идёт; погашен ровно или с переплатой — стоит', () => {
    expect(stopped(plan(), pdebt())).toBe(false);
    expect(stopped(plan(), pdebt(), [pay(), pay({ amountMinor: 69_999 })])).toBe(false); // остаток 1
    expect(stopped(plan(), pdebt(), [pay(), pay({ amountMinor: 70_000 })])).toBe(true);
    expect(stopped(plan(), pdebt(), [pay({ amountMinor: 150_000 })])).toBe(true);
  });

  it('долг в архиве или закрыт — план стоит, даже если остаток есть', () => {
    expect(stopped(plan(), pdebt({ archivedAt: TS }))).toBe(true);
    expect(stopped(plan(), pdebt({ closedAt: TS }))).toBe(true);
  });

  it('долг удалён или его нет — стоит любое правило с его id, и выдача по расписанию тоже', () => {
    expect(stopped(plan(), pdebt({ deletedAt: TS }))).toBe(true);
    expect(stopped(plan(), null)).toBe(true);
    expect(stopped(plan({ kind: 'expense' }), pdebt({ deletedAt: TS }))).toBe(true);
    expect(stopped(plan({ kind: 'expense' }), null)).toBe(true);
  });

  it('выдача по расписанию (вид не «возврат») не останавливается архивом, закрытием и погашением', () => {
    const issue = plan({ kind: 'expense' }); // мне должны: выдача — расход
    expect(stopped(issue, pdebt({ closedAt: TS }))).toBe(false);
    expect(stopped(issue, pdebt({ archivedAt: TS }))).toBe(false);
    expect(stopped(issue, pdebt(), [pay({ amountMinor: 100_000 })])).toBe(false);
  });

  it('я должен: план — расход, гасят его расходы; доход по такому долгу — получение, а не платёж', () => {
    const d = pdebt({ direction: 'borrowed' });
    const mine = plan({ kind: 'expense' });
    expect(stopped(mine, d, [pay({ kind: 'income', amountMinor: 100_000 })])).toBe(false);
    expect(stopped(mine, d, [pay({ kind: 'expense', amountMinor: 100_000 })])).toBe(true);
    expect(stopped(mine, pdebt({ direction: 'borrowed', closedAt: TS }))).toBe(true);
    expect(stopped(plan({ kind: 'income' }), pdebt({ direction: 'borrowed', closedAt: TS }))).toBe(false); // получение по расписанию
  });

  it('платёж в другой валюте, в неизвестном кошельке или другого долга долг не гасит', () => {
    expect(stopped(plan(), pdebt(), [pay({ walletId: 'w-usd', amountMinor: 100_000 })])).toBe(false);
    expect(stopped(plan(), pdebt(), [pay({ walletId: 'нет такого', amountMinor: 100_000 })])).toBe(false);
    expect(stopped(plan(), pdebt(), [pay({ debtId: 'другой', amountMinor: 100_000 })])).toBe(false);
    expect(stopped(plan(), pdebt({ currency: 'USD' }), [pay({ walletId: 'w-usd', amountMinor: 100_000 })])).toBe(true);
  });

  it('правило без долга или неизвестного вида не трогается; у каждого правила — свой долг', () => {
    expect(stopped(rule(), null)).toBe(false);
    expect(stopped(plan({ debtId: null }), null)).toBe(false);
    expect(stopped(plan({ kind: null }), null)).toBe(false);
    expect(stopped(plan({ kind: undefined, debtId: undefined }), null)).toBe(false);
    const D2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const a = plan({ id: '00000000-0000-4000-8000-00000000000a' });
    const b = plan({ id: '00000000-0000-4000-8000-00000000000b', debtId: D2 });
    const c = rule({ id: '00000000-0000-4000-8000-00000000000c' });
    expect([...stoppedPlanIds([a, b, c], [pdebt(), pdebt({ id: D2, closedAt: TS })], [], wallets)]).toEqual([b.id]);
  });

  it('совпадает с debtPlanStop + computeDebtState приложения на сетке случаев', () => {
    const payments: Array<Array<Pick<DebtTxLite, 'kind' | 'walletId' | 'amountMinor'>>> = [
      [],
      [{ kind: 'income', walletId: 'w-tjs', amountMinor: 40_000 }],
      [{ kind: 'income', walletId: 'w-tjs', amountMinor: 100_000 }],
      [{ kind: 'expense', walletId: 'w-tjs', amountMinor: 100_000 }],
      [{ kind: 'income', walletId: 'w-tjs', amountMinor: 60_000 }, { kind: 'income', walletId: 'w-tjs', amountMinor: 50_000 }],
      [{ kind: 'income', walletId: 'w-usd', amountMinor: 100_000 }],
      [{ kind: 'expense', walletId: 'w-usd', amountMinor: 100_000 }],
    ];
    const marks: Array<Partial<PlanDebtLite> | null> = [null, {}, { deletedAt: TS }, { archivedAt: TS }, { closedAt: TS }, { archivedAt: TS, closedAt: TS }];
    let stops = 0;
    let runs = 0;
    for (const direction of ['lent', 'borrowed'] as const) {
      for (const kind of ['income', 'expense'] as const) {
        for (const mark of marks) {
          for (const list of payments) {
            const d = mark === null ? null : pdebt({ direction, ...mark });
            const txs = list.map((t) => pay(t));
            const appTxs: DebtTx[] = txs.map((t, i) => ({ id: `t${i}`, kind: t.kind as DebtTx['kind'], walletId: t.walletId, amountMinor: t.amountMinor, occurredOn: '2026-10-01', createdAt: TS, deletedAt: null, debtId: t.debtId }));
            const app =
              debtPlanStop({ kind, debtId: D }, d === null ? undefined : d, d === null ? null : computeDebtState(d, appTxs, [{ id: 'w-tjs', currency: 'TJS' }, { id: 'w-usd', currency: 'USD' }])) !== null;
            const edge = stopped(plan({ kind }), d, txs);
            expect(edge, JSON.stringify({ direction, kind, mark, list })).toBe(app);
            if (edge) stops++;
            else runs++;
          }
        }
      }
    }
    expect(stops).toBeGreaterThan(20);
    expect(runs).toBeGreaterThan(20);
  });
});
