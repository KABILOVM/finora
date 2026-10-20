import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Notice } from '@/components/Notice';
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

export interface SummaryTilesProps {
  plan: ImportPlan;
  fileName: string;
  /** «Другой файл»: вернуться к выбору файла. */
  onBack: () => void;
}

/** Итоги разбора файла: что добавится, что уже есть, что нужно проверить, что пропущено; что мешает добавить остальное. */
export function SummaryTiles({ plan, fileName, onBack }: SummaryTilesProps) {
  const c = plan.counts;
  return (
    <Card className="flex flex-col gap-3" aria-label="Итоги разбора файла" role="region">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm text-muted">
          Файл: <span className="font-semibold text-text">{fileName}</span>
        </p>
        <Button variant="ghost" className="shrink-0" onClick={onBack}>
          Другой файл
        </Button>
      </div>
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
        <Notice tone="warning" role="note">
          Ждут курса: {c.waitRate} {opsWord(c.waitRate)}. Укажите курс ниже, иначе они не добавятся.
        </Notice>
      )}
      {c.blocked > 0 && (
        <Notice tone="danger" role="note">
          Нет кошелька: {c.blocked} {opsWord(c.blocked)}. Выберите кошелёк для счёта ниже, иначе они не добавятся.
        </Notice>
      )}
    </Card>
  );
}
