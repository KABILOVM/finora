import { describe, expect, it } from 'vitest';
import { isOccurrence, nextOccurrence, occurrencesBetween, upcomingOccurrences, type ScheduleRule } from '@/domain/schedule';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => ymd(new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000));
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** эталон: независимая простая реализация */
function brute(rule: ScheduleRule, from: string, to: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = rule.startOn.split('-').map(Number) as [number, number, number];
  const maxEnd = rule.endOn ?? '2100-01-01';
  for (let k = 0; k < 200000; k++) {
    let d: string;
    if (rule.frequency === 'daily') d = addDays(rule.startOn, k * rule.intervalN);
    else if (rule.frequency === 'weekly') d = addDays(rule.startOn, 7 * k * rule.intervalN);
    else if (rule.frequency === 'monthly') {
      const idx = sy * 12 + (sm - 1) + k * rule.intervalN;
      const y = Math.floor(idx / 12), m = (idx % 12) + 1;
      d = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(sd, dim(y, m))).padStart(2, '0')}`;
    } else {
      const y = sy + k * rule.intervalN;
      d = `${String(y).padStart(4, '0')}-${String(sm).padStart(2, '0')}-${String(Math.min(sd, dim(y, sm))).padStart(2, '0')}`;
    }
    if (d > maxEnd || d > '2100-01-01') break;
    if (d >= from && d <= to) out.push(d);
    if (d > to) break;
  }
  return out;
}

describe('расписание против эталона', () => {
  it('случайные правила и окна совпадают с эталоном; nextOccurrence и isOccurrence согласованы', () => {
    const rand = rng(7);
    const bad: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const freq = (['daily', 'weekly', 'monthly', 'yearly'] as const)[Math.floor(rand() * 4)]!;
      const y = 2000 + Math.floor(rand() * 101);
      const m = 1 + Math.floor(rand() * 12);
      const d = 1 + Math.floor(rand() * dim(y, m));
      const startOn = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (startOn > '2100-01-01') continue;
      const intervalN = rand() < 0.3 ? 1 : 1 + Math.floor(rand() * (rand() < 0.2 ? 1000 : 12));
      const endOn = rand() < 0.4 ? addDays(startOn, Math.floor(rand() * 4000)) : null;
      const rule: ScheduleRule = { frequency: freq, intervalN, startOn, endOn: endOn && endOn <= '2100-01-01' ? endOn : null };
      const from = addDays(startOn, Math.floor(rand() * 800) - 400);
      const to = addDays(from, Math.floor(rand() * 1500));
      if (from < '2000-01-01' || to > '2100-01-01') continue;
      const got = occurrencesBetween(rule, from, to);
      const want = brute(rule, from, to);
      if (JSON.stringify(got) !== JSON.stringify(want)) { bad.push(`${JSON.stringify(rule)} ${from}..${to}: got ${got.slice(0, 4)} want ${want.slice(0, 4)}`); continue; }
      for (const o of want.slice(0, 3)) if (!isOccurrence(rule, o)) bad.push(`isOccurrence ${o} ${JSON.stringify(rule)}`);
      const nx = nextOccurrence(rule, from);
      const wantNx = brute(rule, addDays(from, 1), '2100-01-01')[0] ?? null;
      if (nx !== wantNx && addDays(from, 1) <= '2100-01-01') bad.push(`next ${JSON.stringify(rule)} after ${from}: ${nx} vs ${wantNx}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('10 000 и более вхождений быстро; 36 500 дневных за век', () => {
    const t0 = performance.now();
    const all = occurrencesBetween({ frequency: 'daily', intervalN: 1, startOn: '2000-01-01', endOn: null }, '2000-01-01', '2100-01-01');
    expect(all.length).toBe(36525 + 1 - 0 === all.length ? all.length : -1);
    expect(all.length).toBeGreaterThan(36000);
    expect(performance.now() - t0).toBeLessThan(1500);
    const rules = Array.from({ length: 300 }, (_, i) => ({ id: String(i), frequency: 'daily' as const, intervalN: 1, startOn: '2000-01-01', endOn: null }));
    const t1 = performance.now();
    const up = upcomingOccurrences(rules, '2026-10-10', 3660, 3660);
    expect(up.length).toBeGreaterThan(300 * 7000);
    expect(performance.now() - t1).toBeLessThan(6000);
  });
});
