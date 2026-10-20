/**
 * «Корректировка остатка» — обычная операция дохода/расхода на разницу между приложением и банком, поставленная ДАТОЙ сверки.
 * Меняет остаток кошелька, но НЕ доход и НЕ расход: в итоги месяца, категории, бюджеты, аналитику и прогноз не входит (как операции
 * по долгам). Помечается значением `fxSource = 'adjust'` — отдельной колонки в облаке нет, так что синхронизация, резервная копия и
 * отчёты работают без правок схемы. Признак проверяется ТОЛЬКО через isAdjustment: если появится своя колонка, менять придётся здесь.
 */
export const ADJUSTMENT_SOURCE = 'adjust';

/** Заметка по умолчанию у такой операции. */
export const ADJUSTMENT_NOTE = 'Корректировка остатка';

interface AdjustmentLike {
  kind: string;
  /** Нет поля (старые данные, тестовые заготовки) = не корректировка. */
  fxSource?: string | null | undefined;
  debtId?: string | null | undefined;
}

export function isAdjustment(t: AdjustmentLike): boolean {
  return t.kind !== 'transfer' && (t.debtId ?? null) === null && t.fxSource === ADJUSTMENT_SOURCE;
}
