import { describe, expect, it, vi } from 'vitest';
import { render } from '@/components/testUtils';
import { Receipt } from './Receipt';

/** Позиции чека подставляем напрямую: здесь проверяется только, как чек выглядит. */
const receipt = vi.hoisted(() => ({ items: [] as Array<{ id: string; name: string; qtyMilli: number; unit: 'pcs'; priceMinor: number | null }> }));
vi.mock('@/db', () => ({ useReceipt: () => receipt.items }));

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `i${i}`, name: `Товар ${i + 1}`, qtyMilli: 1000, unit: 'pcs' as const, priceMinor: 100 }));
const title = () => (document.querySelector('[data-testid="receipt"] h3')?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('чек расхода: число позиций склоняется', () => {
  it.each([
    [1, 'Чек · 1 позиция'],
    [2, 'Чек · 2 позиции'],
    [5, 'Чек · 5 позиций'],
    [11, 'Чек · 11 позиций'],
    [21, 'Чек · 21 позиция'],
    [22, 'Чек · 22 позиции'],
    [25, 'Чек · 25 позиций'],
  ])('%i → «%s»', (n, expected) => {
    receipt.items = items(n);
    render(<Receipt txId="t1" currency="TJS" />);
    expect(title()).toBe(expected);
  });

  it('позиций нет — чека нет', () => {
    receipt.items = [];
    render(<Receipt txId="t1" currency="TJS" />);
    expect(document.querySelector('[data-testid="receipt"]')).toBeNull();
  });
});
