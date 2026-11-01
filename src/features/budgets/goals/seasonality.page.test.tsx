import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { yearWindow } from '@/domain/seasonality';
import { opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import { SeasonalNote } from './SeasonalNote';
import { useSeasonality } from './useSeasonality';

/** «Сегодня» = четверг 15 октября 2026: «год» — с октября 2025 по сентябрь 2026. */
beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();

function Probe({ dueOn }: { dueOn: string | null }) {
  const hints = useSeasonality('TJS', dueOn);
  if (hints === undefined) return <p data-testid="probe">читаем</p>;
  return (
    <div>
      <p data-testid="probe">{hints.length === 0 ? 'подсказок нет' : `подсказок: ${hints.length}`}</p>
      <SeasonalNote hints={hints} base="TJS" />
    </div>
  );
}

const probe = () => norm(document.querySelector('[data-testid="probe"]')?.textContent);
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="seasonal-row"]'));

/** Расход на «Еду» 10-го числа каждого из месяцев; деньги на счёте покрыты одним большим доходом. */
async function seed(s: Store, spend: Record<string, number>): Promise<void> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
  const food = (await s.db.categories.toArray()).find((c) => c.name === 'Еда' && c.kind === 'expense')?.id ?? null;
  await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 100_000_000, categoryId: null, occurredOn: '2025-10-01' });
  for (const [month, amountMinor] of Object.entries(spend)) {
    await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor, categoryId: food, occurredOn: `${month}-10` });
  }
}

/** 12 месяцев по 1 000 с.; декабрь 2025 — 1 600 с. */
const normalYear = (): Record<string, number> => ({ ...Object.fromEntries(yearWindow('2026-10-15').map((m) => [m, 100_000] as const)), '2025-12': 160_000 });

async function open(dueOn: string | null, setup: (s: Store) => Promise<void>) {
  const td = opsDeps([table()], { setup });
  await showApp(<Probe dueOn={dueOn} />, td, '/');
  // проба появляется после загрузки приложения и сначала пишет «читаем»: ждём итог (пустая строка — пробы ещё нет)
  await waitFor(() => {
    const text = probe();
    if (text === '' || text === 'читаем') throw new Error('Данные ещё читаются');
  });
  return td;
}

describe('useSeasonality + SeasonalNote', () => {
  it('декабрь год назад дороже обычного, срок в январе — предупреждение про декабрь', async () => {
    await open('2027-01-20', (s) => seed(s, normalYear()));
    expect(probe()).toBe('подсказок: 1');
    expect(rows()).toHaveLength(1);
    // обычное (11 × 1 000 + 1 600) ÷ 12 = 1 050 с., декабрь выше на 550 с. — 52 %
    const text = norm(rows()[0]?.textContent);
    expect(text).toContain('В декабре');
    expect(text).toContain('на 52% выше среднего');
    expect(text).toContain('+550 с.');
    expect(screen.getByRole('note')).toBeTruthy();
  });

  it('нет срока или срок в этом месяце — подсказок нет, и блока нет', async () => {
    await open(null, (s) => seed(s, normalYear()));
    expect(probe()).toBe('подсказок нет');
    expect(rows()).toHaveLength(0);
  });

  it('срок раньше сезонного месяца — этот месяц не упоминается', async () => {
    await open('2026-11-20', (s) => seed(s, normalYear())); // до декабря цель уже должна быть достигнута
    expect(probe()).toBe('подсказок нет');
  });

  it('истории мало (расходы только в пяти месяцах) — подсказок нет', async () => {
    await open('2027-01-20', (s) => seed(s, { '2025-12': 160_000, '2026-05': 100_000, '2026-06': 100_000, '2026-07': 100_000, '2026-08': 100_000 }));
    expect(probe()).toBe('подсказок нет');
  });

  it('удалённая операция в сезонном месяце не считается', async () => {
    await open('2027-01-20', async (s) => {
      await seed(s, normalYear());
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')?.id ?? '';
      // ошибочная запись на 5 000 с. в ноябре, которую потом удалили: ноябрь от неё не «подорожал»
      const extra = await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 500_000, categoryId: null, occurredOn: '2025-11-12' });
      await s.transactions.softDelete(extra.id);
    });
    expect(rows().map((r) => r.getAttribute('data-month'))).toEqual(['2026-12']);
  });

  it('сезонными бывают и два месяца подряд — строки по возрастанию', async () => {
    await open('2027-01-20', (s) => seed(s, { ...normalYear(), '2025-11': 150_000 }));
    expect(rows().map((r) => r.getAttribute('data-month'))).toEqual(['2026-11', '2026-12']);
  });
});
