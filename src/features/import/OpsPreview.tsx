import { useMemo, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChipPicker } from '@/components/ChipPicker';
import { SectionHeader } from '@/components/SectionHeader';
import { cn } from '@/lib/cn';
import type { ImportPlan, OpStatus, PlanOp } from '@/import/types';
import { makeOpTitler, opAmountText, ruDate, STATUS_LABELS } from './importText';

/** Сколько строк видно сразу и на сколько добавляет «Показать ещё». */
export const OPS_FIRST = 20;
export const OPS_MORE = 50;

/** Порядок чипов-фильтров: сначала то, что добавится. */
const ORDER: readonly OpStatus[] = ['add', 'exists', 'wait-rate', 'review', 'blocked'];
const CHIP_TEXT: Record<OpStatus, string> = {
  add: 'Добавятся',
  exists: 'Уже есть',
  'wait-rate': 'Ждут курса',
  review: 'Проверить',
  blocked: 'Нет кошелька',
};

/** Свежие операции выше (как в «Операциях»); внутри одного дня — в порядке файла. */
const newestFirst = (a: PlanOp, b: PlanOp): number => (a.row.date < b.row.date ? 1 : a.row.date > b.row.date ? -1 : a.row.index - b.row.index);

/**
 * Операции файла как они будут выглядеть: по умолчанию — те, что добавятся, самые свежие сверху. Чипами переключается статус
 * («Уже есть», «Ждут курса»…), показ — по 20 и «Показать ещё 50». Кошелёк в строке — тот, что выбран выше, а не счёт из Дзен-мани.
 */
export function OpsPreview({ plan, forced, onForce }: { plan: ImportPlan; forced?: ReadonlySet<string>; onForce?: (id: string, on: boolean) => void }) {
  const { ops } = plan;
  const [picked, setPicked] = useState<OpStatus | null>(null);
  const [limit, setLimit] = useState(OPS_FIRST);
  const counts = useMemo(() => {
    const c: Record<OpStatus, number> = { add: 0, exists: 0, 'wait-rate': 0, review: 0, blocked: 0 };
    for (const op of ops) c[op.status]++;
    return c;
  }, [ops]);
  const present = ORDER.filter((s) => counts[s] > 0);
  // Выбранного статуса в плане уже нет (например, курс указан и «Ждут курса» опустело) — показываем первый из имеющихся
  const active: OpStatus | null = picked !== null && counts[picked] > 0 ? picked : (present[0] ?? null);
  const rows = useMemo(() => (active === null ? [] : ops.filter((op) => op.status === active).sort(newestFirst)), [ops, active]);
  const title = useMemo(() => makeOpTitler(plan), [plan]);
  if (active === null) return null;

  const shown = rows.slice(0, limit);
  const rest = rows.length - shown.length;
  return (
    <section aria-labelledby="ops-h" className="flex flex-col gap-2">
      <SectionHeader id="ops-h">Операции из файла</SectionHeader>
      <Card padding="none">
        {present.length > 1 && (
          <div className="border-b border-border px-4 py-3">
            <ChipPicker
              ariaLabel="Какие операции показать"
              value={active}
              options={present.map((s) => ({ value: s, label: `${CHIP_TEXT[s]} ${counts[s]}` }))}
              onChange={(s) => {
                setPicked(s as OpStatus);
                setLimit(OPS_FIRST);
              }}
            />
          </div>
        )}
        <ul className="divide-y divide-border" aria-label="Операции из файла">
          {shown.map((op) => {
            const st = STATUS_LABELS[op.status];
            const kind = op.row.kind;
            return (
              <li key={op.row.index} className="flex flex-col gap-1 px-4 py-3">
                {/* Название и сумма в одной строке, а если вместе не помещаются (узкий экран, крупные суммы) — сумма уходит под название */}
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5">
                  <span className="min-w-[10rem] flex-1 break-words font-medium">{title(op)}</span>
                  <span
                    className={cn('ml-auto shrink-0 whitespace-nowrap font-semibold tabular-nums', kind === 'expense' && 'text-expense', kind === 'income' && 'text-income')}
                  >
                    {opAmountText(op)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                  <span>{ruDate(op.row.date)}</span>
                  {op.status === 'exists' && op.byContent ? <Badge tone="warning">Возможный дубль</Badge> : <Badge tone={st.tone}>{st.text}</Badge>}
                  {op.status === 'add' && forced?.has(op.id) && <Badge tone="warning">Как дубль</Badge>}
                  {op.row.note && <span className="min-w-0 truncate">{op.row.note}</span>}
                </div>
                {/* Совпала по дате, сумме, кошельку и заметке с уже имеющейся: по умолчанию не добавляется, но человек решает сам */}
                {onForce && op.status === 'exists' && op.byContent && (
                  <div>
                    <Button variant="ghost" onClick={() => onForce(op.id, true)} aria-label={`Добавить всё равно: ${title(op)}`}>
                      Добавить всё равно
                    </Button>
                  </div>
                )}
                {onForce && op.status === 'add' && forced?.has(op.id) && (
                  <div>
                    <Button variant="ghost" onClick={() => onForce(op.id, false)} aria-label={`Не добавлять: ${title(op)}`}>
                      Не добавлять
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {rest > 0 && (
          <div className="flex flex-col gap-1 border-t border-border p-2">
            <Button variant="ghost" fullWidth onClick={() => setLimit((n) => n + OPS_MORE)}>
              Показать ещё {Math.min(OPS_MORE, rest)}
            </Button>
          </div>
        )}
      </Card>
      {rows.length > OPS_FIRST && (
        <p className="px-1 text-sm text-muted" data-testid="ops-shown">
          Показано {shown.length} из {rows.length}.
        </p>
      )}
    </section>
  );
}
