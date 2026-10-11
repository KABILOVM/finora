// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { inSendWindow, localMoment, runScheduled, type RunCtx } from '../../supabase/functions/send-reminders/index';
import { FakeStore, fakeSender, settings, sub, USER_A } from './testkit';

/* ---------------------------------------------------------------------------------------------
 * Нападение на часовые пояса: все зоны мира, переходы на летнее время (в обе стороны), дробные смещения.
 * Образец для сверки — НЕЗАВИСИМЫЙ расчёт (смещение от longOffset + арифметика по UTC), а не тот же Intl-путь, что у функции.
 * ------------------------------------------------------------------------------------------- */

const ZONES = Intl.supportedValuesOf('timeZone');
const MIN = 60_000;

const offsetFormats = new Map<string, Intl.DateTimeFormat>();
function offsetMinutes(zone: string, at: Date): number {
  let f = offsetFormats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    offsetFormats.set(zone, f);
  }
  const name = f.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function oracle(zone: string, at: Date): { date: string; hour: number } {
  const local = new Date(at.getTime() + offsetMinutes(zone, at) * MIN);
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

/** Моменты, где в зоне меняется смещение, в 2026 году (суточный просмотр + деление пополам до минуты). */
function transitions(zone: string): Date[] {
  const out: Date[] = [];
  let prev = offsetMinutes(zone, new Date('2026-01-01T00:00:00Z'));
  for (let d = 1; d <= 366; d++) {
    const t = new Date(Date.UTC(2026, 0, 1) + d * 86_400_000);
    const cur = offsetMinutes(zone, t);
    if (cur !== prev) {
      let lo = t.getTime() - 86_400_000;
      let hi = t.getTime();
      while (hi - lo > MIN) {
        const mid = Math.floor((lo + hi) / 2 / MIN) * MIN;
        if (offsetMinutes(zone, new Date(mid)) === prev) lo = mid;
        else hi = mid;
      }
      out.push(new Date(hi));
    }
    prev = cur;
  }
  return out;
}

describe('часовые пояса: локальные дата и час против независимого расчёта', () => {
  it('все зоны мира: обычные моменты и ±4 часа вокруг каждого перехода (шаг 15 минут)', () => {
    const bad: string[] = [];
    let checked = 0;
    for (const zone of ZONES) {
      const moments: Date[] = [new Date('2026-01-15T00:05:00Z'), new Date('2026-07-15T12:05:00Z'), new Date('2026-12-31T23:59:00Z'), new Date('2026-06-30T23:59:00Z')];
      for (const tr of transitions(zone)) for (let k = -16; k <= 16; k++) moments.push(new Date(tr.getTime() + k * 15 * MIN));
      for (const at of moments) {
        const want = oracle(zone, at);
        const got = localMoment(at, zone);
        checked++;
        if (got === null || got.date !== want.date || got.hour !== want.hour) bad.push(`${zone} ${at.toISOString()}: ждали ${want.date} ${want.hour}, получили ${JSON.stringify(got)}`);
      }
    }
    expect(checked).toBeGreaterThan(10_000);
    expect(bad.slice(0, 5)).toEqual([]);
  }, 120_000);
});

/** Разные виды переходов: в сторону вперёд/назад, в полночь, на полчаса, на 45 минут, в южном полушарии. */
const SIM_ZONES = ['America/New_York', 'Europe/Berlin', 'Europe/London', 'Australia/Lord_Howe', 'Australia/Sydney', 'America/Santiago', 'Africa/Cairo', 'Asia/Beirut', 'America/Havana', 'America/Nuuk', 'Pacific/Auckland', 'America/St_Johns', 'Europe/Chisinau'].filter((z) => ZONES.includes(z));

describe('часовые пояса: ежечасный запуск в :05 по UTC — одно напоминание на локальную дату', () => {
  /** Гоним запуски каждый час на отрезке вокруг перехода; «внесите траты» нужно ровно один раз за каждую полную локальную дату. */
  async function simulate(zone: string, hourLocal: number, from: Date, hours: number) {
    const store = new FakeStore();
    store.settings = [settings(USER_A, { timezone: zone, hourLocal, remindPayments: false, remindDebts: false, remindDaily: true })];
    store.subs.set(USER_A, [sub('s1')]);
    const sender = fakeSender();
    const sentAt: Array<{ date: string; hour: number }> = [];
    const seen = new Map<string, number>();
    for (let h = 0; h < hours; h++) {
      const now = new Date(from.getTime() + h * 60 * MIN);
      const before = sender.calls.length;
      const ctx: RunCtx = { store, send: sender, now, extraHosts: [], clockMs: () => 0 };
      await runScheduled(ctx);
      if (sender.calls.length > before) {
        const l = localMoment(now, zone)!;
        sentAt.push(l);
        seen.set(l.date, (seen.get(l.date) ?? 0) + 1);
      }
    }
    return { sentAt, seen };
  }

  it('нет двойной отправки и нет потерянных дней: 13 зон с переходом, часы 0, 2, 12, 22', async () => {
    const problems: string[] = [];
    for (const zone of SIM_ZONES) {
      const trs = transitions(zone);
      expect(trs.length, `${zone}: переходов в 2026 году`).toBeGreaterThan(0);
      for (const tr of trs) {
        const start = new Date(Math.floor(tr.getTime() / 86_400_000) * 86_400_000 - 2 * 86_400_000 + 5 * MIN);
        for (const hourLocal of [0, 2, 12, 22]) {
          const hours = 5 * 24;
          const { seen } = await simulate(zone, hourLocal, start, hours);
          // полные локальные даты внутри отрезка: пропускаем первую и последнюю
          const dates = new Set<string>();
          for (let h = 0; h < hours; h++) dates.add(localMoment(new Date(start.getTime() + h * 60 * MIN), zone)!.date);
          const list = [...dates].sort();
          for (const d of list.slice(1, -1)) {
            const n = seen.get(d) ?? 0;
            if (n !== 1) problems.push(`${zone} час ${hourLocal} дата ${d}: отправок ${n}`);
          }
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  }, 600_000);

  it('окно: ровно шесть часов подряд и не переходит через полночь', () => {
    for (let h = 0; h < 24; h++) {
      const inside = Array.from({ length: 24 }, (_, l) => l).filter((l) => inSendWindow(h, l));
      expect(inside.length).toBe(Math.min(6, 24 - h));
      expect(inside[0]).toBe(h);
    }
  });
});
