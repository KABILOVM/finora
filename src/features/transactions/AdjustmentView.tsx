import { useState } from 'react';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import { formatMinor } from '@/domain/money';
import type { LocalRow, Transaction, Wallet } from '@/domain/types';
import { formatDayInline } from '@/lib/dates';
import { humanError, toastWithUndo } from './txActions';
import { ADJUSTMENT_TITLE } from './txDisplay';

/**
 * «Корректировка остатка» (domain/adjustment.ts) не правится: её сумма — разница с банком на дату сверки. Здесь она показана,
 * а убрать её можно удалением («Отменить» возвращает). Новая сверка делается в «Кошельки» → кошелёк → «Сверка».
 */
export function AdjustmentView({ tx, wallet, onClose, closing }: { tx: LocalRow<Transaction>; wallet: LocalRow<Wallet> | undefined; onClose: () => void; closing: { current: boolean } }) {
  const store = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const currency = wallet?.currency ?? tx.baseCurrency;
  const sign = tx.kind === 'income' ? '+' : '−';

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      closing.current = true;
      await store.transactions.softDelete(tx.id);
      toastWithUndo(toast, 'Корректировка удалена', () => store.transactions.restore(tx.id), 'Корректировка возвращена');
      onClose();
    } catch (e) {
      closing.current = false;
      toast.error(humanError(e, 'Не удалось удалить корректировку. Попробуйте ещё раз.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} history={false} title={ADJUSTMENT_TITLE}>
      <div className="flex flex-col gap-3 pb-2">
        <div>
          <div className="text-sm text-muted">
            {wallet?.name ?? 'Кошелёк удалён'} · {formatDayInline(tx.occurredOn)}
          </div>
          <div className="text-3xl font-bold" data-testid="adjustment-amount">
            {sign}
            {formatMinor(tx.amountMinor, currency)}
          </div>
        </div>
        <Notice tone="info">
          Это разница между приложением и банком на день сверки. Она меняет остаток кошелька, но не считается доходом или расходом: в итоги
          месяца, категории, бюджеты и аналитику не попадает. Править её нельзя; если сверка была ошибочной, удалите корректировку.
        </Notice>
        <Button variant="danger" onClick={() => void remove()} loading={busy}>
          Удалить корректировку
        </Button>
      </div>
    </Sheet>
  );
}
