import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeDebtState } from '@/domain/debts';
import type { Debt, LocalRow } from '@/domain/types';
import type { DebtItem } from './debtSummary';
import { canNet, groupByPerson, peopleWithOpenDebts, personKey, reminderText, totalsLine } from './people';

let n = 0;
const wallets = new Map([['w', { currency: 'TJS' }]]);

/** Долг для проверок. payments — возвраты (для «мне должны» доходы, для «я должен» расходы в кошельке w). */
function item(over: Partial<Debt> = {}, payments: number[] = []): DebtItem {
  const id = `debt-${++n}`;
  const debt = {
    id,
    direction: 'lent',
    counterparty: 'Алишер',
    principalMinor: 50_000,
    currency: 'TJS',
    openedOn: '2026-10-01',
    dueOn: null,
    note: '',
    closedAt: null,
    archivedAt: null,
    deletedAt: null,
    ...over,
  } as LocalRow<Debt>;
  const kind = debt.direction === 'lent' ? ('income' as const) : ('expense' as const);
  const txs = payments.map((amountMinor, i) => ({
    id: `${id}-p${i}`,
    kind,
    walletId: 'w',
    amountMinor,
    occurredOn: '2026-10-05',
    createdAt: `2026-10-05T10:00:00.${String(i).padStart(3, '0')}Z`,
    deletedAt: null,
    debtId: id,
  }));
  return { debt, state: computeDebtState(debt, txs, wallets) };
}

const norm = (s: string) => s.replace(/[\s  ]+/g, ' ');

describe('personKey и группировка: один человек — одна строка', () => {
  it('регистр, пробелы и «ё» не создают разных людей', () => {
    const people = groupByPerson([item({ counterparty: 'Алишер' }), item({ counterparty: '  АЛИШЁР ' }), item({ counterparty: 'алишер', direction: 'borrowed' })]);
    expect(people).toHaveLength(1);
    expect(people[0]!.key).toBe('алишер');
    expect(people[0]!.open).toHaveLength(3);
  });

  it('имя берётся из первого открытого долга (так, как оно записано), а не из ключа', () => {
    const p = groupByPerson([item({ counterparty: 'Алишер Каримов' })])[0]!;
    expect(p.name).toBe('Алишер Каримов');
  });

  it('разные люди — разные строки; порядок по имени', () => {
    const people = groupByPerson([item({ counterparty: 'Зафар' }), item({ counterparty: 'Алишер' }), item({ counterparty: 'Бахтиёр' })]);
    expect(people.map((p) => p.name)).toEqual(['Алишер', 'Бахтиёр', 'Зафар']);
  });

  it('долг без имени (в данных не бывает) не теряется: ключ «-»', () => {
    expect(personKey('   ')).toBe('-');
    expect(groupByPerson([item({ counterparty: ' ' })])[0]!.key).toBe('-');
  });

  it('удалённые и архивные долги не входят вовсе', () => {
    const people = groupByPerson([item({ deletedAt: '2026-10-02T00:00:00Z' }), item({ archivedAt: '2026-10-02T00:00:00Z' })]);
    expect(people).toEqual([]);
  });
});

describe('итоги человека по валютам', () => {
  it('«мне должны» и «я должен» считаются по остатку, а не по сумме долга', () => {
    const p = groupByPerson([item({ principalMinor: 50_000 }, [20_000]), item({ direction: 'borrowed', principalMinor: 10_000 })])[0]!;
    expect(p.totals).toEqual([{ currency: 'TJS', lentMinor: 30_000, borrowedMinor: 10_000, netMinor: 20_000 }]);
  });

  it('несколько долгов одного направления суммируются', () => {
    const p = groupByPerson([item({ principalMinor: 10_000 }), item({ principalMinor: 5_000 })])[0]!;
    expect(p.totals[0]).toMatchObject({ lentMinor: 15_000, borrowedMinor: 0, netMinor: 15_000 });
  });

  it('валюты не складываются; основная — первой, дальше по алфавиту', () => {
    const p = groupByPerson([item({ currency: 'USD', principalMinor: 2_000 }), item({ currency: 'EUR', principalMinor: 1_000 }), item({ currency: 'TJS' })], 'TJS')[0]!;
    expect(p.totals.map((t) => t.currency)).toEqual(['TJS', 'EUR', 'USD']);
  });

  it('закрытые долги в итог не входят, но остаются в «closed»', () => {
    const p = groupByPerson([item({ principalMinor: 10_000 }), item({ principalMinor: 99_000, closedAt: '2026-10-03T00:00:00Z' })])[0]!;
    expect(p.totals[0]!.lentMinor).toBe(10_000);
    expect(p.open).toHaveLength(1);
    expect(p.closed).toHaveLength(1);
  });

  it('погашенный, но не закрытый долг — открытый, с нулём: валюты в итогах нет', () => {
    const p = groupByPerson([item({ principalMinor: 10_000 }, [10_000])])[0]!;
    expect(p.open).toHaveLength(1);
    expect(p.totals).toEqual([]);
  });

  it('у человека остались только закрытые долги: он есть в группировке, но не в списке «Люди»', () => {
    const people = groupByPerson([item({ closedAt: '2026-10-03T00:00:00Z' })]);
    expect(people).toHaveLength(1);
    expect(peopleWithOpenDebts(people)).toEqual([]);
  });

  it('переполнение суммы одного человека не роняет остальных', () => {
    const big = Number.MAX_SAFE_INTEGER;
    const people = groupByPerson([
      item({ counterparty: 'Богатый', principalMinor: big }),
      item({ counterparty: 'Богатый', principalMinor: big }),
      item({ counterparty: 'Алишер', principalMinor: 100 }),
    ]);
    const rich = people.find((p) => p.name === 'Богатый')!;
    expect(rich.overflow).toBe(true);
    expect(rich.totals).toEqual([]);
    expect(people.find((p) => p.name === 'Алишер')!.totals[0]!.lentMinor).toBe(100);
  });

  it('долг, по которому суммы не посчитать (state: null), помечает человека, а не выдаёт нули', () => {
    const broken = { ...item(), state: null };
    expect(groupByPerson([broken])[0]!.overflow).toBe(true);
  });

  it('свойство: итоги = суммы остатков по направлениям; каждый открытый долг у ровно одного человека', () => {
    const arb = fc.array(
      fc.record({
        name: fc.constantFrom('Алишер', 'алишёр', 'Зафар', ' Зафар ', 'Бахтиёр'),
        direction: fc.constantFrom('lent', 'borrowed') as fc.Arbitrary<Debt['direction']>,
        currency: fc.constantFrom('TJS', 'USD'),
        principal: fc.integer({ min: 1, max: 1_000_000 }),
        paid: fc.integer({ min: 0, max: 1_200_000 }),
        closed: fc.boolean(),
      }),
      { maxLength: 25 },
    );
    fc.assert(
      fc.property(arb, (rows) => {
        const items = rows.map((r) => item({ counterparty: r.name, direction: r.direction, currency: r.currency, principalMinor: r.principal, closedAt: r.closed ? '2026-10-03T00:00:00Z' : null }, r.paid > 0 ? [r.paid] : []));
        // платежи в кошельке TJS: для USD-долгов они «в чужой валюте» и в остаток не входят — так и считает computeDebtState
        const people = groupByPerson(items);
        const open = items.filter((it) => it.debt.closedAt === null);
        expect(people.flatMap((p) => p.open).length).toBe(open.length);
        expect(new Set(people.flatMap((p) => p.open.map((it) => it.debt.id))).size).toBe(open.length);
        for (const p of people) {
          for (const t of p.totals) {
            const mine = p.open.filter((it) => it.debt.currency === t.currency);
            const sum = (dir: Debt['direction']) => mine.filter((it) => it.debt.direction === dir).reduce((a, it) => a + it.state!.remainingMinor, 0);
            expect(t.lentMinor).toBe(sum('lent'));
            expect(t.borrowedMinor).toBe(sum('borrowed'));
            expect(t.netMinor).toBe(t.lentMinor - t.borrowedMinor);
          }
        }
      }),
    );
  });
});

