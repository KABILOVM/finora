import { describe, expect, it } from 'vitest';
import { categoryEligibility, type BulkTx } from './bulkActions';

const tx = (over: Partial<BulkTx> = {}): BulkTx => ({ kind: 'expense', debtId: null, fxSource: 'nbt', ...over });

describe('categoryEligibility: можно ли выделенным операциям поставить категорию', () => {
  it('ничего не выделено — нельзя', () => {
    expect(categoryEligibility([])).toEqual({ ok: false, reason: 'Выделите операции' });
  });

  it('расходы — можно, вид расход; доходы — можно, вид доход', () => {
    expect(categoryEligibility([tx(), tx()])).toEqual({ ok: true, kind: 'expense' });
    expect(categoryEligibility([tx({ kind: 'income' })])).toEqual({ ok: true, kind: 'income' });
  });

  it('вперемешку расходы и доходы — нельзя: категории у них разные', () => {
    expect(categoryEligibility([tx(), tx({ kind: 'income' })])).toEqual({ ok: false, reason: 'Выделите только расходы или только доходы' });
  });

  it('перевод среди выделенных — нельзя, причина названа', () => {
    expect(categoryEligibility([tx(), tx({ kind: 'transfer', fxSource: null })])).toEqual({ ok: false, reason: 'У переводов категории нет' });
  });

  it('операция по долгу — нельзя: у движений по долгам категории нет по замыслу', () => {
    expect(categoryEligibility([tx({ debtId: 'd1' })])).toEqual({ ok: false, reason: 'У операций по долгам категории нет' });
  });

  it('корректировка остатка — нельзя', () => {
    expect(categoryEligibility([tx({ fxSource: 'adjust' })])).toEqual({ ok: false, reason: 'Корректировке остатка категорию не ставят' });
  });

  it('старые данные без debtId и fxSource — обычная операция', () => {
    expect(categoryEligibility([{ kind: 'expense' } as BulkTx])).toEqual({ ok: true, kind: 'expense' });
  });
});
