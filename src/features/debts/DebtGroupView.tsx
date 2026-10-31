import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActionMenu, type ActionMenuItem } from '@/components/ActionMenu';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { runWithoutModalAnchor } from '@/components/modalHistory';
import { Notice as Callout } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/Toast';
import { DEBT_OVERFLOW_MESSAGE, useRecurringRules, useStore } from '@/db';
import { isLivePlanOf } from '@/domain/debts';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode } from '@/domain/types';
import { humanError, toastWithUndo, UNDO_MS } from '@/features/transactions/txActions';
import { endSentence } from '@/features/transactions/txDisplay';
import { pluralRu } from '@/lib/plural';
import { useToday } from '@/recurring/useToday';
import { mergeCandidates } from './debtMatch';
import { DebtPartCard } from './DebtPartCard';
import type { DebtItem } from './debtSummary';
import { DIRECTION_LABEL } from './debtText';
import { DebtSummaryCard } from './DebtSummaryCard';
import { MergeDebtsSheet } from './MergeDebtsSheet';
import { PartPickerSheet, payableParts } from './PartPickerSheet';
import { PaymentSheet } from './PaymentSheet';

type Dialog = 'pick' | 'merge' | 'unmerge' | 'close' | null;

export interface DebtGroupViewProps {
  /** Объединённый долг: итог по составляющим, у каждой из них (parts) свои условия. */
  group: DebtItem;
  /** Долги списка (объединённый — одним элементом): для окна «Объединить». */
  items: readonly DebtItem[];
  base: CurrencyCode;
}

/**
 * Страница объединённого долга. Сверху ИТОГ (сумма, проценты, оплачено, остаток, ближайший срок), ниже — «Из чего состоит»: у каждой
 * составляющей свои проценты со ставкой и сроком, даты, срок возврата, платежи и планы. Платёж записывается в выбранную составляющую.
 * Правка, «Взял ещё», «Платить частями» и все платежи — на странице самой составляющей («Открыть»).
 */
