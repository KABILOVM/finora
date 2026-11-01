import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@/components/testUtils';
import { HideAmountsProvider } from '@/components/hideAmounts';
import type { SeasonalHint } from '@/domain/seasonality';
import { SeasonalNote, percentText } from './SeasonalNote';

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const note = () => document.querySelector<HTMLElement>('[data-testid="seasonal-note"]');
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="seasonal-row"]'));

const dec: SeasonalHint = { month: '2026-12', yearAgoMinor: 160_000, averageMinor: 105_000, extraMinor: 120_000, percent: 40 };
const nov: SeasonalHint = { month: '2026-11', yearAgoMinor: 150_000, averageMinor: 109_166, extraMinor: 40_834, percent: 37 };

beforeEach(() => {
  localStorage.removeItem('finora-hide-balance');
});

describe('percentText', () => {
  it('обычное значение — с процентом, запредельное — «более 999%»', () => {
    expect(percentText(40)).toBe('40%');
    expect(percentText(999)).toBe('999%');
    expect(percentText(1000)).toBe('более 999%');
  });
});

describe('SeasonalNote', () => {
  it('нет подсказок — ничего не рисуем', () => {
    render(<SeasonalNote hints={[]} base="TJS" />);
    expect(note()).toBeNull();
  });

  it('один месяц: предложный падеж, процент, сумма со знаком, совет и пометка, что числа плана не меняются', () => {
    render(<SeasonalNote hints={[dec]} base="TJS" />);
    expect(screen.getByRole('note')).toBe(note());
    expect(rows()).toHaveLength(1);
    const text = norm(note()?.textContent);
    expect(text).toContain('В декабре вы обычно тратите больше: в прошлом году на 40% выше среднего (+1 200 с.).');
    expect(text).toContain('Заложите запас.');
    expect(text).toContain('Числа плана это не меняет.');
  });

  it('несколько месяцев — отдельными строками, но не больше трёх', () => {
    const jan: SeasonalHint = { ...dec, month: '2027-01' };
    const feb: SeasonalHint = { ...dec, month: '2027-02' };
    render(<SeasonalNote hints={[nov, dec, jan, feb]} base="TJS" />);
    expect(rows().map((r) => r.getAttribute('data-month'))).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(norm(rows()[0]?.textContent)).toContain('В ноябре');
    expect(norm(rows()[2]?.textContent)).toContain('В январе');
    // совет и пометка — один раз на весь блок
    expect(norm(note()?.textContent).match(/Заложите запас/g)).toHaveLength(1);
  });

  it('«Скрыть суммы» прячет сумму превышения, но не проценты и слова', () => {
    localStorage.setItem('finora-hide-balance', '1');
    render(
      <HideAmountsProvider>
        <SeasonalNote hints={[dec]} base="TJS" />
      </HideAmountsProvider>,
    );
    const text = norm(note()?.textContent);
    expect(text).not.toContain('1 200');
    expect(screen.getByRole('img', { name: 'Сумма скрыта' })).toBeTruthy();
    expect(text).toContain('на 40% выше среднего');
  });
});
