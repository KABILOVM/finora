import { useMemo, useRef, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useStore, ValidationError } from '@/db';
import type { IsoDate, LocalRow, Minor, RecurringRule } from '@/domain/types';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { FxNotice } from '@/features/transactions/FxNotice';
import { ReceivedField } from '@/features/transactions/ReceivedField';
import { GENERIC_SAVE_ERROR, NOTE_MAX, ruDate } from '@/features/transactions/txForm';
import { fxViewFor } from '@/recurring/fx';
import {
  initialPostForm,
  postErrorField,
  postNeedsFx,
  preparePost,
  type PostErrors,
  type PostFormState,
} from '@/recurring/postForm';
import { buildReceivedView, receivedAmount } from '@/recurring/received';
import { viewRule } from '@/recurring/ruleView';
import { relativeText } from '@/recurring/upcoming';
import { useRateService, useRates } from '@/rates/hooks';
import { RuleIcon } from './RuleIcon';
import type { RecurringLookups } from './useRecurringData';

export interface PostSheetProps {
  rule: LocalRow<RecurringRule>;
  /** Дата платежа из расписания — на неё будет записана операция. */
  date: IsoDate;
  today: IsoDate;
  lookups: RecurringLookups;
  onClose: () => void;
}

/**
 * «Провести платёж»: сумма и заметка берутся из правила и до подтверждения правятся. Дата не меняется (от неё зависит
 * id операции: так один платёж нельзя провести дважды). Кошелёк не в базовой валюте — нужен курс, как в обычной операции.
 */
export function PostSheet({ rule, date, today, lookups, onClose }: PostSheetProps) {
  const store = useStore();
  const toast = useToast();
  const { getRate } = useRates();
  const rateService = useRateService();
  const { base } = lookups;
  const wallet = lookups.wallets.get(rule.walletId);
  const toWallet = rule.toWalletId === null ? undefined : lookups.wallets.get(rule.toWalletId);

  const [initial] = useState(() => initialPostForm(rule, wallet?.currency, toWallet?.currency));
  const [form, setForm] = useState<PostFormState>(initial);
  const [errors, setErrors] = useState<PostErrors>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const isTransfer = rule.kind === 'transfer';
  const received = useMemo(
    () =>
      buildReceivedView({
        kind: rule.kind,
        wallet,
        toWallet,
        amountMinor: form.amountMinor,
        override: form.receivedOverride,
        feeOpen: form.feeOpen,
        getRate,
      }),
    [rule.kind, wallet, toWallet, form.amountMinor, form.receivedOverride, form.feeOpen, getRate],
  );
  const toAmount = receivedAmount(received, form.amountMinor).toAmount;
  const need = postNeedsFx(rule, form, toAmount, wallet, toWallet, base);
  const fx = useMemo(() => fxViewFor(need, wallet, base, getRate), [need, wallet, base, getRate]);

  const view = viewRule(rule, lookups.wallets, lookups.categories, base);
  const set = (patch: Partial<PostFormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    // подсказки об ошибках устаревают вместе с полем, которое поправили
    setErrors((e) => {
      const next: PostErrors = { ...e, form: undefined };
      if ('receivedOverride' in patch || 'feeOpen' in patch) next.toAmount = undefined;
      if ('note' in patch) next.note = undefined;
      if ('rateText' in patch) next.rate = undefined;
      return next;
    });
  };

  const setAmount = (value: Minor | null) => {
    setForm((f) => {
      const next: PostFormState = { ...f, amountMinor: value };
      // «Получено» идёт за суммой, пока человек сам его не менял (иначе пара «списано / получено» молча разошлась бы)
      if (isTransfer && f.receivedOverride === initial.receivedOverride) {
        next.receivedOverride = value === rule.amountMinor ? initial.receivedOverride : undefined;
      }
      return next;
    });
    setErrors((e) => ({ ...e, amount: undefined, toAmount: undefined, form: undefined }));
  };

  const submit = async () => {
    if (busyRef.current) return;
    const prepared = preparePost({ rule, form, wallet, toWallet, base, received, fx });
    if (!prepared.ok) {
      setErrors(prepared.errors);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setErrors({});
    try {
      const tx = await store.transactions.createFromRule(rule.id, date, prepared.opts);
      if (tx.deletedAt !== null) {
        // Эту дату уже пропустили (на другом устройстве или в другой вкладке): операции нет, и молчать об этом нельзя.
        setErrors({ form: 'Этот платёж уже пропущен или удалён, поэтому в операции он не попал. Верните его в разделе «Пропущенные».' });
        return;
      }
      if (prepared.typedRate) {
        try {
          rateService.rememberEnteredRate(prepared.typedRate.from, prepared.typedRate.to, prepared.typedRate.rate);
        } catch (err) {
          console.error('Введённый курс не запомнен (платёж проведён):', err);
        }
      }
      toast.success(`Платёж проведён: ${view.title}`);
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) {
        setErrors({ [postErrorField(e.message, received !== null)]: e.message });
      } else {
        console.error('Не удалось провести платёж:', e);
        setErrors({ form: GENERIC_SAVE_ERROR });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const noteLength = form.note.trim().length;
  const dateText = relativeText(date, today);

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!busy}
      title="Провести платёж"
      footer={
        <div className="flex flex-col gap-2">
          {errors.form && (
            <p role="alert" className="text-sm font-medium text-danger">
              {errors.form}
            </p>
          )}
          <Button size="lg" fullWidth loading={busy} disabled={!wallet} onClick={() => void submit()}>
            Провести
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
          <RuleIcon view={view} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{view.title}</p>
            <p className="text-sm text-muted">
              Дата платежа: {ruDate(date)} ({dateText})
            </p>
          </div>
        </div>

        {!wallet && (
          <p role="alert" className="text-sm font-medium text-danger">
            Кошелёк этого платежа не найден. Откройте платёж в списке «Все правила» и выберите другой кошелёк.
          </p>
        )}

        <FieldGroup label={isTransfer ? 'Сумма списания' : 'Сумма'}>
          <AmountInput
            currency={wallet?.currency ?? base}
            value={form.amountMinor}
            onChange={setAmount}
            label={isTransfer ? 'Сумма списания' : 'Сумма'}
            tone={rule.kind === 'expense' ? 'expense' : rule.kind === 'income' ? 'income' : 'neutral'}
            showKeypad={false}
            error={errors.amount}
          />
        </FieldGroup>

        {isTransfer && received && (
          <ReceivedField
            view={received}
            amountMinor={form.amountMinor}
            onChange={(v) => set({ receivedOverride: v })}
            onUseSuggested={() => set({ receivedOverride: undefined })}
            onFeeOpen={(open) => set({ feeOpen: open, receivedOverride: undefined })}
            error={errors.toAmount}
          />
        )}

        <FxNotice fx={fx} amountMinor={form.amountMinor} rateText={form.rateText} onRateText={(rateText) => set({ rateText })} error={errors.rate} />

        <TextInput
          label="Заметка"
          hint={noteLength > NOTE_MAX - 50 && noteLength <= NOTE_MAX ? `${noteLength} из ${NOTE_MAX}` : 'Необязательно'}
          value={form.note}
          onChange={(e) => set({ note: e.target.value })}
          autoComplete="off"
          enterKeyHint="done"
          error={errors.note}
        />
      </div>
    </Sheet>
  );
}
