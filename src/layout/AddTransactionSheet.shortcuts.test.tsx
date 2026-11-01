import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@/components/testUtils';
import { openAddSheet } from '@/features/transactions/__fixtures__/opsKit';

afterEach(() => vi.restoreAllMocks());

/**
 * Ярлыки на иконке установленного приложения (манифест) открывают `#/add`, `#/add?kind=income`, `#/add?kind=transfer`:
 * у такого перехода нет состояния, поэтому вид операции читается из адреса.
 */
const kindRadio = (name: string) => screen.getByRole('radio', { name });

describe('шит «Новая операция»: вид из адреса (ярлыки на иконке)', () => {
  it('без параметра — расход, как и раньше', async () => {
    await openAddSheet(undefined, '/add');
    expect(kindRadio('Расход')).toBeChecked();
  });

  it('?kind=income — сразу «Доход»', async () => {
    await openAddSheet(undefined, '/add?kind=income');
    expect(kindRadio('Доход')).toBeChecked();
    expect(kindRadio('Расход')).not.toBeChecked();
  });

  it('?kind=transfer — сразу «Перевод» (нужен второй кошелёк)', async () => {
    await openAddSheet(undefined, '/add?kind=transfer');
    expect(kindRadio('Перевод')).toBeChecked();
  });

  it.each(['expense', 'EXPENSE', 'чушь', '', 'income;drop', 'transfer%20'])('?kind=%s — обычный расход', async (kind) => {
    await openAddSheet(undefined, `/add?kind=${kind}`);
    expect(kindRadio('Расход')).toBeChecked();
  });

  it('лишние параметры рядом не мешают', async () => {
    await openAddSheet(undefined, '/add?foo=1&kind=income&bar=2');
    expect(kindRadio('Доход')).toBeChecked();
  });
});
