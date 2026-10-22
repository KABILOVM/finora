import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentSearch, LocationProbe, opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { forgetActiveTripCache, readActiveTrip } from './activeTrip';
import TripsPage from './TripsPage';

beforeEach(() => {
  localStorage.clear();
  forgetActiveTripCache();
  pinToday(); // 15 октября 2026
});
afterEach(() => {
  unpinToday();
  localStorage.clear();
  forgetActiveTripCache();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

/** Самарканд: три траты за четыре дня (одна — в долларах), доход-возврат; Баку — одна трата; ещё операция без метки. */
async function seed(s: Store): Promise<void> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!;
  const cats = await s.db.categories.toArray();
  const food = cats.find((c) => c.name === 'Еда' && c.kind === 'expense')!.id;
  const transport = cats.find((c) => c.kind === 'expense' && c.name !== 'Еда')!.id;
  await s.wallets.update(cash.id, { openingBalanceMinor: 100_000_000 });
  const add = (amountMinor: number, occurredOn: string, note: string, categoryId: string | null = food) =>
    s.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor, categoryId, occurredOn, note });
  await add(10_000, '2026-09-10', 'такси #Самарканд', transport);
  await add(4_000, '2026-09-10', 'плов #Самарканд');
  await add(6_000, '2026-09-13', 'дыни #самарканд');
  await s.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 1_000, categoryId: null, occurredOn: '2026-09-13', note: 'возврат #Самарканд' });
  await add(20_000, '2026-10-02', 'отель #Баку');
  await add(999, '2026-10-03', 'просто так');
}

async function openPage(path = '/trips', setup: (s: Store) => Promise<unknown> = seed) {
  const td = opsDeps([table()], { setup: async (s) => void (await setup(s)) });
  await showApp(
    <>
      <TripsPage />
      <LocationProbe />
    </>,
    td,
    path,
  );
  await findByRole('heading', { name: 'Поездки', level: 1 });
  return td;
}

describe('«Поездки»', () => {
  it('список: поездки по меткам, недавние первыми, с суммой расходов и числом операций', async () => {
    await openPage();
    await waitFor(() => expect(all('trip-row')).toHaveLength(2));
    const [baku, samarkand] = all('trip-row');
    expect(norm(baku!.textContent)).toContain('Баку');
    expect(norm(baku!.textContent)).toContain(fmt(20_000));
    expect(norm(samarkand!.textContent)).toContain('Самарканд'); // чаще писали с большой буквы
    expect(norm(samarkand!.textContent)).toContain(fmt(20_000));
    expect(norm(samarkand!.textContent)).toContain('4 операции');
  });

  it('поездка открывается: итоги, дни, категории, крупные траты и все операции; «Все поездки» возвращает', async () => {
    await openPage();
    await waitFor(() => expect(all('trip-row')).toHaveLength(2));
    await user.click(screen.getAllByRole('button', { name: /самарканд/i })[0]!);
    await waitFor(() => expect(tid('trip-summary')).not.toBeNull());
    expect(currentSearch()).toBe('?trip=%D1%81%D0%B0%D0%BC%D0%B0%D1%80%D0%BA%D0%B0%D0%BD%D0%B4');
    const sum = norm(tid('trip-summary')!.textContent);
    expect(sum).toContain(fmt(20_000));
    expect(sum).toContain('4 дня');
    expect(sum).toContain(fmt(5_000)); // в день: 20 000 ÷ 4
    expect(all('trip-cat')).toHaveLength(2);
    expect(all('trip-day')).toHaveLength(2);
    expect(all('trip-big').map((e) => norm(e.textContent))[0]).toContain('такси');
    expect(all('trip-op')).toHaveLength(4);
    expect(norm(all('trip-op')[0]!.textContent)).toMatch(/\+/); // свежий — возврат (доход) со знаком плюс
    // метка в заметках операций не повторяется
    expect(all('trip-op').every((e) => !norm(e.textContent).includes('#'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Все поездки' }));
    await waitFor(() => expect(all('trip-row')).toHaveLength(2));
    expect(currentSearch()).toBe('');
  });

  it('адрес с неизвестной поездкой показывает список', async () => {
    await openPage('/trips?trip=nope');
    await waitFor(() => expect(all('trip-row')).toHaveLength(2));
  });

  it('«Начать поездку»: метка запоминается на устройстве, появляется «Идёт поездка»; «Завершить» снимает её', async () => {
    const td = await openPage('/trips', async () => {});
    await user.type(await findByRole('textbox', { name: 'Название поездки' }), 'Поездка в Самарканд');
    expect(screen.getByText('Новые операции получат метку #Поездка_в_Самарканд')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(tid('trip-active')).not.toBeNull());
    expect(norm(tid('trip-active')!.textContent)).toContain('Идёт поездка: Поездка в Самарканд');
    expect(readActiveTrip(storeOf(td).userId)).toBe('Поездка_в_Самарканд');
    expect(localStorage.getItem(`finora:active-trip:${storeOf(td).userId}`)).toBe('Поездка_в_Самарканд');
    await user.click(screen.getByRole('button', { name: 'Завершить' }));
    await waitFor(() => expect(tid('trip-active')).toBeNull());
    expect(readActiveTrip(storeOf(td).userId)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Название поездки' })).toBeTruthy();
  });

  it('слишком короткое название — понятная ошибка, поездка не начинается', async () => {
    const td = await openPage('/trips', async () => {});
    await user.type(await findByRole('textbox', { name: 'Название поездки' }), 'а');
    await user.click(screen.getByRole('button', { name: 'Начать' }));
    expect((await findByRole('alert')).textContent).toMatch(/от 2 до 40/);
    expect(readActiveTrip(storeOf(td).userId)).toBeNull();
  });

  it('название уже известной поездки берёт принятое написание метки (#самарканд и #Самарканд — одна поездка)', async () => {
    const td = await openPage();
    await user.type(await findByRole('textbox', { name: 'Название поездки' }), 'САМАРКАНД');
    await user.click(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() => expect(tid('trip-active')).not.toBeNull());
    expect(readActiveTrip(storeOf(td).userId)).toBe('Самарканд');
  });

  it('«Вести эту поездку» в отчёте включает режим; рядом «Завершить поездку»', async () => {
    const td = await openPage('/trips?trip=баку');
    await user.click(await findByRole('button', { name: 'Вести эту поездку' }));
    await waitFor(() => expect(readActiveTrip(storeOf(td).userId)).toBe('Баку'));
    await user.click(await findByRole('button', { name: 'Завершить поездку' }));
    await waitFor(() => expect(readActiveTrip(storeOf(td).userId)).toBeNull());
  });

  it('поездок нет — подсказка', async () => {
    await openPage('/trips', async () => {});
    await waitFor(() => expect(screen.getByText('Поездок пока нет')).toBeTruthy());
  });
});
