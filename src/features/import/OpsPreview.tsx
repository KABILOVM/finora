import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { cn } from '@/lib/cn';
import type { PlanOp } from '@/import/types';
import { opAmountText, ruDate, STATUS_LABELS } from './importText';

const SHOWN = 20;

function titleOf(op: PlanOp): string {
  const r = op.row;
  if (r.kind === 'transfer') return `Перевод: ${r.outcome!.account.name} → ${r.income!.account.name}`;
  const cat = r.categoryPath.join(' / ');
  const acc = (r.outcome ?? r.income)!.account.name;
  return `${cat === '' ? 'Без категории' : cat} · ${acc}`;
}

/** Первые операции файла как они будут выглядеть. */
export function OpsPreview({ ops }: { ops: readonly PlanOp[] }) {
  if (ops.length === 0) return null;
  const shown = ops.slice(0, SHOWN);
  return (
    <section aria-labelledby="ops-h" className="flex flex-col gap-2">
      <h2 id="ops-h" className="px-1 text-sm font-bold uppercase tracking-wide text-muted">
        Первые операции
      </h2>
      <Card padding="none">
        <ul className="divide-y divide-border" aria-label="Первые операции файла">
          {shown.map((op) => {
            const st = STATUS_LABELS[op.status];
            const kind = op.row.kind;
            return (
              <li key={op.row.index} className="flex flex-col gap-1 px-4 py-3">
                {/* Название и сумма в одной строке, а если вместе не помещаются (узкий экран, крупные суммы) — сумма уходит под название */}
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5">
                  <span className="min-w-[10rem] flex-1 break-words font-medium">{titleOf(op)}</span>
                  <span
                    className={cn('ml-auto shrink-0 whitespace-nowrap font-semibold tabular-nums', kind === 'expense' && 'text-expense', kind === 'income' && 'text-income')}
                  >
                    {opAmountText(op)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                  <span>{ruDate(op.row.date)}</span>
                  <Badge tone={st.tone}>{st.text}</Badge>
                  {op.row.note && <span className="min-w-0 truncate">{op.row.note}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      {ops.length > SHOWN && (
        <p className="px-1 text-sm text-muted">
          Показаны первые {SHOWN} из {ops.length}.
        </p>
      )}
    </section>
  );
}
