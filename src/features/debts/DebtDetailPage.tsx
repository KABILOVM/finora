import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/Toast';
import { useDebtView, useStore, type DebtDeleteMode, type DebtDeletion } from '@/db';
import type { DebtPayment } from '@/domain/debts';
import { formatMinor } from '@/domain/money';
import { humanError, toastWithUndo, UNDO_MS } from '@/features/transactions/txActions';
import { endSentence } from '@/features/transactions/txDisplay';
import { useToday } from '@/recurring/useToday';
import { DebtSheet } from './DebtSheet';
import { DeleteDebtDialog } from './DeleteDebtDialog';
import { DebtSummaryCard } from './DebtSummaryCard';
import { DIRECTION_LABEL, ruDateShort } from './debtText';
import { IssuesNotice, PaymentsList } from './PaymentsList';
import { PaymentSheet } from './PaymentSheet';
import { useDebtLines } from './useDebtLines';

type Dialog = 'close' | 'payment' | 'edit' | 'delete' | null;

function BackLink({ dir }: { dir?: string }) {
  return (
    <Link to={dir ? `/debts?dir=${dir}` : '/debts'} className="-ml-1 inline-flex min-h-[44px] items-center gap-1 pr-3 text-base font-semibold text-brand">
      <Icon name="chevron" size={18} className="rotate-180" />
      Все долги
    </Link>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <>
      <BackLink />
      <PageHeader title="Долг" />
      <EmptyState
        icon="alert"
        title={title}
        text={text}
        action={
          <Link to="/debts" className={buttonClasses('primary', 'lg')}>
            К списку долгов
          </Link>
        }
      />
    </>
  );
}

/**
 * Страница долга: остаток крупно, оплачено, переплата, срок; платежи с удалением; «Добавить платёж»; закрыть / открыть снова,
 * в архив, правка. «Долг не найден» и «суммы слишком большие» — понятные экраны, а не белый экран.
 */
