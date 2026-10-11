import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useStore, ValidationError } from '@/db';
import { formatMinor } from '@/domain/money';
import type { IsoDate, LocalRow, RecurringRule } from '@/domain/types';
import { FxNotice } from '@/features/transactions/FxNotice';
import { GENERIC_SAVE_ERROR, ruDate } from '@/features/transactions/txForm';
import { useRates } from '@/rates/hooks';
import { fxViewFor, needsFx, resolveFxInput } from '@/recurring/fx';
import { viewRule } from '@/recurring/ruleView';
import type { RecurringLookups } from './useRecurringData';

export interface SkipDialogProps {
  rule: LocalRow<RecurringRule>;
  date: IsoDate;
  lookups: RecurringLookups;
  onClose: () => void;
}

/**
 * «Пропустить платёж?» Пропуск = операция с тем же id, созданная сразу удалённой: другие устройства увидят, что платёж за эту
 * дату не нужен. Он обратим: тост «Вернуть» (и раздел «Пропущенные») оживляет ту же операцию. Кошелёк не в базовой валюте —
 * как для обычной операции нужен курс (его снимок сохранится в строке, и «Вернуть» запишет платёж именно по нему).
 */
export function SkipDialog({ rule, date, lookups, onClose }: SkipDialogProps) {
  const store = useStore();
  const toast = useToast();
  const { getRate } = useRates();
  const { base } = lookups;
  const wallet = lookups.wallets.get(rule.walletId);
  const toWallet = rule.toWalletId === null ? undefined : lookups.wallets.get(rule.toWalletId);
  const view = viewRule(rule, lookups.wallets, lookups.categories, base);

  const [rateText, setRateText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const fx = fxViewFor(needsFx(rule, wallet, toWallet, base), wallet, base, getRate);

  const confirm = async () => {
    if (busyRef.current) return;
    const input = resolveFxInput(fx, rateText);
    if (input.error) {
      setRateError(input.error);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setRateError(null);
    try {
      const row = await store.transactions.skipOccurrence(rule.id, date, input.fx ? { fx: input.fx } : {});
      toast.success(`Платёж пропущен: ${view.title}`, {
        durationMs: 8000,
        action: {
          label: 'Вернуть',
          onClick: () => {
            store.transactions.restore(row.id).then(
              () => toast.success('Платёж возвращён и записан в операции'),
              (e: unknown) => {
                console.error('Не удалось вернуть платёж:', e);
                toast.error(e instanceof ValidationError ? e.message : 'Не удалось вернуть платёж. Он остался пропущенным.');
              },
            );
          },
        },
      });
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setError(e.message);
      else {
        console.error('Не удалось пропустить платёж:', e);
        setError(GENERIC_SAVE_ERROR);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open
      title="Пропустить платёж?"
      confirmLabel="Пропустить"
      loading={busy}
      onConfirm={() => void confirm()}
      onCancel={() => !busy && onClose()}
      message={
        <div className="flex flex-col gap-3">
          <p>
            <span className="font-semibold text-text">{view.title}</span>, {ruDate(date)}, {formatMinor(rule.amountMinor, view.currency)}
          </p>
          <p>
            В операции этот платёж не попадёт, и в «Предстоящих» он больше не появится. Передумаете — найдёте его в разделе
            «Пропущенные» и сможете вернуть: тогда он запишется в операции.
          </p>
          <FxNotice
            fx={fx}
            amountMinor={rule.amountMinor}
            rateText={rateText}
            onRateText={(t) => {
              setRateText(t);
              setRateError(null);
            }}
            error={rateError}
          />
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      }
    />
  );
}
