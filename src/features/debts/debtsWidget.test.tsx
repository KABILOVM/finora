import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { findByRole, screen, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import DebtsWidget from './DebtsWidget';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const widget = () => document.querySelector('[data-testid="debts-widget"]');
const text = (el: Element | null) => norm(el?.textContent);
/** Ждёт, пока элемент появится (querySelector вернёт null, а не бросит, поэтому бросаем сами). */
const need = (find: () => Element | null) =>
  waitFor(() => {
    const el = find();
    if (!el) throw new Error('Элемента ещё нет');
    return el;
  });

type Debt = Parameters<Store['debts']['create']>[0];
const make = (s: Store, over: Partial<Debt> = {}) =>
  s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', ...over });

async function open(setup?: (s: Store) => Promise<unknown>) {
  const td = opsDeps([table()], { setup: setup ? async (s) => void (await setup(s)) : undefined });
  await showApp(<DebtsWidget />, td, '/');
  // дать запросу отработать: пустой виджет — это «ничего», поэтому ждём чтения базы
  await eventually(async () => expect(await storeOf(td).db.debts.count()).toBeGreaterThanOrEqual(0));
  await new Promise((r) => setTimeout(r, 60));
  return td;
}

describe('виджет «Долги» на «Главной»', () => {
  it('долгов нет — ничего не рисуется', async () => {
    await open();
    expect(widget()).toBeNull();
    expect(screen.queryByText('Долги')).toBeNull();
  });

  it('есть только закрытые, архивные и полностью погашенные — тоже ничего', async () => {
    await open(async (s) => {
      const a = await make(s, { counterparty: 'Закрытый' });
      await s.debts.close(a.id);
      const b = await make(s, { counterparty: 'Архивный' });
      await s.debts.archive(b.id);
      const c = await make(s, { counterparty: 'Погашенный', principalMinor: 1000 });
      const cash = (await s.db.wallets.toArray())[0]!.id;
      await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 1000, occurredOn: '2026-10-05', debtId: c.id });
    });
    expect(widget()).toBeNull();
  });

  it('сколько мне должны и сколько должен я, каждая валюта отдельно; ссылка на /debts', async () => {
    await open(async (s) => {
      await make(s, { counterparty: 'Алишер', principalMinor: 50_000 });
      await make(s, { counterparty: 'Бобур', principalMinor: 25_000 });
      await make(s, { counterparty: 'Джон', principalMinor: 1_000, currency: 'USD' });
      await make(s, { counterparty: 'Банк', direction: 'borrowed', principalMinor: 300_000 });
    });
    const w = await need(widget);
    expect(text(w.querySelector('[data-testid="debts-widget-lent"]'))).toBe(`Мне должны${fmt(75_000)}, ${fmt(1_000, 'USD')}`);
    expect(text(w.querySelector('[data-testid="debts-widget-borrowed"]'))).toBe(`Я должен${fmt(300_000)}`);
    expect(screen.getByRole('link', { name: 'Все долги' }).getAttribute('href')).toBe('/debts');
  });

  it('показывает только то направление, где есть долги', async () => {
    await open(async (s) => void (await make(s, { direction: 'borrowed', counterparty: 'Банк' })));
    const w = await need(widget);
    expect(w.querySelector('[data-testid="debts-widget-lent"]')).toBeNull();
    expect(w.querySelector('[data-testid="debts-widget-borrowed"]')).not.toBeNull();
  });

  it('ближайший срок словами; ссылка на страницу этого долга', async () => {
    let id = '';
    await open(async (s) => {
      await make(s, { counterparty: 'Дальний', dueOn: '2026-12-01' });
      id = (await make(s, { counterparty: 'Ближний', dueOn: '2026-10-18' })).id;
      await make(s, { counterparty: 'Без срока' });
    });
    const next = await need(() => document.querySelector('[data-testid="debts-widget-next"]'));
    expect(text(next)).toBe('Ближайший срок: Ближний — через 3 дня');
    expect(next.getAttribute('href')).toBe(`/debts/${id}`);
    expect(next.className).not.toContain('text-danger');
  });

  it('просроченный подсвечен красным, словами и значком; просрочка идёт раньше ближайшего срока', async () => {
    await open(async (s) => {
      await make(s, { counterparty: 'Ближний', dueOn: '2026-10-18' });
      await make(s, { counterparty: 'Давно', dueOn: '2026-10-12' });
    });
    const next = await need(() => document.querySelector('[data-testid="debts-widget-next"]'));
    expect(text(next)).toBe('Просрочен на 3 дня: Давно');
    expect(next.className).toContain('text-danger');
    expect(next.querySelector('svg')).not.toBeNull();
  });

  it('несколько просроченных: общее число', async () => {
    await open(async (s) => {
      await make(s, { counterparty: 'А', dueOn: '2026-10-01' });
      await make(s, { counterparty: 'Б', dueOn: '2026-10-02' });
    });
    await findByRole('heading', { name: 'Долги' });
    expect(text(widget())).toContain('Всего просрочено: 2');
  });

  it('виджет обновляется сам, когда появляется долг', async () => {
    const td = await open();
    expect(widget()).toBeNull();
    await make(storeOf(td), { counterparty: 'Новый' });
    await waitFor(() => expect(widget()).not.toBeNull());
  });
});