export default function DebtDetailPage() {
  const { id = '' } = useParams();
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const view = useDebtView(id);
  const lines = useDebtLines(id);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleting, setDeleting] = useState<DebtPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const today = useToday();

  if (view === undefined || lines === undefined) {
    return (
      <>
        <BackLink />
        <PageHeader title="Долг" />
        <p role="status" className="py-10 text-center text-muted">
          Загрузка…
        </p>
      </>
    );
  }
  if (!view.ok) {
    return view.error === 'not-found' ? (
      <Notice title="Долг не найден" text="Возможно, его удалили или ссылка устарела. Вернитесь к списку долгов." />
    ) : (
      <Notice title="Не удалось посчитать" text={view.message} />
    );
  }

  const { debt, state } = view;
  const archived = debt.archivedAt !== null;
  const closed = debt.closedAt !== null;
  const base = lines.base ?? debt.currency;

  const run = async (action: () => Promise<unknown>, fallback: string, done?: () => void) => {
    if (busy) return false;
    setBusy(true);
    try {
      await action();
      done?.();
      return true;
    } catch (e) {
      console.error(fallback, e);
      toast.error(humanError(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggleClosed = async () => {
    const ok = await run(
      () => (closed ? store.debts.reopen(debt.id) : store.debts.close(debt.id)),
      closed ? 'Не удалось открыть долг снова' : 'Не удалось закрыть долг',
      () => toast.success(closed ? 'Долг открыт снова' : 'Долг закрыт'),
    );
    if (ok) setDialog(null);
  };

  const archive = () =>
    run(
      () => store.debts.archive(debt.id),
      'Не удалось убрать долг в архив',
      () => {
        toast.success(`Долг «${debt.counterparty}» убран в архив`, {
          durationMs: UNDO_MS,
          action: {
            label: 'Вернуть',
            onClick: () => {
              store.debts.restore(debt.id).catch((e: unknown) => {
                console.error('Не удалось вернуть долг из архива:', e);
                toast.error('Не удалось вернуть долг. Его можно вернуть из архива на экране «Долги».');
              });
            },
          },
        });
        navigate(`/debts?dir=${debt.direction}`, { replace: true });
      },
    );

  const unarchive = () =>
    run(
      () => store.debts.restore(debt.id),
      'Не удалось вернуть долг из архива',
      () => toast.success('Долг возвращён из архива'),
    );

  const deleteDebt = async (mode: DebtDeleteMode) => {
    let deletion: DebtDeletion | null = null;
    const ok = await run(
      async () => {
        deletion = await store.debts.softDelete(debt.id, mode);
      },
      'Не удалось удалить долг. Ничего не изменилось — попробуйте ещё раз.',
    );
    if (!ok || deletion === null) return;
    const done: DebtDeletion = deletion;
    setDialog(null);
    toastWithUndo(toast, 'Долг удалён', () => store.debts.undoDelete(done), 'Долг возвращён');
    navigate(`/debts?dir=${debt.direction}`, { replace: true });
  };

  const removePayment = async () => {
    const p = deleting;
    if (!p) return;
    const ok = await run(
      () => store.transactions.softDelete(p.txId),
      'Не удалось удалить платёж. Ничего не изменилось — попробуйте ещё раз.',
      () =>
        toastWithUndo(toast, 'Платёж удалён', () => store.transactions.restore(p.txId), 'Платёж возвращён'),
    );
    if (ok) setDeleting(null);
  };

  const openTx = (txId: string) => navigate(`/edit/${txId}`, { state: { background: location } });

  return (
    <>
      <BackLink dir={debt.direction === 'borrowed' ? 'borrowed' : undefined} />
      <PageHeader title={debt.counterparty} subtitle={`${DIRECTION_LABEL[debt.direction]} · ${debt.currency}`} />

      {archived && (
        <p role="status" className="mb-3 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
          Долг в архиве: он не виден в списках и итогах. Остаток и платежи сохранены.
        </p>
      )}

      <DebtSummaryCard debt={debt} state={state} today={today} />

      <div className="mt-4 flex flex-col gap-2">
        {!archived && (
          <Button size="lg" icon="plus" variant={state.settled && !closed ? 'secondary' : 'primary'} onClick={() => setDialog('payment')}>
            Добавить платёж
          </Button>
        )}
        {!archived && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" icon="edit" onClick={() => setDialog('edit')}>
              Править
            </Button>
            {closed ? (
              <Button variant="secondary" loading={busy} onClick={() => void toggleClosed()}>
                Открыть снова
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setDialog('close')}>
                Закрыть долг
              </Button>
            )}
          </div>
        )}
        {archived ? (
          <Button variant="secondary" loading={busy} onClick={() => void unarchive()}>
            Вернуть из архива
          </Button>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={() => void archive()}>
            В архив
          </Button>
        )}
      </div>

      <IssuesNotice issues={state.issues} txs={lines.txs} wallets={lines.wallets} onOpen={openTx} />
      <PaymentsList
        payments={state.payments}
        currency={debt.currency}
        txs={lines.txs}
        wallets={lines.wallets}
        today={today}
        readOnly={archived}
        onDelete={setDeleting}
      />

      <div className="mt-8 flex justify-center">
        <Button variant="ghost" className="!text-danger" disabled={busy} onClick={() => setDialog('delete')}>
          Удалить долг
        </Button>
      </div>

      <DeleteDebtDialog
        open={dialog === 'delete'}
        debtId={debt.id}
        counterparty={debt.counterparty}
        txs={lines.txs}
        wallets={lines.wallets}
        base={base}
        loading={busy}
        onConfirm={(mode) => void deleteDebt(mode)}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'close'}
        title="Закрыть долг?"
        message={
          state.remainingMinor > 0
            ? `Остаток ${endSentence(formatMinor(state.remainingMinor, debt.currency))} Он останется в истории, но долг уйдёт из открытых и из итогов. Деньги в кошельках не меняются. Закрытый долг можно открыть снова.`
            : 'Долг погашен полностью. Он перейдёт в «Закрытые»; открыть его снова можно в любой момент.'
        }
        confirmLabel="Закрыть долг"
        loading={busy}
        onConfirm={() => void toggleClosed()}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        danger
        title="Удалить платёж?"
        message={
          deleting
            ? `Платёж ${endSentence(`${formatMinor(deleting.amountMinor, debt.currency)} от ${ruDateShort(deleting.occurredOn)}`)} Он пропадёт из списка, остаток долга и остаток кошелька пересчитаются. Сразу после удаления его можно вернуть кнопкой «Отменить».`
            : undefined
        }
        confirmLabel="Удалить"
        loading={busy}
        onConfirm={() => void removePayment()}
        onCancel={() => setDeleting(null)}
      />

      {dialog === 'payment' && <PaymentSheet debt={debt} state={state} base={base} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <DebtSheet debt={debt} paidMinor={state.paidMinor} base={base} onClose={() => setDialog(null)} />}
    </>
  );
}
