import { useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { Glyph } from '@/components/Glyph';
import { MoneyText } from '@/components/MoneyText';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { Switch } from '@/components/Switch';
import { useToast } from '@/components/Toast';
import { useBalances, useStore } from '@/db';
import { formatMinor } from '@/domain/money';
import type { LocalRow, Wallet } from '@/domain/types';
import { humanError, toastWithUndo } from '@/features/transactions/txActions';
import { pluralRu } from '@/lib/plural';
import { useRates } from '@/rates/hooks';
import { AdjustmentError, writeAdjustment } from './adjust';
import { rowDiff, type RowDiff } from './reconcileAll';

interface Entry {
  actual: number | null;
  negative: boolean;
}

const EMPTY: Entry = { actual: null, negative: false };

function Status({ diff, currency }: { diff: RowDiff; currency: string }) {
  if (diff.kind === 'skip') return null;
  if (diff.kind === 'overflow') return <p className="mt-1 text-sm font-medium text-danger">Сумма слишком велика для расчёта.</p>;
  if (diff.kind === 'match') return <p className="mt-1 text-sm font-medium text-income">Совпадает</p>;
  const amount = formatMinor(Math.abs(diff.diffMinor), currency);
  return (
    <p className="mt-1 text-sm font-medium text-warning" data-testid="recon-diff">
      {diff.diffMinor > 0 ? `В приложении меньше на ${amount}: запишем +${amount}` : `В приложении больше на ${amount}: запишем −${amount}`}
    </p>
  );
}

/**
 * «Сверить все кошельки»: на одном экране все кошельки с остатком в приложении; человек вводит, сколько на самом деле (в банке или
 * в кошельке), и одной кнопкой записывает «Корректировку остатка» по каждому, где есть расхождение. Пустые строки пропускаются.
 * Корректировка видна в истории, но не доход и не расход; всё отменяется одним «Отменить».
 */
export function ReconcileAllSheet({ wallets, onClose }: { wallets: readonly LocalRow<Wallet>[]; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const balances = useBalances();
  const { getRate } = useRates();
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const entryOf = (id: string): Entry => entries[id] ?? EMPTY;
  const patch = (id: string, next: Partial<Entry>) => setEntries((cur) => ({ ...cur, [id]: { ...(cur[id] ?? EMPTY), ...next } }));

  const rows = wallets.map((w) => {
    const app = balances?.get(w.id) ?? 0;
    const e = entryOf(w.id);
    return { w, app, e, diff: balances ? rowDiff(app, e.actual, e.negative) : ({ kind: 'skip' } as RowDiff) };
  });
  const toWrite = rows.filter((r): r is typeof r & { diff: Extract<RowDiff, { kind: 'diff' }> } => r.diff.kind === 'diff');

  const apply = async () => {
    if (toWrite.length === 0 || busy) return;
    setBusy(true);
    setFailed(null);
    const written: string[] = [];
    const problems: string[] = [];
    try {
      for (const r of toWrite) {
        try {
          const row = await writeAdjustment(store, r.w, r.diff.diffMinor, getRate);
          written.push(row.id);
          setEntries((cur) => ({ ...cur, [r.w.id]: EMPTY }));
        } catch (e) {
          problems.push(`${r.w.name}: ${e instanceof AdjustmentError ? e.message : humanError(e, 'не удалось записать')}`);
        }
      }
      if (written.length > 0) {
        const n = written.length;
        toastWithUndo(
          toast,
          `Записано ${n} ${pluralRu(n, 'корректировка', 'корректировки', 'корректировок')}`,
          async () => {
            for (const id of written) await store.transactions.softDelete(id);
          },
          'Корректировки отменены',
        );
      }
      if (problems.length > 0) setFailed(problems.join(' '));
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  const n = toWrite.length;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Сверить все кошельки"
      footer={
        <div className="flex flex-col gap-2">
          <Button onClick={() => void apply()} disabled={n === 0} loading={busy} fullWidth>
            {n === 0 ? 'Введите, сколько на самом деле' : `Записать корректировки · ${n}`}
          </Button>
        </div>
      }
    >
      <p className="mb-2 text-sm text-muted">
        Введите, сколько сейчас в каждом кошельке; пустые строки пропускаются. Расхождения запишутся «Корректировкой остатка»: в истории она видна, но
        доходом или расходом не считается.
      </p>
      {failed && (
        <Notice tone="warning" role="alert" className="mb-3">
          {failed}
        </Notice>
      )}
      {!balances && <p className="py-6 text-center text-muted">Считаем…</p>}
      <ul className="flex flex-col divide-y divide-border">
        {balances && rows.map(({ w, app, e, diff }) => (
          <li key={w.id} className="py-3" data-testid={`recon-${w.id}`}>
            <div className="mb-2 flex items-center gap-2.5">
              <Glyph value={w.icon} color={w.color} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{w.name}</p>
                <p className="text-sm text-muted">
                  В приложении: <MoneyText minor={app} currency={w.currency} tone="none" className="font-semibold text-text" />
                </p>
              </div>
            </div>
            <AmountInput
              currency={w.currency}
              value={e.actual}
              onChange={(v) => patch(w.id, { actual: v })}
              label={`Сколько на самом деле: ${w.name}`}
              showKeypad={false}
              compact
              dense
            />
            {app < 0 && (
              <div className="mt-1 flex items-center justify-between gap-3 text-sm">
                <span id={`recon-neg-${w.id}`}>Минус (я должен банку)</span>
                <Switch checked={e.negative} onChange={(v) => patch(w.id, { negative: v })} labelledBy={`recon-neg-${w.id}`} />
              </div>
            )}
            <Status diff={diff} currency={w.currency} />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
