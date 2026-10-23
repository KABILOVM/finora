import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useRecurringRules, useStore } from '@/db';
import { isLivePlanOf } from '@/domain/debts';
import { addMinor, formatMinor } from '@/domain/money';
import type { Minor } from '@/domain/types';
import { humanError, toastWithUndo } from '@/features/transactions/txActions';
import { endSentence } from '@/features/transactions/txDisplay';
import { pluralRu } from '@/lib/plural';
import { mergeCandidates, mergePreview, normName } from './debtMatch';
import type { DebtItem } from './debtSummary';
import { ruDateShort } from './debtText';

export interface MergeDebtsSheetProps {
  /** Долг, в который всё собирается (тот, что открыт на экране). */
  target: DebtItem;
  /** Все долги: из них выбираются подходящие. */
  items: readonly DebtItem[];
  onClose: () => void;
}

/** Общая переплата по долгам; null — сумма не помещается (предпросмотр сам скажет, что суммы слишком большие). */
function overpaidTotal(items: readonly DebtItem[]): Minor | null {
  let sum: Minor = 0;
  try {
    for (const it of items) if (it.state && it.state.overpaidMinor > 0) sum = addMinor(sum, it.state.overpaidMinor);
  } catch {
    return null;
  }
  return sum;
}

/**
 * Объединение долгов: текущий долг + выбранные того же направления и валюты. Платежи, выдачи и регулярные платежи переходят
 * к текущему долгу, остальные уходят из списка. Деньги в кошельках не двигаются. После объединения — «Отменить».
 * Заранее отмечены только открытые долги того же человека. Долг с другим именем объединяется лишь после подтверждения:
 * имя пропадёт из списка (в заметке остаётся «Объединён с: …»).
 */
