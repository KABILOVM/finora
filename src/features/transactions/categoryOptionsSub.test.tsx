import { describe, expect, it, vi } from 'vitest';
import { makeTestDeps, renderAppRoot } from '@/app/testkit';
import type { ChipOption } from '@/components/ChipPicker';
import { ChipPicker } from '@/components/ChipPicker';
import { screen, user, waitFor } from '@/components/testUtils';
import { buildCategoryOptions } from '@/features/categories/categoryTree';
import { CategoryGrid } from './CategoryGrid';
import { CategoryPicker } from './CategoryPicker';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

// родитель, его подкатегория и обычная категория — в том виде, в каком их строит общий построитель вариантов
const OPTIONS: ChipOption[] = buildCategoryOptions([
  { id: 'water', name: 'Вода', icon: 'i:water', color: '#2563eb', parentId: 'comm' },
  { id: 'food', name: 'Еда', icon: 'i:food', color: '#f97316', parentId: null },
  { id: 'comm', name: 'Коммунальные услуги', icon: 'i:bulb', color: '#2563eb', parentId: null },
]);

describe('выбор категории с подкатегориями', () => {
  it('порядок: «Коммунальные услуги», под ней «Вода», потом «Еда»', () => {
    expect(OPTIONS.map((o) => o.label)).toEqual(['Коммунальные услуги', 'Вода', 'Еда']);
    expect(OPTIONS[1]?.sub).toBe('Коммунальные услуги');
  });

  it('сетка: у подкатегории мелкая подпись с названием родителя; выбор отдаёт id подкатегории', async () => {
    const onPick = vi.fn();
    renderAppRoot(<CategoryGrid options={OPTIONS} value={null} onPick={onPick} onSkip={() => undefined} kind="expense" />, { deps: makeTestDeps().deps });
    const water = await waitFor(() => screen.getByRole('button', { name: /Вода/ }));
    expect(water).toHaveTextContent('Коммунальные услуги');
    expect(water).toHaveTextContent('Вода');
    // у родителя и обычной категории подписи нет
    expect(screen.getByRole('button', { name: 'Еда' })).not.toHaveTextContent('Коммунальные');
    await user.click(water);
    expect(onPick).toHaveBeenCalledWith('water');
  });

  it('чипы: «Коммунальные услуги › Вода», нажатие выбирает подкатегорию, повторное снимает выбор', async () => {
    const onChange = vi.fn();
    renderAppRoot(<CategoryPicker options={OPTIONS} value="water" onChange={onChange} kind="expense" expanded />, { deps: makeTestDeps().deps });
    const chip = await waitFor(() => screen.getByRole('button', { name: /Вода/, pressed: true }));
    expect(chip).toHaveTextContent('Коммунальные услуги › Вода');
    await user.click(chip);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('ChipPicker (категория в покупках, регулярных платежах): та же подпись', async () => {
    renderAppRoot(<ChipPicker ariaLabel="Категория" options={OPTIONS} value={null} onChange={() => undefined} />, { deps: makeTestDeps().deps });
    const chip = await waitFor(() => screen.getByRole('button', { name: /Вода/ }));
    expect(chip).toHaveTextContent('Коммунальные услуги › Вода');
  });
});
