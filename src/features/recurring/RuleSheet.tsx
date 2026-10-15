import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import type { ChipOption } from '@/components/ChipPicker';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useStore, ValidationError } from '@/db';
import { sortByOrderThenName } from '@/db/sort';
import { rankCategories, rankWallets, usePopularity } from '@/features/transactions/popularity';
import type { CategoryKind, IsoDate, LocalRow, Minor, RecurringRule, TxKind } from '@/domain/types';
import { firstOtherWallet, GENERIC_SAVE_ERROR, pickDefaultWallet } from '@/features/transactions/txForm';
import { useScrollToError } from '@/features/transactions/useScrollToError';
import { useRates } from '@/rates/hooks';
import { requestAutoPostRun } from '@/recurring/autoPostState';
import { buildReceivedView } from '@/recurring/received';
import {
  checkRuleForm,
  emptyRuleForm,
  formFromRule,
  ruleErrorField,
  ruleFormPatch,
  type RuleFormErrors,
  type RuleFormState,
} from '@/recurring/ruleForm';
import { RuleFields } from './RuleFields';
import { ScheduleFields } from './ScheduleFields';
import type { RecurringLookups } from './useRecurringData';

export interface RuleSheetProps {
  /** null — создаём новый платёж. */
  rule: LocalRow<RecurringRule> | null;
  lookups: RecurringLookups;
  today: IsoDate;
  /** Новый платёж: поля, заполненные заранее (например, из подсказки «Похоже на подписки»). */
  prefill?: Partial<RuleFormState>;
  onClose: () => void;
}

/** Какие подсказки об ошибках устаревают, когда меняется поле. */
const CLEARS: Partial<Record<keyof RuleFormState, (keyof RuleFormErrors)[]>> = {
  kind: ['category', 'toWallet', 'toAmount', 'debt'],
  walletId: ['wallet', 'amount', 'toAmount', 'debt'],
  toWalletId: ['toWallet', 'toAmount'],
  amountMinor: ['amount', 'toAmount'],
  receivedOverride: ['toAmount'],
  feeOpen: ['toAmount'],
  categoryId: ['category'],
  debtId: ['debt'],
  note: ['note'],
  intervalText: ['interval'],
  startOn: ['startOn', 'endOn'],
  hasEnd: ['endOn'],
  endOn: ['endOn'],
};

