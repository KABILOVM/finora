import { describe, expect, it } from 'vitest';
import { goalProgress } from '@/domain/goals';
import { formatMinor } from '@/domain/money';
import { goalBarLabel, goalDueLine, goalPaceLine, goalRemainingLine, goalSavedLine, nudgeLine } from './goalText';

const norm = (s: string) => s.replace(/\s+/g, ' ');
const TODAY = '2026-10-15';
const prog = (balanceMinor: number, goalMinor: number, goalOn: string | null) => goalProgress({ balanceMinor, goalMinor, goalOn, today: TODAY });

describe('слова о цели накопления', () => {
  it('«Накоплено X из Y» и «Осталось Z»; достигнутая цель — «Цель достигнута», остатка нет', () => {
    const p = prog(300_00, 1000_00, null);
    expect(norm(goalSavedLine(p, 'TJS'))).toBe(norm(`Накоплено ${formatMinor(300_00, 'TJS')} из ${formatMinor(1000_00, 'TJS')}`));
    expect(norm(goalRemainingLine(p, 'TJS'))).toBe(norm(`Осталось ${formatMinor(700_00, 'TJS')}`));
    const done = prog(1200_00, 1000_00, null);
    expect(goalSavedLine(done, 'TJS')).toMatch(/^Цель достигнута: /);
    expect(goalRemainingLine(done, 'TJS')).toBe('');
  });

  it('срок словами: будущее, завтра, сегодня, прошёл; склонение дней; нет срока — пусто; достигнутая цель — без давления', () => {
    expect(goalDueLine(null, prog(0, 1000, null))).toBe('');
    expect(goalDueLine('2026-10-20', prog(0, 1000, '2026-10-20'))).toBe('К 20.10.2026 · через 5 дней');
    expect(goalDueLine('2026-10-21', prog(0, 1000, '2026-10-21'))).toBe('К 21.10.2026 · через 6 дней');
    expect(goalDueLine('2026-10-16', prog(0, 1000, '2026-10-16'))).toBe('К 16.10.2026 · срок завтра');
    expect(goalDueLine('2026-10-15', prog(0, 1000, '2026-10-15'))).toBe('К 15.10.2026 · срок сегодня');
    expect(goalDueLine('2026-10-14', prog(0, 1000, '2026-10-14'))).toBe('Срок прошёл 1 день назад (было 14.10.2026)');
    expect(goalDueLine('2026-10-10', prog(0, 1000, '2026-10-10'))).toBe('Срок прошёл 5 дней назад (было 10.10.2026)');
    expect(goalDueLine('2026-10-10', prog(2000, 1000, '2026-10-10'))).toBe('Срок был 10.10.2026');
  });

  it('сколько откладывать: «около X в месяц», меньше месяца — «нужно отложить X до срока», без срока и при достижении — пусто', () => {
    // 15 октября → 15 января: 3 месяца, осталось 900 → по 300
    expect(norm(goalPaceLine(prog(100_00, 1000_00, '2027-01-15'), 'TJS'))).toBe(norm(`Откладывайте около ${formatMinor(300_00, 'TJS')} в месяц`));
    expect(norm(goalPaceLine(prog(100_00, 1000_00, '2026-11-01'), 'TJS'))).toBe(norm(`Нужно отложить ${formatMinor(900_00, 'TJS')} до срока`));
    expect(goalPaceLine(prog(0, 1000, null), 'TJS')).toBe('');
    expect(goalPaceLine(prog(1000, 1000, '2027-01-15'), 'TJS')).toBe('');
    expect(goalPaceLine(prog(0, 1000, '2026-10-01'), 'TJS')).toBe(''); // срок прошёл
  });

  it('«Пора отложить» и подпись полосы', () => {
    expect(norm(nudgeLine({ savedMinor: 200_00, neededMinor: 1000_00 }, 'TJS'))).toBe(
      norm(`Пора отложить: в этом месяце отложено ${formatMinor(200_00, 'TJS')} из ~${formatMinor(1000_00, 'TJS')}`),
    );
    expect(goalBarLabel('Отпуск', prog(250, 1000, null))).toBe('Цель «Отпуск»: накоплено 25%');
  });
});
