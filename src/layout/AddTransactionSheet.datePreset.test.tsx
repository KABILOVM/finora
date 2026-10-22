import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, renderAppRoot } from '@/app/testkit';
import { findByRole, screen, waitFor } from '@/components/testUtils';
import { allTxs, clickSave, opsDeps, pinToday, tapAmount, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import AddTransactionSheet from './AddTransactionSheet';

beforeEach(pinToday); // сегодня — 15.10.2026
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

/** «Новая операция», открытая переходом с состоянием `state` (так её открывает «Внести траты» на «Главной»). */
async function openWith(state: unknown) {
  const td = opsDeps([]);
  renderAppRoot(<AddTransactionSheet onClose={vi.fn()} />, { deps: td.deps, path: '/add', state });
  await waitFor(() => {
    if (td.stores.length === 0) throw new Error('База ещё открывается');
  });
  await findByRole('dialog', { name: 'Новая операция' });
  return td;
}

const dateChip = () => screen.getByRole('button', { name: /^Дата:/ });

describe('дата, заданная переходом на «Новую операцию»', () => {
  it('вчерашняя дата: форма открывается на «Вчера», операция вносится за вчера', async () => {
    const td = await openWith({ date: '2026-10-14', kind: 'expense' });
    expect(dateChip().getAttribute('aria-label')).toContain('Вчера');
    await tapAmount('30');
    await clickSave();
    await eventually(async () => expect((await allTxs(td)).filter((t) => t.deletedAt === null)).toHaveLength(1));
    expect((await allTxs(td))[0]!.occurredOn).toBe('2026-10-14');
  });

  it.each([
    ['дата в будущем', '2026-10-16'],
    ['слишком старая', '1999-12-31'],
    ['не дата', 'вчера'],
    ['невозможная дата', '2026-02-30'],
    ['число', 20261014],
    ['объект', { a: 1 }],
  ])('%s — игнорируется, остаётся «Сегодня»', async (_name, date) => {
    await openWith({ date });
    expect(dateChip().getAttribute('aria-label')).toContain('Сегодня');
  });

  it('без состояния дата — «Сегодня», как раньше', async () => {
    await openWith(undefined);
    expect(dateChip().getAttribute('aria-label')).toContain('Сегодня');
  });
});
