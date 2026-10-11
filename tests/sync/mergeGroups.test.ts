import { describe, expect, it } from 'vitest';
import { MERGE_GROUPS, MERGE_META_FIELDS, SYNC_TABLES, TABLE_SPECS } from '@/sync/tables';

/**
 * Группы полей для слияния (MERGE_GROUPS) обязаны покрывать договор: добавили колонку в TABLE_SPECS, но забыли про группу —
 * при слиянии её значение молча терялось бы. Тест упадёт и подскажет.
 */
describe.each(SYNC_TABLES)('группы слияния: %s', (table) => {
  const fields = TABLE_SPECS[table].columns.map((c) => c.field);
  const grouped = MERGE_GROUPS[table].flat();

  it('каждая колонка договора, кроме служебных, входит ровно в одну группу', () => {
    const expected = fields.filter((f) => !MERGE_META_FIELDS.includes(f)).sort();
    expect([...grouped].sort()).toEqual(expected);
    expect(new Set(grouped).size, 'поле в двух группах').toBe(grouped.length);
  });

  it('служебные поля (id, createdAt, метка версии, устройство) в группы не входят', () => {
    for (const f of MERGE_META_FIELDS) expect(grouped).not.toContain(f);
  });

  it('групп нет пустых, и каждое поле группы есть в договоре', () => {
    for (const g of MERGE_GROUPS[table]) {
      expect(g.length).toBeGreaterThan(0);
      for (const f of g) expect(fields).toContain(f);
    }
  });

  it('удаление — отдельная группа из одного поля', () => {
    expect(MERGE_GROUPS[table]).toContainEqual(['deletedAt']);
  });
});

describe('связанные проверками сервера поля операции живут в одной группе', () => {
  // CHECK transactions_transfer_shape / transactions_plain_shape в supabase/schema.sql связывают эти поля между собой
  const coupled = ['kind', 'walletId', 'toWalletId', 'amountMinor', 'toAmountMinor', 'categoryId', 'fxRate', 'fxSource'];
  it('вид, кошельки, суммы, категория и курс — вместе', () => {
    const group = MERGE_GROUPS.transactions.find((g) => g.includes('kind'));
    expect(group).toBeDefined();
    for (const f of coupled) expect(group, f).toContain(f);
  });
});