export function DebtGroupView({ group, items, base }: DebtGroupViewProps) {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const today = useToday();
  const rules = useRecurringRules();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [paying, setPaying] = useState<DebtItem | null>(null);
  const [busy, setBusy] = useState(false);

  const { debt, state } = group;
  const parts = group.parts ?? [group];
  const archived = debt.archivedAt !== null;
  const closed = debt.closedAt !== null;
  const canMerge = !archived && mergeCandidates(items, debt).length > 0;
  const payable = payableParts(parts);
  const livePlans = (rules ?? []).filter((r) => parts.some((p) => isLivePlanOf(r, p.debt))).length;

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

  const unmerge = async () => {
    let res: { targetId: string; partIds: string[] } | null = null;
    const ok = await run(
      async () => {
        res = await store.debts.unmerge(debt.id);
      },
      'Не удалось разъединить долги. Ничего не изменилось — попробуйте ещё раз.',
    );
    if (!ok || res === null) return;
    const done: { targetId: string; partIds: string[] } = res;
    setDialog(null);
    toastWithUndo(toast, 'Долги разъединены', () => store.debts.merge(done.targetId, done.partIds), 'Объединение возвращено');
  };

  const toggleClosed = async () => {
    const ok = await run(
      () => (closed ? store.debts.reopen(debt.id, { withParts: true }) : store.debts.close(debt.id, { withParts: true })),
      closed ? 'Не удалось открыть долги снова' : 'Не удалось закрыть долги',
      () => toast.success(closed ? 'Долги открыты снова' : 'Долги закрыты'),
    );
    if (ok) setDialog(null);
  };

  const archive = () =>
    run(
      () => store.debts.archive(debt.id, { withParts: true }),
      'Не удалось убрать долги в архив',
      () => {
        toast.success(`Долг «${debt.counterparty}» убран в архив`, {
          durationMs: UNDO_MS,
          action: {
            label: 'Вернуть',
            onClick: () => {
              store.debts.restore(debt.id, { withParts: true }).catch((e: unknown) => {
                console.error('Не удалось вернуть долги из архива:', e);
                toast.error('Не удалось вернуть долг. Его можно вернуть из архива на экране «Долги».');
              });
            },
          },
        });
        runWithoutModalAnchor(() => navigate(`/debts?dir=${debt.direction}`, { replace: true }));
      },
    );

  const unarchive = () =>
    run(
      () => store.debts.restore(debt.id, { withParts: true }),
      'Не удалось вернуть долги из архива',
      () => toast.success('Долг возвращён из архива'),
    );

  const menu: ActionMenuItem[] = [];
  if (!archived) {
    if (canMerge) menu.push({ key: 'merge', label: 'Объединить…', hint: 'Добавить ещё долги', icon: 'transfer', onSelect: () => setDialog('merge') });
    menu.push({ key: 'unmerge', label: 'Разъединить', hint: 'Каждый снова станет отдельным долгом', icon: 'refresh', onSelect: () => setDialog('unmerge') });
    if (closed) menu.push({ key: 'reopen', label: 'Открыть снова', hint: 'Вернуть все долги в открытые', icon: 'refresh', onSelect: () => void toggleClosed() });
    else if (state !== null && !state.settled) menu.push({ key: 'close', label: 'Закрыть все долги', hint: 'Убрать из открытых и из итогов', icon: 'check', onSelect: () => setDialog('close') });
    menu.push({ key: 'archive', label: 'В архив', hint: 'Скрыть из списков и итогов, платежи сохранятся', icon: 'box', onSelect: () => void archive() });
  } else {
    menu.push({ key: 'unarchive', label: 'Вернуть из архива', icon: 'box', onSelect: () => void unarchive() });
  }

  return (
    <>
      <PageHeader
        title={debt.counterparty}
        subtitle={`${DIRECTION_LABEL[debt.direction]} · ${debt.currency} · объединено: ${parts.length}`}
        back={{ to: `/debts?dir=${debt.direction}`, label: 'Долги' }}
        actions={<ActionMenu items={menu} label="Ещё действия по долгу" title={`Долг: ${debt.counterparty}`} />}
      />

      {archived && (
        <p role="status" className="mb-3 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
          Долг в архиве: он не виден в списках и итогах. Остаток и платежи сохранены.
        </p>
      )}

      {state !== null ? (
        <DebtSummaryCard debt={debt} state={state} today={today} />
      ) : (
        <Callout tone="danger">{DEBT_OVERFLOW_MESSAGE}</Callout>
      )}
      {state !== null && !archived && !closed && state.settled && (
        <Callout
          tone="success"
          icon="check"
          className="mt-3"
          action={
            <Button variant="secondary" onClick={() => setDialog('close')}>
              Закрыть все долги
            </Button>
          }
        >
          Все долги погашены полностью. Закройте их, чтобы они не висели среди открытых.
        </Callout>
      )}

      {!archived && (
        <div className="mt-4 flex flex-col gap-2">
          <Button size="lg" icon="plus" disabled={payable.length === 0} onClick={() => setDialog('pick')}>
            Добавить платёж
          </Button>
        </div>
      )}

      <section aria-labelledby="debt-parts" className="mt-4" data-testid="debt-parts">
        <h2 id="debt-parts" className="mb-1 px-1 text-base font-semibold text-muted">
          Из чего состоит · {parts.length}
        </h2>
        <p className="mb-2 px-1 text-sm text-muted">У каждого долга свои проценты, срок, даты и платежи. Итог выше — их сумма.</p>
        <div className="flex flex-col gap-2">
          {parts.map((p, i) => (
            <DebtPartCard
              key={p.debt.id}
              item={p}
              rootName={debt.counterparty}
              today={today}
              rules={rules ?? []}
              own={i === 0}
              disabled={archived || busy}
              onPay={() => setPaying(p)}
            />
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={dialog === 'unmerge'}
        title="Разъединить долги?"
        message={`Каждый из ${parts.length} ${pluralRu(parts.length, 'долга', 'долгов', 'долгов')} снова станет отдельным долгом: суммы, проценты, платежи и планы остаются при нём. Сразу после этого можно нажать «Отменить».`}
        confirmLabel="Разъединить"
        loading={busy}
        onConfirm={() => void unmerge()}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'close'}
        title="Закрыть все долги?"
        message={
          state !== null && state.remainingMinor > 0
            ? `Остаток ${endSentence(formatMinor(state.remainingMinor, debt.currency))} Он останется в истории, но долги уйдут из открытых и из итогов. Деньги в кошельках не меняются.${livePlans > 0 ? ' Планы платежей остановятся; если открыть долги снова, они продолжатся.' : ''} Закрытые долги можно открыть снова.`
            : `Долги погашены полностью. Они перейдут в «Закрытые»; открыть их снова можно в любой момент.`
        }
        confirmLabel="Закрыть"
        loading={busy}
        onConfirm={() => void toggleClosed()}
        onCancel={() => setDialog(null)}
      />

      {dialog === 'pick' && (
        <PartPickerSheet
          parts={parts}
          rootName={debt.counterparty}
          onClose={() => setDialog(null)}
          onPick={(p) => {
            setDialog(null);
            setPaying(p);
          }}
        />
      )}
      {paying && paying.state && <PaymentSheet debt={paying.debt} state={paying.state} base={base} onClose={() => setPaying(null)} />}
      {dialog === 'merge' && <MergeDebtsSheet target={group} items={items} onClose={() => setDialog(null)} />}
    </>
  );
}
