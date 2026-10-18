import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useStore, type DebtDeleteMode } from '@/db';
import type { CurrencyCode, LocalRow, Transaction, UUID, Wallet } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { keepText, opsCount, previewDebtDelete, previewText, type DeletePreview } from './debtDeleteText';

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

/** Предпросмотр без падения: суммы, которые не помещаются в расчёт, просто не называем. */
function safePreview(...args: Parameters<typeof previewDebtDelete>): DeletePreview | null {
  try {
    return previewDebtDelete(...args);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/**
 * Подтверждение удаления долга. Есть операции — вариант («только долг» или «долг и его операции») выбирают сами: заранее
 * не выбран ни один, и «Удалить» недоступно, пока выбора нет (оба варианта меняют итоги, просто по-разному). Операций нет —
 * выбирать нечего. Кнопка «Отмена» остаётся в фокусе (как у всех подтверждений), ничего не меняется, пока не нажато «Удалить».
 */
export function DeleteDebtDialog({ open, debtId, counterparty, txs, wallets, base, loading, onConfirm, onCancel }: Props) {
  const store = useStore();
  const [mode, setMode] = useState<DebtDeleteMode | null>(null);
  useEffect(() => {
    if (open) setMode(null);
  }, [open]);
  const rules = useLiveQuery(
    async () => (await store.db.recurring_rules.toArray()).filter((r) => r.debtId === debtId && r.deletedAt === null && r.archivedAt === null).length,
    [store, debtId],
  );
  const preview = safePreview(txs, wallets, base);
  const count = preview?.count ?? [...txs.values()].filter((t) => t.deletedAt === null).length;
  const choose = count > 0;
  const keep = preview ? keepText(preview) : '';

  return (
    <ConfirmDialog
      open={open}
      danger
      title={`Удалить долг «${counterparty}»?`}
      confirmLabel="Удалить"
      loading={loading}
      confirmDisabled={choose && mode === null}
      onConfirm={() => {
        if (!choose) onConfirm('keep-operations');
        else if (mode !== null) onConfirm(mode);
      }}
      onCancel={onCancel}
      message={
        <div className="flex flex-col gap-3">
          {choose && (
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
          )}
          {!choose ? (
            <p data-testid="debt-delete-hint">Операций по этому долгу нет.</p>
          ) : mode === null ? (
            <p data-testid="debt-delete-hint">
              Выберите, что сделать с {count} {pluralRu(count, 'операцией', 'операциями', 'операциями')} этого долга.
            </p>
          ) : mode === 'keep-operations' ? (
            <p data-testid="debt-delete-hint">
              {opsCount(count)} останутся в истории как обычные: деньги в кошельках не меняются, но они попадут в итоги и бюджеты
              {keep ? ` — ${keep}` : ''}. Операциям без заметки допишем «Долг «{counterparty}» (удалён)».
            </p>
          ) : (
            <p data-testid="debt-delete-hint">
              Будет удалено: {preview ? previewText(preview) : `${opsCount(count)}.`} Остатки кошельков вернутся такими, как были до этого долга.
            </p>
          )}
          {rules !== undefined && rules > 0 && (
            <p>Регулярные платежи по этому долгу ({rules}) уйдут в архив, чтобы не проводиться как обычные расходы.</p>
          )}
          <p>Сразу после удаления всё можно вернуть кнопкой «Отменить». Чтобы просто убрать долг из списка, отправьте его в архив.</p>
        </div>
      }
    />
  );
}
