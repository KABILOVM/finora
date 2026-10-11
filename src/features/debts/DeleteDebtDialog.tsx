import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useStore, type DebtDeleteMode } from '@/db';
import type { CurrencyCode, LocalRow, Transaction, UUID, Wallet } from '@/domain/types';
import { opsCount, previewDebtDelete, previewText } from './debtDeleteText';

interface Props {
  open: boolean;
  debtId: UUID;
  counterparty: string;
  txs: ReadonlyMap<UUID, LocalRow<Transaction>>;
  wallets: ReadonlyMap<UUID, LocalRow<Wallet>>;
  base: CurrencyCode;
  loading: boolean;
  onConfirm: (mode: DebtDeleteMode) => void;
  onCancel: () => void;
}

const OPTIONS: readonly { mode: DebtDeleteMode; label: string }[] = [
  { mode: 'keep-operations', label: 'Удалить только долг' },
  { mode: 'with-operations', label: 'Удалить долг и его операции' },
];

/**
 * Подтверждение удаления долга с двумя вариантами. По умолчанию выбран безопасный («только долг»: деньги не двигаются).
 * Кнопка «Отмена» остаётся в фокусе (как у всех подтверждений), ничего не меняется, пока не нажато «Удалить».
 */
export function DeleteDebtDialog({ open, debtId, counterparty, txs, wallets, base, loading, onConfirm, onCancel }: Props) {
  const store = useStore();
  const [mode, setMode] = useState<DebtDeleteMode>('keep-operations');
  useEffect(() => {
    if (open) setMode('keep-operations');
  }, [open]);
  const rules = useLiveQuery(
    async () => (await store.db.recurring_rules.toArray()).filter((r) => r.debtId === debtId && r.deletedAt === null && r.archivedAt === null).length,
    [store, debtId],
  );
  const preview = previewDebtDelete(txs, wallets, base);

  return (
    <ConfirmDialog
      open={open}
      danger
      title={`Удалить долг «${counterparty}»?`}
      confirmLabel="Удалить"
      loading={loading}
      onConfirm={() => onConfirm(mode)}
      onCancel={onCancel}
      message={
        <div className="flex flex-col gap-3">
          <div role="radiogroup" aria-label="Что удалить" className="flex flex-col gap-2">
            {OPTIONS.map((o) => (
              <label
                key={o.mode}
                className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 text-base font-semibold text-text has-[:checked]:border-brand"
              >
                <input type="radio" name="debt-delete-mode" className="h-5 w-5 accent-brand" checked={mode === o.mode} onChange={() => setMode(o.mode)} />
                {o.label}
              </label>
            ))}
          </div>
          {mode === 'keep-operations' ? (
            <p data-testid="debt-delete-hint">
              {preview.count > 0 ? `${opsCount(preview.count)} останутся` : 'Операций по этому долгу нет.'}
              {preview.count > 0 &&
                ' в истории как обычные: деньги в кошельках не меняются, но теперь они считаются обычными доходами и расходами месяца и попадут в итоги и бюджеты.'}
            </p>
          ) : (
            <p data-testid="debt-delete-hint">
              Будет удалено: {previewText(preview)} Остатки кошельков вернутся такими, как были до этого долга.
            </p>
          )}
          {rules !== undefined && rules > 0 && (
            <p>Регулярные платежи по этому долгу ({rules}) уйдут в архив, чтобы не проводиться как обычные расходы.</p>
          )}
          <p>Сразу после удаления всё можно вернуть кнопкой «Отменить».</p>
        </div>
      }
    />
  );
}