export function MergeDebtsSheet({ target, items, onClose }: MergeDebtsSheetProps) {
  const store = useStore();
  const toast = useToast();
  const candidates = useMemo(() => mergeCandidates(items, target.debt), [items, target.debt]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(candidates.filter((c) => c.sameName && c.item.debt.closedAt === null).map((c) => c.item.debt.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const chosen = candidates.filter((c) => picked.has(c.item.debt.id)).map((c) => c.item);
  // долги с другим именем и имена, которые после объединения пропадут (одно имя — один раз, как его видно в первом долге)
  const lostDebts = candidates.filter((c) => !c.sameName && picked.has(c.item.debt.id)).map((c) => c.item.debt);
  const lostNames = [...new Map(lostDebts.map((d) => [normName(d.counterparty), d.counterparty.trim()] as const)).values()];
  const namesText = lostNames.map((n) => `«${n}»`).join(', ');
  const many = lostDebts.length > 1;
  const preview = chosen.length > 0 ? mergePreview([target, ...chosen]) : null;
  const cur = target.debt.currency;

  // Переплата: сколько её (в предпросмотре «остаток меньше суммы остатков» без числа непонятно)
  const overpaid = chosen.length > 0 ? overpaidTotal([target, ...chosen]) : null;

  // Планы «Платить частями» выбранных долгов переходят к этому долгу и идут все вместе
  const rules = useRecurringRules();
  const plansFromOthers = chosen.length > 0 ? (rules ?? []).filter((r) => chosen.some((c) => isLivePlanOf(r, c.debt))).length : 0;
  const plansTotal = plansFromOthers > 0 ? (rules ?? []).filter((r) => [target, ...chosen].some((c) => isLivePlanOf(r, c.debt))).length : 0;

  const toggle = (id: string) => {
    setError(null);
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (busy.current || chosen.length === 0) return;
    setConfirming(false);
    busy.current = true;
    setSaving(true);
    try {
      const res = await store.debts.merge(
        target.debt.id,
        chosen.map((c) => c.debt.id),
      );
      toastWithUndo(toast, `Долги объединены: ${chosen.length + 1}`, () => store.debts.undoMerge(res), 'Объединение отменено');
      onClose();
    } catch (e) {
      console.error('Не удалось объединить долги:', e);
      setError(`${endSentence(humanError(e, 'Не удалось объединить долги'))} Ничего не изменилось.`);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title="Объединить долги"
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <Button
            size="lg"
            fullWidth
            loading={saving}
            disabled={chosen.length === 0}
            onClick={() => (lostNames.length > 0 ? setConfirming(true) : void save())}
          >
            {chosen.length === 0 ? 'Выберите долги' : `Объединить: ${chosen.length + 1} ${pluralRu(chosen.length + 1, 'долг', 'долга', 'долгов')}`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted">
          Выбранные долги соберутся в «{target.debt.counterparty}»: суммы сложатся, платежи и выдачи перейдут сюда. Деньги в кошельках
          не двигаются. Сразу после объединения его можно отменить.
        </p>

        {candidates.length === 0 ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm" data-testid="merge-empty">
            Других долгов {target.debt.direction === 'lent' ? 'в «Мне должны»' : 'в «Я должен»'} в валюте {cur} нет. Объединять можно долги
            одного направления и одной валюты.
          </p>
        ) : (
          <ul aria-label="Долги для объединения" className="flex flex-col gap-2">
            {candidates.map(({ item, sameName }) => {
              const d = item.debt;
              const on = picked.has(d.id);
              return (
                <li key={d.id}>
                  <label className="flex min-h-[56px] cursor-pointer items-start gap-3 rounded-2xl border border-border p-3 has-[:checked]:border-brand has-[:checked]:bg-brand/5">
                    <input
                      type="checkbox"
                      checked={on}
                      aria-label={`${d.counterparty} от ${ruDateShort(d.openedOn)}`}
                      onChange={() => toggle(d.id)}
                      className="mt-0.5 h-6 w-6 shrink-0 accent-brand"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        {d.counterparty}
                        {sameName && <span className="ml-2 text-xs font-medium text-muted">тот же человек</span>}
                      </span>
                      {!sameName && (
                        <span className="block text-sm font-medium text-warning">
                          Другое имя: после объединения останется «{target.debt.counterparty}»
                        </span>
                      )}
                      <span className="block text-sm text-muted">
                        Остаток {item.state ? formatMinor(item.state.remainingMinor, cur) : '—'} · от {ruDateShort(d.openedOn)}
                        {d.dueOn !== null && ` · срок ${ruDateShort(d.dueOn)}`}
                        {d.closedAt !== null && ' · закрыт'}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {preview && (
          <dl aria-label="Что получится" data-testid="merge-preview" className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-2/70 p-3 text-sm">
            <dt className="text-muted">Сумма долга</dt>
            <dd className="money text-right font-semibold">{formatMinor(preview.principalMinor, cur)}</dd>
            <dt className="text-muted">Оплачено</dt>
            <dd className="money text-right font-semibold">{formatMinor(preview.paidMinor, cur)}</dd>
            <dt className="text-muted">Остаток</dt>
            <dd className="money text-right font-semibold">{formatMinor(preview.remainingMinor, cur)}</dd>
            <dt className="text-muted">Срок</dt>
            <dd className="text-right font-semibold">{preview.dueOn ? ruDateShort(preview.dueOn) : 'без срока'}</dd>
          </dl>
        )}
        {preview?.netted && (
          <p role="status" className="text-sm font-medium text-warning" data-testid="merge-netted">
            У одного из долгов есть переплата{overpaid !== null && overpaid > 0 ? ` ${formatMinor(overpaid, cur)}` : ''}: она засчитается в остаток других, поэтому общий
            остаток меньше суммы остатков.
          </p>
        )}
        {plansTotal > 0 && (
          <p role="status" className="text-sm font-medium text-warning" data-testid="merge-plans">
            {plansTotal === 1
              ? `План платежей перейдёт к долгу «${target.debt.counterparty}».`
              : `Планов платежей будет ${plansTotal}: все они пойдут по этому долгу, и платежи сложатся. Ненужные можно остановить на странице долга.`}
          </p>
        )}
        {lostNames.length > 0 && (
          <p role="status" className="text-sm font-medium text-warning" data-testid="merge-names">
            {lostNames.length === 1 ? 'Имя' : 'Имена'} {namesText} {lostNames.length === 1 ? 'пропадёт' : 'пропадут'} из списка: долг останется
            на имя «{target.debt.counterparty}». В заметке долга сохранится, с кем он объединён.
          </p>
        )}
        {chosen.length > 0 && preview === null && (
          <p role="alert" className="text-sm font-medium text-danger">
            Суммы слишком большие, чтобы их сложить.
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Объединить разных людей?"
        message={`${many ? 'Долги' : 'Долг'} ${namesText} ${many ? 'перейдут' : 'перейдёт'} к «${target.debt.counterparty}»: в списке останется только это имя. Сразу после объединения его можно отменить.`}
        confirmLabel="Объединить"
        loading={saving}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    </Sheet>
  );
}