/** Создание и правка регулярного платежа. Проверки делает репозиторий; понятные подсказки — тут, у своих полей. */
export function RuleSheet({ rule: liveRule, lookups, today, prefill, onClose }: RuleSheetProps) {
  const store = useStore();
  // Платёж, каким он был при открытии окна: от него считаются «что изменил человек». Живая копия могла уйти вперёд (правка с
  // другого устройства), и сравнивать с ней значило бы откатить чужую правку устаревшей формой.
  const [rule] = useState(liveRule);
  const toast = useToast();
  const { getRate } = useRates();
  const editing = rule !== null;
  const { base } = lookups;

  // Кошельки для выбора: не в архиве; уже выбранный в старом платеже остаётся, даже если его убрали в архив.
  const pop = usePopularity();
  const selectable = useMemo(() => {
    const list = sortByOrderThenName(
      [...lookups.wallets.values()].filter(
        (w) => w.deletedAt === null && (w.archivedAt === null || w.id === rule?.walletId || w.id === rule?.toWalletId),
      ),
    );
    return pop ? rankWallets(list, pop) : list;
  }, [lookups.wallets, rule?.walletId, rule?.toWalletId, pop]);

  const [initial] = useState<RuleFormState>(() =>
    rule
      ? formFromRule(rule, (id) => lookups.wallets.get(id)?.currency)
      : { ...emptyRuleForm(pickDefaultWallet(selectable, null, lookups.defaultWalletId), today), ...prefill },
  );
  const [form, setForm] = useState<RuleFormState>(initial);
  const [errors, setErrors] = useState<RuleFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const busyRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useScrollToError(bodyRef, errors);

  const wallet = form.walletId === null ? undefined : lookups.wallets.get(form.walletId);
  const toWallet = form.toWalletId === null ? undefined : lookups.wallets.get(form.toWalletId);
  const debt = form.debtId === null ? undefined : lookups.debts.get(form.debtId);
  const currency = wallet?.currency ?? base;
  const isTransfer = form.kind === 'transfer';

  const categories = useMemo<ChipOption[]>(() => {
    if (isTransfer) return [];
    const list = [...lookups.categories.values()].filter(
      (c) => c.deletedAt === null && c.kind === form.kind && (c.archivedAt === null || c.id === form.categoryId),
    );
    const ordered = pop && !isTransfer ? rankCategories(list, form.kind as CategoryKind, pop) : sortByOrderThenName(list);
    return ordered.map((c) => ({ value: c.id, label: c.name, icon: c.icon, color: c.color }));
  }, [lookups.categories, form.kind, form.categoryId, isTransfer, pop]);

  const debts = useMemo(
    () =>
      [...lookups.debts.values()]
        .filter((d) => d.deletedAt === null && ((d.closedAt === null && d.archivedAt === null) || d.id === form.debtId))
        .sort((a, b) => a.counterparty.localeCompare(b.counterparty, 'ru')),
    [lookups.debts, form.debtId],
  );

  const received = useMemo(
    () =>
      buildReceivedView({
        kind: form.kind,
        wallet,
        toWallet,
        amountMinor: form.amountMinor,
        override: form.receivedOverride,
        feeOpen: form.feeOpen,
        getRate,
      }),
    [form.kind, wallet, toWallet, form.amountMinor, form.receivedOverride, form.feeOpen, getRate],
  );

  const change = (patch: Partial<RuleFormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    const gone = (Object.keys(patch) as (keyof RuleFormState)[]).flatMap((k) => CLEARS[k] ?? []);
    setErrors((e) => {
      const next: RuleFormErrors = { ...e };
      delete next.form;
      for (const k of gone) delete next[k];
      return next;
    });
  };

  const onAmount = (value: Minor | null) => {
    setForm((f) => {
      const next: RuleFormState = { ...f, amountMinor: value };
      // «Получено» идёт за суммой, пока человек сам его не менял (иначе пара «списано / получено» молча разошлась бы)
      if (f.kind === 'transfer' && f.receivedOverride === initial.receivedOverride) {
        next.receivedOverride = rule && value === rule.amountMinor ? initial.receivedOverride : undefined;
      }
      return next;
    });
    setErrors((e) => ({ ...e, amount: undefined, toAmount: undefined, form: undefined }));
  };

  const onKind = (kind: TxKind) => {
    setForm((f) => {
      if (f.kind === kind) return f;
      const toWalletId =
        kind === 'transfer' && (f.toWalletId === null || f.toWalletId === f.walletId)
          ? firstOtherWallet(selectable, f.walletId)
          : f.toWalletId;
      return { ...f, kind, categoryId: null, debtId: kind === 'transfer' ? null : f.debtId, toWalletId, receivedOverride: undefined, feeOpen: false };
    });
    setErrors({});
  };

  const onWallet = (id: string) => {
    setForm((f) =>
      f.walletId === id
        ? f
        : {
            ...f,
            walletId: id,
            toWalletId: f.toWalletId === id ? firstOtherWallet(selectable, id) : f.toWalletId,
            receivedOverride: undefined,
            feeOpen: false,
          },
    );
    setErrors((e) => ({ ...e, wallet: undefined, amount: undefined, toAmount: undefined, debt: undefined, form: undefined }));
  };

  const onToWallet = (id: string) => change({ toWalletId: id, receivedOverride: undefined, feeOpen: false });

  const save = async () => {
    if (busyRef.current) return;
    const check = checkRuleForm(form, { wallet, toWallet, debt, received });
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setErrors({});
    try {
      if (!rule) {
        await store.recurring.create(check.input);
      } else {
        const patch = ruleFormPatch(check.input, rule);
        if (Object.keys(patch).length > 0) await store.recurring.update(rule.id, patch);
      }
      toast.success(editing ? 'Платёж сохранён' : 'Платёж добавлен');
      onClose();
      // Платёж «Проводить само» на сегодня проведётся сразу, а не при следующем открытии приложения.
      requestAutoPostRun();
    } catch (e) {
      if (e instanceof ValidationError) {
        setErrors({ [ruleErrorField(e.message)]: e.message });
      } else {
        console.error('Не удалось сохранить регулярный платёж:', e);
        setErrors({ form: GENERIC_SAVE_ERROR });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!rule || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await store.recurring.archive(rule.id);
      setArchiving(false);
      onClose();
      toast.success('Платёж убран в архив', {
        durationMs: 8000,
        action: {
          label: 'Вернуть',
          onClick: () => {
            store.recurring.restore(rule.id).then(
              () => toast.success('Платёж возвращён'),
              (e: unknown) => toast.error(e instanceof ValidationError ? e.message : 'Не удалось вернуть платёж из архива'),
            );
          },
        },
      });
    } catch (e) {
      setArchiving(false);
      setErrors({ form: e instanceof ValidationError ? e.message : 'Не удалось убрать платёж в архив. Данные не изменены.' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        dismissible={!busy}
        title={editing ? 'Правка платежа' : 'Новый регулярный платёж'}
        footer={
          <div className="flex flex-col gap-2">
            {errors.form && (
              <p role="alert" className="text-sm font-medium text-danger">
                {errors.form}
              </p>
            )}
            <Button size="lg" fullWidth loading={busy} onClick={() => void save()}>
              Сохранить
            </Button>
            {editing && (
              <Button variant="ghost" fullWidth disabled={busy} onClick={() => setArchiving(true)}>
                Убрать в архив
              </Button>
            )}
          </div>
        }
      >
        <div ref={bodyRef} className="flex flex-col gap-4">
          <RuleFields
            form={form}
            errors={errors}
            wallets={selectable}
            categories={categories}
            debts={debts}
            received={received}
            currency={currency}
            onChange={change}
            onAmount={onAmount}
            onKind={onKind}
            onWallet={onWallet}
            onToWallet={onToWallet}
          />
          <ScheduleFields form={form} errors={errors} today={today} onChange={change} />
        </div>
      </Sheet>
      <ConfirmDialog
        open={archiving}
        loading={busy}
        title="Убрать платёж в архив?"
        confirmLabel="В архив"
        message="Платежи по нему перестанут появляться в «Предстоящих» и не будут проводиться сами. Уже записанные операции останутся. Платёж можно вернуть из архива."
        onConfirm={() => void archive()}
        onCancel={() => !busy && setArchiving(false)}
      />
    </>
  );
}
