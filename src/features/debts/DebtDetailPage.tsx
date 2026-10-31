import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ActionMenu, type ActionMenuItem } from '@/components/ActionMenu';
import { Button, buttonClasses } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { IconButton } from '@/components/IconButton';
import { runWithoutModalAnchor } from '@/components/modalHistory';
import { Notice as Callout } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/Toast';
import { useDebtView, useRecurringRules, useStore, type DebtDeleteMode, type DebtDeletion } from '@/db';
import { debtPlanStop, isLivePlanOf, planFinished, type DebtPayment } from '@/domain/debts';
import type { LocalRow, RecurringRule } from '@/domain/types';
import { formatMinor } from '@/domain/money';
import { RuleSheet } from '@/features/recurring/RuleSheet';
import { useRecurringLookups } from '@/features/recurring/useRecurringData';
import { humanError, toastWithUndo, UNDO_MS } from '@/features/transactions/txActions';
import { endSentence } from '@/features/transactions/txDisplay';
import { useToday } from '@/recurring/useToday';
import { mergeCandidates } from './debtMatch';
import { DebtGroupView } from './DebtGroupView';
import { DebtPlanCard } from './DebtPlanCard';
import { DebtSheet } from './DebtSheet';
import { DeleteDebtDialog } from './DeleteDebtDialog';
import { DebtSummaryCard } from './DebtSummaryCard';
import { DIRECTION_LABEL, PARTS_ACTION, ruDateShort, TOP_UP_ACTION } from './debtText';
import { MergeDebtsSheet } from './MergeDebtsSheet';
import { groupByPerson, personKey, reminderText } from './people';
import { EntriesList, IssuesNotice, PaymentsList } from './PaymentsList';
import { PayInPartsSheet } from './PayInPartsSheet';
import { PaymentSheet } from './PaymentSheet';
import { ReminderSheet } from './ReminderSheet';
import { TopUpSheet } from './TopUpSheet';
import { useDebtLines } from './useDebtLines';
import { useDebtsData } from './useDebtsData';

type Dialog = 'close' | 'payment' | 'topup' | 'merge' | 'edit' | 'delete' | 'remind' | 'parts' | null;

/** `?own=1` у главного долга объединения: показать только его самого, а не весь объединённый долг. */
const OWN_PARAM = 'own';

