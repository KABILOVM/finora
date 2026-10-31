import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useRecurringRules, useStore } from '@/db';
import { isLivePlanOf } from '@/domain/debts';
import { formatMinor } from '@/domain/money';
import { humanError, toastWithUndo } from '@/features/transactions/txActions';
import { endSentence } from '@/features/transactions/txDisplay';
import { pluralRu } from '@/lib/plural';
import { mergeCandidates, mergePreview, normName } from './debtMatch';
import type { DebtItem } from './debtSummary';
import { interestTermsLine, ruDateShort } from './debtText';

export interface MergeDebtsSheetProps {
  /** Долг, в состав которого всё собирается (тот, что открыт на экране; у объединённого — он целиком). */
  target: DebtItem;
  /** Долги списка (объединённый — одним элементом): из них выбираются подходящие. */
  items: readonly DebtItem[];
  onClose: () => void;
}

const partsWord = (n: number) => `${n} ${pluralRu(n, 'долг', 'долга', 'долгов')}`;

/**
 * Объединение долгов: текущий долг + выбранные того же направления и валюты. Ничего не склеивается: у каждого долга остаются свои сумма,
 * проценты, ставка, срок, даты, платежи и планы, а в списке они идут одним долгом с общим итогом. Деньги в кошельках не двигаются.
 * После объединения — «Отменить». Заранее отмечены только открытые долги того же человека. Долг с другим именем объединяется лишь
 * после подтверждения: в списке будет одно имя (своё имя долг сохраняет внутри объединения).
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
  // долги с другим именем: в списке останется имя основного долга
  const otherNames = [
    ...new Map(
      candidates.filter((c) => !c.sameName && picked.has(c.item.debt.id)).map((c) => [normName(c.item.debt.counterparty), c.item.debt.counterparty.trim()] as const),
    ).values(),
  ];
  const namesText = otherNames.map((n) => `«${n}»`).join(', ');
  const otherCount = candidates.filter((c) => !c.sameName && picked.has(c.item.debt.id)).length; // долгов (а не имён) с другим именем
  const preview = chosen.length > 0 ? mergePreview([target, ...chosen]) : null;
  const cur = target.debt.currency;

  // Планы «Платить частями» остаются у своих долгов и идут по своим датам
  const rules = useRecurringRules();
  const everyone = [target, ...chosen].flatMap((it) => (it.parts ?? [it]).map((p) => p.debt));
  const chosenDebts = chosen.flatMap((it) => (it.parts ?? [it]).map((p) => p.debt));
  const plansFromOthers = (rules ?? []).filter((r) => chosenDebts.some((d) => isLivePlanOf(r, d))).length;
  const plansTotal = (rules ?? []).filter((r) => everyone.some((d) => isLivePlanOf(r, d))).length;
  const partsTotal = [target, ...chosen].reduce((n, it) => n + (it.parts?.length ?? 1), 0);

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
      toastWithUndo(toast, `Долги объединены: ${partsTotal}`, () => store.debts.undoMerge(res), 'Объединение отменено');
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
            onClick={() => (otherNames.length > 0 ? setConfirming(true) : void save())}
          >
            {chosen.length === 0 ? 'Выберите долги' : `Объединить: ${partsTotal} ${pluralRu(partsTotal, 'долг', 'долга', 'долгов')}`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted">
          Выбранные долги войдут в состав «{target.debt.counterparty}». Ничего не склеивается: у каждого остаются свои сумма, проценты, срок,
          даты, платежи и планы, а сверху будет общий итог. Деньги в кошельках не двигаются. Сразу после объединения его можно отменить.
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
              const terms = (item.parts ?? [item]).map((p) => interestTermsLine(p.debt.interestRateBp, p.debt.termMonths)).filter((t) => t !== '');
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
                        {item.parts && <span className="ml-2 text-xs font-medium text-muted">уже объединён: {partsWord(item.parts.length)}</span>}
                      </span>
                      {!sameName && (
                        <span className="block text-sm font-medium text-warning">
                          Другое имя: в списке останется «{target.debt.counterparty}», своё имя долг сохранит внутри
                        </span>
                      )}
                      <span className="block text-sm text-muted">
                        Остаток {item.state ? formatMinor(item.state.remainingMinor, cur) : '—'} · от {ruDateShort(d.openedOn)}
                        {d.dueOn !== null && ` · срок ${ruDateShort(d.dueOn)}`}
                        {d.closedAt !== null && ' · закрыт'}
                      </span>
                      {terms.length > 0 && <span className="block text-sm text-muted">Проценты: {terms.join('; ')}</span>}
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
            {preview.interestMinor > 0 && (
              <>
                <dt className="text-muted">Проценты</dt>
                <dd className="money text-right font-semibold">{formatMinor(preview.interestMinor, cur)}</dd>
              </>
            )}
            <dt className="text-muted">Оплачено</dt>
            <dd className="money text-right font-semibold">{formatMinor(preview.paidMinor, cur)}</dd>
            <dt className="text-muted">Остаток</dt>
            <dd className="money text-right font-semibold">{formatMinor(preview.remainingMinor, cur)}</dd>
            <dt className="text-muted">Ближайший срок</dt>
            <dd className="text-right font-semibold">{preview.dueOn ? ruDateShort(preview.dueOn) : 'без срока'}</dd>
          </dl>
        )}
        {plansFromOthers > 0 && (
          <p role="status" className="text-sm font-medium text-muted" data-testid="merge-plans">
            {plansTotal === 1 ? 'План платежей остаётся у своего долга' : `Планов платежей: ${plansTotal}, каждый остаётся у своего долга`} и идёт по своему расписанию.
          </p>
        )}
        {otherNames.length > 0 && (
          <p role="status" className="text-sm font-medium text-warning" data-testid="merge-names">
            {otherNames.length === 1 ? 'Имя' : 'Имена'} {namesText}: в списке останется только «{target.debt.counterparty}», а внутри объединённого долга{' '}
            {otherNames.length === 1 ? 'это имя сохранится' : 'эти имена сохранятся'}.
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
        message={`${otherCount > 1 ? 'Долги' : 'Долг'} ${namesText} ${otherCount > 1 ? 'войдут' : 'войдёт'} в состав «${target.debt.counterparty}»: в списке останется только это имя, а внутри объединённого долга ${otherNames.length > 1 ? 'имена сохранятся' : 'имя сохранится'}. Сразу после объединения его можно отменить.`}
        confirmLabel="Объединить"
        loading={saving}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    </Sheet>
  );
}
