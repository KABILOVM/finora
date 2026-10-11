import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import type { ImportProgress } from '@/import/runImport';

const PHASE_TEXT: Record<ImportProgress['phase'], string> = {
  wallets: 'Создаём кошельки…',
  categories: 'Создаём категории…',
  transactions: 'Записываем операции…',
};

export interface RunStepProps {
  progress: ImportProgress;
  stopping: boolean;
  onStop: () => void;
}

/** Идёт запись: полоса хода, остановка. */
export function RunStep({ progress, stopping, onStop }: RunStepProps) {
  const { done, total } = progress;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <Card className="flex flex-col gap-4" role="region" aria-label="Ход импорта">
      <h2 className="text-lg font-bold">Импортируем</h2>
      <p role="status" aria-live="polite">
        {stopping ? 'Останавливаем…' : PHASE_TEXT[progress.phase]} <span className="font-semibold tabular-nums">{done} из {total}</span>
      </p>
      <div
        role="progressbar"
        aria-label="Ход импорта"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-3 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-muted">
        Оставьте экран открытым. Если закроете его, импорт остановится; когда загрузите файл ещё раз, он продолжится с того же места: добавленное
        не повторится.
      </p>
      <Button variant="secondary" disabled={stopping} onClick={onStop}>
        Остановить импорт
      </Button>
    </Card>
  );
}
