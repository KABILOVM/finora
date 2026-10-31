import { Sheet } from '@/components/Sheet';
import { formatMinor } from '@/domain/money';
import { cn } from '@/lib/cn';
import type { DebtItem } from './debtSummary';
import { interestTermsLine, ruDateShort } from './debtText';
import { partTitle } from './DebtPartCard';

export interface PartPickerSheetProps {
  /** Составляющие объединённого долга (свои долги). */
  parts: readonly DebtItem[];
  rootName: string;
  onPick: (part: DebtItem) => void;
  onClose: () => void;
}

/** Части, по которым ещё есть что платить: ближайший срок первым (без срока — в конце), затем по дате долга. */
export function payableParts(parts: readonly DebtItem[]): DebtItem[] {
  return parts
    .filter((it) => it.state !== null && it.debt.closedAt === null && it.state.remainingMinor > 0)
    .sort((a, b) => {
      if (a.debt.dueOn !== b.debt.dueOn) return a.debt.dueOn === null ? 1 : b.debt.dueOn === null ? -1 : a.debt.dueOn < b.debt.dueOn ? -1 : 1;
      return a.debt.openedOn < b.debt.openedOn ? -1 : a.debt.openedOn > b.debt.openedOn ? 1 : 0;
    });
}

/**
 * «Какой долг платите?»: платёж по объединённому долгу всегда идёт в одну из составляющих (у каждой свои проценты и срок).
 * Выбирает человек; первой стоит составляющая с ближайшим сроком. Нажатие сразу открывает платёж по ней.
 */
export function PartPickerSheet({ parts, rootName, onPick, onClose }: PartPickerSheetProps) {
  const list = payableParts(parts);
  return (
    <Sheet open onClose={onClose} title="Какой долг платите?">
      <div className="flex flex-col gap-2">
        <p className="text-muted">Платёж записывается в один из долгов объединения: у каждого свои проценты и срок.</p>
        {list.length === 0 ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm" data-testid="pick-empty">
            Платить больше нечего: все части погашены или закрыты.
          </p>
        ) : (
          <ul aria-label="Долги объединения" className="flex flex-col gap-2">
            {list.map((it, i) => {
              const terms = interestTermsLine(it.debt.interestRateBp, it.debt.termMonths);
              return (
                <li key={it.debt.id}>
                  <button
                    type="button"
                    onClick={() => onPick(it)}
                    className={cn(
                      'flex min-h-[56px] w-full items-start justify-between gap-3 rounded-2xl border border-border p-3 text-left hover:bg-surface-2 active:bg-border/60',
                      i === 0 && 'border-brand',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">{partTitle(it, rootName)}</span>
                      <span className="block text-sm text-muted">
                        {it.debt.dueOn !== null ? `срок ${ruDateShort(it.debt.dueOn)}` : 'без срока'}
                        {i === 0 && it.debt.dueOn !== null && ' · ближайший'}
                        {terms !== '' && ` · ${terms}`}
                      </span>
                    </span>
                    <span className="money shrink-0 text-right font-semibold">
                      <span className="sr-only">Остаток: </span>
                      {formatMinor(it.state!.remainingMinor, it.debt.currency)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
