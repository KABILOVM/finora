import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, write } from '@/app/testkit';
import { fire, findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import HomePage from './HomePage';
import FirstOperationCard from './FirstOperationCard';
import { useWallets } from '@/db';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

/** Показывает, куда ушёл переход и что в нём передали: так видно, что форма откроется заполненной. */
function Probe() {
  const location = useLocation();
  const st = location.state as { kind?: string; walletId?: string; date?: string; prefill?: Record<string, unknown> } | null;
  return (
    <p data-testid="probe" data-path={location.pathname}>
      {JSON.stringify({ kind: st?.kind, date: st?.date, prefill: st?.prefill })}
    </p>
  );
}
const probe = () => {
  const el = document.querySelector('[data-testid="probe"]');
  return { path: el?.getAttribute('data-path') ?? '', state: JSON.parse(el?.textContent || '{}') as { kind?: string; date?: string; prefill?: { amountMinor: number; categoryId: string | null; note: string; walletId: string } } };
};

function Card() {
  const wallets = useWallets();
  return wallets ? <FirstOperationCard wallets={wallets} /> : null;
}

async function open(setup?: (s: Store) => Promise<unknown>) {
  const td = opsDeps([table()], { setup: setup ? async (s: Store) => void (await setup(s)) : undefined });
  await showApp(
    <>
      <Card />
      <Probe />
    </>,
    td,
    '/',
  );
  return td;
}
const field = () => screen.getByRole('textbox', { name: 'Первая трата одной строкой' });
const firstCat = async (td: ReturnType<typeof opsDeps>, name: string) => (await storeOf(td).db.categories.toArray()).find((c) => c.name === name && c.kind === 'expense')!.id;

describe('«Запишите первую трату»', () => {
  it('у человека без операций карточка есть: поле, примеры и обычная форма рядом', async () => {
    await open();
    await findByRole('region', { name: 'Запишите первую трату' });
    expect(field()).toBeTruthy();
    const chips = Array.from(document.querySelectorAll('[role="group"][aria-label="Примеры"] button')).map((b) => b.textContent);
    expect(chips).toEqual(['Еда 35', 'Продукты 150', 'Транспорт 20']); // стартовые категории есть — примеры по ним
    expect(screen.getByRole('link', { name: 'Или открыть обычную форму' }).getAttribute('href')).toBe('/add');
    expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled(); // пустую строку не отправить
  });

  it('пример подставляется в поле нажатием', async () => {
    await open();
    await findByRole('region', { name: 'Запишите первую трату' });
    await user.click(screen.getByRole('button', { name: 'Продукты 150' }));
    expect(field()).toHaveValue('Продукты 150');
    expect(screen.getByRole('button', { name: 'Далее' })).not.toBeDisabled();
  });

  it('«Продукты 150»: открывается «Новая операция» с суммой 150 и категорией «Продукты», кошелёк — по умолчанию', async () => {
    const td = await open();
    await findByRole('region', { name: 'Запишите первую трату' });
    await user.type(field(), 'Продукты 150');
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await waitFor(() => expect(probe().path).toBe('/add'));
    const { state } = probe();
    const wallet = (await storeOf(td).db.wallets.toArray())[0]!;
    expect(state.kind).toBe('expense');
    expect(state.prefill).toMatchObject({ kind: 'expense', amountMinor: 15_000, categoryId: await firstCat(td, 'Продукты'), note: '', walletId: wallet.id });
    // ничего не записано: деньги вносит только форма после «Сохранить»
    expect(await storeOf(td).db.transactions.count()).toBe(0);
  });

  it('«такси 20 вчера»: сумма, заметка «такси» и вчерашняя дата', async () => {
    await open();
    await findByRole('region', { name: 'Запишите первую трату' });
    await user.type(field(), 'такси 20 вчера');
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await waitFor(() => expect(probe().path).toBe('/add'));
    const { state } = probe();
    expect(state.prefill).toMatchObject({ amountMinor: 2_000, note: 'такси', categoryId: null });
    expect(state.date).toBe('2026-10-14'); // «сегодня» закреплено: 15 октября 2026
  });

  it('отправка формы (Enter в поле на клавиатуре) работает так же, как «Далее»', async () => {
    await open();
    await findByRole('region', { name: 'Запишите первую трату' });
    await user.type(field(), 'обед 35');
    // браузер по Enter в поле отправляет форму; мини-замена Testing Library этого не делает сама, поэтому событие подаём вручную
    fire(field().closest('form')!, new Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => expect(probe().path).toBe('/add'));
  });

  it('строка без суммы, с двумя числами или одним словом не читается: сказано словами, никуда не уходим, ошибка уходит при правке', async () => {
    await open();
    await findByRole('region', { name: 'Запишите первую трату' });
    for (const bad of ['такси', '20', 'такси 20 30']) {
      await user.clear(field());
      await user.type(field(), bad);
      await user.click(screen.getByRole('button', { name: 'Далее' }));
      expect(screen.getByRole('alert').textContent).toContain('Не вижу суммы');
      expect(probe().path).toBe('/');
    }
    await user.type(field(), '1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('называет кошелёк в строке — берётся он: «такси 20 карта»', async () => {
    const td = await open(async (s) => {
      await s.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' });
    });
    await findByRole('region', { name: 'Запишите первую трату' });
    await user.type(field(), 'такси 20 карта');
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await waitFor(() => expect(probe().path).toBe('/add'));
    const card = (await storeOf(td).db.wallets.toArray()).find((w) => w.name === 'Карта')!;
    expect(probe().state.prefill?.walletId).toBe(card.id);
  });

  it('если стартовых категорий нет, примеры — просто слова', async () => {
    await open(async (s) => {
      for (const c of await s.db.categories.toArray()) await s.categories.archive(c.id);
    });
    await findByRole('region', { name: 'Запишите первую трату' });
    const chips = Array.from(document.querySelectorAll('[role="group"][aria-label="Примеры"] button')).map((b) => b.textContent);
    expect(chips).toEqual(['обед 35', 'такси 20', 'продукты 150']);
  });

  it('есть хоть одна операция — карточки нет; когда появилась первая, карточка уходит сама', async () => {
    const td = await open();
    await findByRole('region', { name: 'Запишите первую трату' });
    const wallet = (await storeOf(td).db.wallets.toArray())[0]!;
    await write(() => storeOf(td).transactions.create({ kind: 'income', walletId: wallet.id, amountMinor: 1000, occurredOn: '2026-10-01' }));
    await eventually(() => expect(screen.queryByRole('region', { name: 'Запишите первую трату' })).toBeNull());
  });

  it('на «Главной» стоит сразу под итогом, а у человека с операциями её там нет', async () => {
    const td = opsDeps([table()], {});
    await showApp(<HomePage />, td, '/');
    await findByRole('region', { name: 'Запишите первую трату' });
    expect(document.querySelector('[data-testid="first-operation"]')).not.toBeNull();
  });
});