describe('словами', () => {
  const t = (lentMinor: number, borrowedMinor: number) => ({ currency: 'TJS', lentMinor, borrowedMinor, netMinor: lentMinor - borrowedMinor });
  it('только мне должны / только я должен', () => {
    expect(norm(totalsLine(t(50_000, 0)))).toBe('Вам должны 500 с.');
    expect(norm(totalsLine(t(0, 20_000)))).toBe('Вы должны 200 с.');
  });
  it('взаимные долги: итог в чью пользу', () => {
    expect(norm(totalsLine(t(50_000, 20_000)))).toBe('Взаимные долги: итого вам должны 300 с.');
    expect(norm(totalsLine(t(20_000, 50_000)))).toBe('Взаимные долги: итого вы должны 300 с.');
    expect(norm(totalsLine(t(20_000, 20_000)))).toBe('Взаимные долги: долги равны');
  });
  it('canNet: взаимозачёт возможен, только если есть обе стороны', () => {
    expect(canNet(t(1, 1))).toBe(true);
    expect(canNet(t(1, 0))).toBe(false);
    expect(canNet(t(0, 1))).toBe(false);
  });
});

describe('reminderText: что сказать тому, кто должен мне', () => {
  const today = '2026-10-15';
  const person = (...items: DebtItem[]) => ({ name: 'Алишер', open: items });

  it('сумма остатка и срок', () => {
    expect(reminderText(person(item({ principalMinor: 50_000, dueOn: '2026-10-25' }, [20_000])), today)).toBe(
      'Алишер, привет! Напоминаю про долг: 300 с. Срок возврата — 25 октября. Спасибо!',
    );
  });

  it('срок прошёл — «был»', () => {
    expect(reminderText(person(item({ dueOn: '2026-10-01' })), today)).toContain('Срок возврата был 1 октября.');
  });

  it('срока нет — про срок ни слова', () => {
    const text = reminderText(person(item()), today)!;
    expect(text).not.toContain('Срок');
    expect(norm(text)).toBe('Алишер, привет! Напоминаю про долг: 500 с. Спасибо!');
  });

  it('несколько долгов: суммы вместе, срок — ближайший; разные валюты — через «и»', () => {
    const text = reminderText(person(item({ principalMinor: 10_000, dueOn: '2026-11-10' }), item({ principalMinor: 5_000, dueOn: '2026-10-30' }), item({ currency: 'USD', principalMinor: 2_000 })), today)!;
    expect(norm(text)).toBe('Алишер, привет! Напоминаю про долг: 150 с. и 20 $. Срок возврата — 30 октября. Спасибо!');
  });

  it('в тексте нет неразрывных пробелов: уйдёт в чужой мессенджер', () => {
    expect(reminderText(person(item({ principalMinor: 1_234_500 })), today)).not.toMatch(/[  ]/);
  });

  it('напоминать не о чем: долг «я должен», погашенный, закрытый — null', () => {
    expect(reminderText(person(item({ direction: 'borrowed' })), today)).toBeNull();
    expect(reminderText(person(item({ principalMinor: 100 }, [100])), today)).toBeNull();
    expect(reminderText(person(), today)).toBeNull();
  });

  it('переполнение суммы — null, а не «NaN»', () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(reminderText(person(item({ principalMinor: big }), item({ principalMinor: big })), today)).toBeNull();
  });
});
