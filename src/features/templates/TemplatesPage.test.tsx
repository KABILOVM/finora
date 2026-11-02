import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { forgetTemplatesCache, readTemplates, saveTemplate } from './templateStore';
import TemplatesPage from './TemplatesPage';

beforeEach(() => {
  localStorage.clear();
  forgetTemplatesCache();
  pinToday();
});
afterEach(() => {
  unpinToday();
  localStorage.clear();
  forgetTemplatesCache();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="template-row"]')];

function StateProbe() {
  const state = useLocation().state as { prefill?: unknown; kind?: string } | null;
  return <p data-testid="state" data-prefill={JSON.stringify(state?.prefill ?? null)} data-kind={state?.kind ?? ''} />;
}

async function openPage(setup?: (s: Store) => void) {
  const td = opsDeps([table()]);
  await showApp(
    <>
      <TemplatesPage />
      <LocationProbe />
      <StateProbe />
    </>,
    td,
    '/transactions/templates',
  );
  await findByRole('heading', { name: 'Шаблоны операций', level: 1 });
  if (setup) {
    setup(storeOf(td));
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  }
  return td;
}

/** Два шаблона на настоящих кошельке и категории из затравки и один — на несуществующем кошельке. */
async function seed(td: Awaited<ReturnType<typeof openPage>>) {
  const s = storeOf(td);
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
  const food = (await s.db.categories.toArray()).find((c) => c.name === 'Еда' && c.kind === 'expense')!;
  saveTemplate(s.userId, 'Кофе', { kind: 'expense', walletId: cash.id, toWalletId: null, amountMinor: 1_500, categoryId: food.id, note: 'эспрессо' });
  saveTemplate(s.userId, 'Аренда', { kind: 'expense', walletId: 'gone', toWalletId: null, amountMinor: 300_000, categoryId: null, note: '' });
  return { s, cash, food };
}

describe('«Шаблоны операций»', () => {
  it('«Назад» ведёт в «Операции»: экран лежит внутри этого раздела', async () => {
    await openPage();
    const back = screen.getByRole('link', { name: /Операции/ });
    expect(back.getAttribute('href')).toBe('/transactions');
    await user.click(back);
    await waitFor(() => expect(currentPath()).toBe('/transactions'));
  });

  it('пока шаблонов нет — подсказка, как их завести, и кнопка «Новая операция»', async () => {
    await openPage();
    expect(await findByRole('heading', { name: 'Шаблонов пока нет' })).toBeTruthy();
    expect(screen.getByText(/Сохранить как шаблон/)).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Новая операция' }));
    await waitFor(() => expect(currentPath()).toBe('/add'));
  });

  it('список: название, вид, категория, кошелёк, сумма; шаблон на пропавшем кошельке помечен и не вносится', async () => {
    const td = await openPage();
    await seed(td);
    await waitFor(() => expect(rows()).toHaveLength(2));
    const [coffee, rent] = rows();
    expect(norm(coffee!.textContent)).toContain('Кофе');
    expect(norm(coffee!.textContent)).toContain('Расход · Еда · Наличные · эспрессо');
    expect(norm(coffee!.textContent)).toContain(norm(formatMinor(1_500, 'TJS')));
    expect(norm(rent!.textContent)).toContain('кошелёк или категория недоступны');
    expect(screen.queryByRole('link', { name: 'Внести: Аренда' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Удалить: Аренда' })).toBeTruthy();
    expect(norm(document.body.textContent)).toContain('2 из 30');
  });

  it('«Внести» открывает «Новую операцию» с готовой заготовкой', async () => {
    const td = await openPage();
    const { cash, food } = await seed(td);
    await user.click(await findByRole('link', { name: 'Внести: Кофе' }));
    await waitFor(() => expect(currentPath()).toBe('/add'));
    const probe = document.querySelector('[data-testid="state"]') as HTMLElement;
    expect(probe.dataset.kind).toBe('expense');
    expect(JSON.parse(probe.dataset.prefill ?? 'null')).toMatchObject({ kind: 'expense', walletId: cash.id, categoryId: food.id, amountMinor: 1_500, note: 'эспрессо' });
  });

  it('«Переименовать»: новое название сохраняется; повтор названия получает номер; пустое подтвердить нельзя', async () => {
    const td = await openPage();
    const { s } = await seed(td);
    await user.click(await findByRole('button', { name: 'Переименовать: Аренда' }));
    const input = await findByRole('textbox', { name: 'Название' });
    await user.clear(input);
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(input, 'кофе');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(readTemplates(s.userId).map((t) => t.name)).toEqual(['Кофе', 'кофе 2']));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Название' })).toBeNull());
  });

  it('«Удалить» убирает шаблон; «Отменить» возвращает на прежнее место', async () => {
    const td = await openPage();
    const { s } = await seed(td);
    await user.click(await findByRole('button', { name: 'Удалить: Кофе' }));
    await waitFor(() => expect(readTemplates(s.userId).map((t) => t.name)).toEqual(['Аренда']));
    await waitFor(() => expect(rows()).toHaveLength(1));
    await user.click(await findByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(readTemplates(s.userId).map((t) => t.name)).toEqual(['Кофе', 'Аренда']));
  });

  it('последний шаблон удалён — снова подсказка', async () => {
    const td = await openPage();
    const { s } = await seed(td);
    for (const name of ['Кофе', 'Аренда']) await user.click(await findByRole('button', { name: `Удалить: ${name}` }));
    await waitFor(() => expect(readTemplates(s.userId)).toHaveLength(0));
    expect(await findByRole('heading', { name: 'Шаблонов пока нет' })).toBeTruthy();
  });
});