const backTo = (dir?: string) => ({ to: dir ? `/debts?dir=${dir}` : '/debts', label: 'Долги' });

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <>
      <PageHeader title="Долг" back={backTo()} />
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
  const all = useDebtsData(); // для «Объединить» и для объединённого долга: какие ещё долги подходят и из чего он состоит
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleting, setDeleting] = useState<DebtPayment | null>(null);
  const [editingPlan, setEditingPlan] = useState<LocalRow<RecurringRule> | null>(null);
  const [busy, setBusy] = useState(false);
  const today = useToday();
  const rules = useRecurringRules();
  const lookups = useRecurringLookups();

  if (view === undefined || lines === undefined || all === undefined) {
    return (
      <>
        <PageHeader title="Долг" back={backTo()} />
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
  // Объединённый долг: его страница — итог и составляющие со своими условиями. `?own=1` — только сам главный долг.
  const own = new URLSearchParams(location.search).has(OWN_PARAM);
  const groupItem = own ? undefined : all.items.find((it) => it.debt.id === debt.id && it.parts !== undefined);
  if (groupItem) return <DebtGroupView group={groupItem} items={all.items} base={base} />;
  // этот долг — составляющая чужого объединения (в списке её нет, она внутри главного долга) или главный долг, открытый «только сам»
  const rootItem = all.items.find((it) => it.debt.id !== debt.id && it.parts?.some((p) => p.debt.id === debt.id)) ?? null;
  const ownOfGroup = own ? (all.items.find((it) => it.debt.id === debt.id && it.parts !== undefined) ?? null) : null;
  const mergeTarget = all.items.find((it) => it.debt.id === debt.id) ?? null;
  const canMerge = !archived && mergeTarget !== null && mergeCandidates(all.items, debt).length > 0;
  // «Напомнить» — только по открытому долгу «мне должны»; «Все долги человека» — если у него есть и другие открытые долги
  const ownItem = all.every.find((it) => it.debt.id === debt.id) ?? null;
  const remind = ownItem !== null && !archived && !closed ? reminderText({ name: debt.counterparty, open: [ownItem] }, today) : null;
  const key = personKey(debt.counterparty);
  const person = groupByPerson(all.items).find((p) => p.key === key);
  const hasOthers = person !== undefined && person.open.some((it) => it.debt.id !== debt.id);
  const plans = (rules ?? []).filter((r) => isLivePlanOf(r, debt));
  // при закрытии остановятся планы, которые сейчас идут
  const running = plans.filter((r) => debtPlanStop(r, debt, state) === null && !planFinished(r, today)).length;
  const planNote =
    running === 0
      ? ''
      : running === 1
        ? ' План платежей по долгу остановится; если открыть долг снова, он продолжится.'
        : ` Планы платежей по долгу (${running}) остановятся; если открыть долг снова, они продолжатся.`;

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
        // меню «⋯» уже закрылось и снимает свою запись истории: переходим, когда она снята, иначе возврат занесёт на эту же страницу
        runWithoutModalAnchor(() => navigate(`/debts?dir=${debt.direction}`, { replace: true }));
      },
    );

  const leaveGroup = async () => {
    let res: { targetId: string; partIds: string[] } | null = null;
    const ok = await run(
      async () => {
        res = await store.debts.unmerge(debt.id);
      },
      'Не удалось вывести долг из объединения. Ничего не изменилось — попробуйте ещё раз.',
    );
    if (!ok || res === null) return;
    const done: { targetId: string; partIds: string[] } = res;
    toastWithUndo(toast, 'Долг вышел из объединения', () => store.debts.merge(done.targetId, done.partIds), 'Объединение возвращено');
  };

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

  const stopPlan = (rule: LocalRow<RecurringRule>) =>
    run(
      () => store.recurring.archive(rule.id),
      'Не удалось остановить план',
      () => toastWithUndo(toast, 'План платежей остановлен', () => store.recurring.restore(rule.id), 'План возвращён'),
    );

  const openTx = (txId: string) => navigate(`/edit/${txId}`, { state: { background: location } });

  // Редкие действия — в меню «⋯»; на виду только то, что нужно чаще всего. «Закрыть долг» у погашенного долга вынесено на плашку ниже.
  const partsAvailable = !archived && !closed && state.remainingMinor > 0 && rules !== undefined && plans.length === 0;
  const menu: ActionMenuItem[] = [];
  if (!archived) {
    if (partsAvailable) menu.push({ key: 'parts', label: PARTS_ACTION[debt.direction], hint: 'Регулярные платежи до полного погашения', icon: 'repeat', onSelect: () => setDialog('parts') });
    if (canMerge) menu.push({ key: 'merge', label: 'Объединить…', hint: 'С другими долгами этого человека', icon: 'transfer', onSelect: () => setDialog('merge') });
    if (rootItem !== null) menu.push({ key: 'leave', label: 'Вывести из объединения', hint: 'Станет отдельным долгом, платежи и планы сохранятся', icon: 'refresh', onSelect: () => void leaveGroup() });
    if (closed) menu.push({ key: 'reopen', label: 'Открыть снова', hint: 'Вернуть долг в открытые', icon: 'refresh', onSelect: () => void toggleClosed() });
    else if (!state.settled) menu.push({ key: 'close', label: 'Закрыть долг', hint: 'Убрать из открытых и из итогов', icon: 'check', onSelect: () => setDialog('close') });
    menu.push({ key: 'archive', label: 'В архив', hint: 'Скрыть из списков и итогов, платежи сохранятся', icon: 'box', onSelect: () => void archive() });
  } else {
    menu.push({ key: 'unarchive', label: 'Вернуть из архива', icon: 'box', onSelect: () => void unarchive() });
  }
  menu.push({ key: 'delete', label: 'Удалить долг', hint: 'Вместе с записью; операции можно оставить или удалить', icon: 'trash', tone: 'danger', onSelect: () => setDialog('delete') });

  return (
    <>
      <PageHeader
        title={debt.counterparty}
        subtitle={`${DIRECTION_LABEL[debt.direction]} · ${debt.currency}`}
        back={backTo(debt.direction)}
        actions={
          <>
            {!archived && <IconButton icon="edit" label="Править" onClick={() => setDialog('edit')} />}
            <ActionMenu items={menu} label="Ещё действия по долгу" title={`Долг: ${debt.counterparty}`} />
          </>
        }
      />

      {archived && (
        <p role="status" className="mb-3 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
          Долг в архиве: он не виден в списках и итогах. Остаток и платежи сохранены.
        </p>
      )}

      {rootItem !== null && (
        <Callout
          tone="info"
          icon="transfer"
          className="mb-3"
          action={
            <Link to={`/debts/${rootItem.debt.id}`} className={buttonClasses('secondary')}>
              Весь объединённый долг
            </Link>
          }
        >
          Входит в объединённый долг «{rootItem.debt.counterparty}»: у него свои проценты, срок, даты и платежи.
        </Callout>
      )}
      {ownOfGroup !== null && (
        <Callout
          tone="info"
          icon="transfer"
          className="mb-3"
          action={
            <Link to={`/debts/${debt.id}`} className={buttonClasses('secondary')}>
              Весь объединённый долг
            </Link>
          }
        >
          Это один из долгов объединения. Здесь только он сам: свои проценты, срок, даты и платежи.
        </Callout>
      )}
      <DebtSummaryCard debt={debt} state={state} today={today} />
      {!archived && !closed && state.settled && (
        <Callout
          tone="success"
          icon="check"
          className="mt-3"
          action={
            <Button variant="secondary" onClick={() => setDialog('close')}>
              Закрыть долг
            </Button>
          }
        >
          Долг погашен полностью. Закройте его, чтобы он не висел среди открытых.
        </Callout>
      )}
      <DebtPlanCard debt={debt} state={state} plans={plans} today={today} busy={busy} onEdit={setEditingPlan} onStop={(r) => void stopPlan(r)} />

      <div className="mt-4 flex flex-col gap-2">
        {!archived && (
          <Button size="lg" icon="plus" variant={state.settled && !closed ? 'secondary' : 'primary'} onClick={() => setDialog('payment')}>
            Добавить платёж
          </Button>
        )}
        {!archived && (
          <Button variant="secondary" icon="plus" onClick={() => setDialog('topup')}>
            {TOP_UP_ACTION[debt.direction]}
          </Button>
        )}
        {remind !== null && (
          <Button variant="secondary" onClick={() => setDialog('remind')}>
            Напомнить о долге
          </Button>
        )}
        {hasOthers && (
          <Link to={`/debts/people/${encodeURIComponent(key)}`} className={buttonClasses('secondary')}>
            Все долги: {debt.counterparty}
          </Link>
        )}
      </div>

      <IssuesNotice issues={state.issues} txs={lines.txs} wallets={lines.wallets} onOpen={openTx} />
      <EntriesList entries={state.entries} currency={debt.currency} txs={lines.txs} wallets={lines.wallets} today={today} onOpen={openTx} />
      <PaymentsList
        payments={state.payments}
        currency={debt.currency}
        txs={lines.txs}
        wallets={lines.wallets}
        today={today}
        readOnly={archived}
        onDelete={setDeleting}
        onOpen={openTx}
      />

      <DeleteDebtDialog
        open={dialog === 'delete'}
        debtId={debt.id}
        counterparty={debt.counterparty}
        txs={lines.txs}
        wallets={lines.wallets}
        base={base}
        loading={busy}
        partsCount={ownOfGroup?.parts ? ownOfGroup.parts.length - 1 : 0}
        onConfirm={(mode) => void deleteDebt(mode)}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'close'}
        title="Закрыть долг?"
        message={
          state.remainingMinor > 0
            ? `Остаток ${endSentence(formatMinor(state.remainingMinor, debt.currency))} Он останется в истории, но долг уйдёт из открытых и из итогов. Деньги в кошельках не меняются. Закрытый долг можно открыть снова.${planNote}`
            : `Долг погашен полностью. Он перейдёт в «Закрытые»; открыть его снова можно в любой момент.${planNote}`
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
      {dialog === 'topup' && <TopUpSheet debt={debt} state={state} base={base} onClose={() => setDialog(null)} />}
      {dialog === 'parts' && <PayInPartsSheet debt={debt} state={state} onClose={() => setDialog(null)} />}
      {dialog === 'remind' && remind !== null && <ReminderSheet name={debt.counterparty} text={remind} onClose={() => setDialog(null)} />}
      {dialog === 'merge' && mergeTarget && <MergeDebtsSheet target={mergeTarget} items={all.items} onClose={() => setDialog(null)} />}
      {editingPlan && lookups && <RuleSheet rule={editingPlan} lookups={lookups} today={today} onClose={() => setEditingPlan(null)} />}
      {dialog === 'edit' && <DebtSheet debt={debt} paidMinor={state.paidMinor} base={base} onClose={() => setDialog(null)} />}
    </>
  );
}
