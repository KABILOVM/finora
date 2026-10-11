import { Card } from '@/components/Card';
import { cn } from '@/lib/cn';
import type { ImportPlan } from '@/import/types';
import { opsWord, ruDate } from './importText';

function Tile({ id, label, value, tone }: { id: string; label: string; value: number; tone?: 'income' | 'warning' }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd
        data-testid={`count-${id}`}
        className={cn('text-2xl font-bold tabular-nums', tone === 'income' && value > 0 && 'text-income', tone === 'warning' && value > 0 && 'text-warning')}
      >
        {value}
      </dd>
    </div>
  );
}

/** Итоги разбора файла: что добавится, что уже есть, что нужно проверить, что пропущено. */
export function SummaryTiles({ plan, fileName }: { plan: ImportPlan; fileName: string }) {
  const c = plan.counts;
  return (
    <Card className="flex flex-col gap-3" aria-label="Итоги разбора файла" role="region">
      <p className="truncate text-sm text-muted">
        Файл: <span className="font-semibold text-text">{fileName}</span>
      </p>
      <dl className="grid grid-cols-2 gap-2">
        <Tile id="add" label="Будет добавлено" value={c.add} tone="income" />
        <Tile id="exists" label="Уже есть" value={c.exists} />
        <Tile id="review" label="Нужно проверить" value={c.review} tone="warning" />
        <Tile id="skipped" label="Пропущено" value={c.skipped} />
      </dl>
      {plan.period && (
        <p className="text-sm text-muted">
          Операции с {ruDate(plan.period.from)} по {ruDate(plan.period.to)}.
        </p>
      )}
      {c.existsDeleted > 0 && (
        <p className="text-sm text-muted">
          Из «уже есть» {c.existsDeleted} {opsWord(c.existsDeleted)} вы удалили раньше: они не вернутся.
        </p>
      )}
      {c.waitRate > 0 && (
        <p className="text-sm font-medium text-warning">
          Ждут курса: {c.waitRate} {opsWord(c.waitRate)}. Укажите курс ниже, иначе они не добавятся.
        </p>
      )}
      {c.blocked > 0 && (
        <p className="text-sm font-medium text-danger">
          Нет кошелька: {c.blocked} {opsWord(c.blocked)}. Выберите кошелёк для счёта ниже, иначе они не добавятся.
        </p>
      )}
    </Card>
  );
}
