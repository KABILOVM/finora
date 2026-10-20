import { describe, expect, it } from 'vitest';
import type { DebtItem } from '@/features/debts/debtSummary';
import { buildAttention, type AttentionInput } from './attention';

const TODAY = '2026-10-15';

/** Долг с остатком (isOwing: не закрыт, не в архиве, остаток > 0). */
const debt = (id: string, counterparty: string, dueOn: string | null, over: { closedAt?: string | null; archivedAt?: string | null; remaining?: number; direction?: 'lent' | 'borrowed' } = {}): DebtItem =>
  ({
    debt: { id, counterparty, dueOn, direction: over.direction ?? 'lent', closedAt: over.closedAt ?? null, archivedAt: over.archivedAt ?? null },
    state: { remainingMinor: over.remaining ?? 10_000 },
  }) as unknown as DebtItem;

const input = (over: Partial<AttentionInput> = {}): AttentionInput => ({ today: TODAY, debts: [], overduePayments: [], overBudgets: [], savingNudges: [], ...over });

describe('buildAttention: что требует внимания на «Главной»', () => {
  it('всё спокойно — пусто (строки на экране нет)', () => {
    expect(buildAttention(input())).toEqual([]);
  });

  it('один просроченный долг: фраза с именем и ссылка прямо на этот долг, красным', () => {
    const r = buildAttention(input({ debts: [debt('d1', 'Рустам', '2026-10-10')] }));
    expect(r).toEqual([{ id: 'debts', kind: 'debt', text: 'Долг просрочен: Рустам', to: '/debts/d1', tone: 'danger' }]);
  });

  it('ссылка на долг всегда внутренняя: id из данных кодируется и не может увести на чужой адрес', () => {
    const r = buildAttention(input({ debts: [debt('//evil.example/x?y=1', 'Рустам', '2026-10-10')] }));
    expect(r[0]!.to).toBe('/debts/%2F%2Fevil.example%2Fx%3Fy%3D1');
    expect(r[0]!.to.startsWith('/debts/')).toBe(true);
  });

  it('несколько просроченных долгов: счёт и ссылка на список долгов', () => {
    const r = buildAttention(input({ debts: [debt('d1', 'А', '2026-10-01'), debt('d2', 'Б', '2026-10-14'), debt('d3', 'В', '2026-09-01')] }));
    expect(r[0]).toMatchObject({ text: 'Просрочено долгов: 3', to: '/debts?dir=lent', tone: 'danger' });
  });

  it('несколько просроченных долгов: ссылка ведёт на вкладку, где они лежат; если и «мне должны», и «я должен» — на «Люди»', () => {
    const late = (id: string, direction: 'lent' | 'borrowed') => debt(id, id, '2026-10-01', { direction });
    expect(buildAttention(input({ debts: [late('a', 'borrowed'), late('b', 'borrowed')] }))[0]?.to).toBe('/debts?dir=borrowed');
    expect(buildAttention(input({ debts: [late('a', 'lent'), late('b', 'lent')] }))[0]?.to).toBe('/debts?dir=lent');
    expect(buildAttention(input({ debts: [late('a', 'lent'), late('b', 'borrowed')] }))[0]?.to).toBe('/debts?dir=people');
  });

  it('срок «сегодня» и будущий — не просрочка; без срока, закрытый, в архиве и без остатка — тоже', () => {
    const r = buildAttention(
      input({
        debts: [
          debt('a', 'Сегодня', TODAY),
          debt('b', 'Завтра', '2026-10-16'),
          debt('c', 'Без срока', null),
          debt('d', 'Закрыт', '2026-10-01', { closedAt: '2026-10-02T00:00:00.000Z' }),
          debt('e', 'Архив', '2026-10-01', { archivedAt: '2026-10-02T00:00:00.000Z' }),
          debt('f', 'Погашен', '2026-10-01', { remaining: 0 }),
        ],
      }),
    );
    expect(r).toEqual([]);
  });

  it('просроченный платёж: одно название или счёт; ссылка в «Платежи»', () => {
    expect(buildAttention(input({ overduePayments: ['Интернет'] }))[0]).toMatchObject({ kind: 'payment', text: 'Платёж просрочен: Интернет', to: '/recurring', tone: 'danger' });
    expect(buildAttention(input({ overduePayments: ['Интернет', 'Аренда'] }))[0]).toMatchObject({ text: 'Просрочено платежей: 2' });
  });

  it('лимит превышен: красным, ссылка в «Бюджеты»', () => {
    expect(buildAttention(input({ overBudgets: ['Еда'] }))[0]).toMatchObject({ kind: 'budget', text: 'Лимит превышен: Еда', to: '/budgets', tone: 'danger' });
    expect(buildAttention(input({ overBudgets: ['Еда', 'Все расходы'] }))[0]).toMatchObject({ text: 'Лимитов превышено: 2' });
  });

  it('«пора отложить» — жёлтым, ссылка в «Кошельки»; во множественном числе — со словом «цели/целей»', () => {
    expect(buildAttention(input({ savingNudges: ['Отпуск'] }))[0]).toMatchObject({ kind: 'saving', text: 'Пора отложить: Отпуск', to: '/wallets', tone: 'warning' });
    expect(buildAttention(input({ savingNudges: ['А', 'Б'] }))[0]?.text).toBe('Пора отложить: 2 цели');
    expect(buildAttention(input({ savingNudges: ['А', 'Б', 'В', 'Г', 'Д'] }))[0]?.text).toBe('Пора отложить: 5 целей');
  });

  it('порядок по важности: долги, платежи, лимиты, затем жёлтое «пора отложить»', () => {
    const r = buildAttention(
      input({ debts: [debt('d1', 'Р', '2026-10-01')], overduePayments: ['П'], overBudgets: ['Б'], savingNudges: ['Ц'] }),
    );
    expect(r.map((i) => i.kind)).toEqual(['debt', 'payment', 'budget', 'saving']);
    expect(r.map((i) => i.tone)).toEqual(['danger', 'danger', 'danger', 'warning']);
    expect(new Set(r.map((i) => i.id)).size).toBe(4);
  });

  it('самый давний долг первым в счёте, а ссылка на единственный долг ведёт именно на него', () => {
    const r = buildAttention(input({ debts: [debt('late', 'Поздний', '2026-10-12'), debt('early', 'Ранний', '2026-09-20')] }));
    expect(r[0]?.to).toBe('/debts?dir=lent'); // двое — на список их вкладки
    const one = buildAttention(input({ debts: [debt('late', 'Поздний', '2026-10-12'), debt('ok', 'Ждёт', '2026-10-20')] }));
    expect(one[0]).toMatchObject({ to: '/debts/late', text: 'Долг просрочен: Поздний' });
  });
});
