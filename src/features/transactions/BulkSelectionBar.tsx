import { Button } from '@/components/Button';
import { Card } from '@/components/Card';

export interface BulkSelectionBarProps {
  /** Сколько операций выделено. */
  count: number;
  /** Выделены все показанные на экране. */
  allSelected: boolean;
  onToggleAll: () => void;
  /** Почему «Категория» сейчас недоступна (null — доступна). Показывается, пока что-то выделено. */
  categoryReason: string | null;
  onCategory: () => void;
  onDelete: () => void;
  /** Идёт действие: кнопки заблокированы. */
  busy?: boolean;
}

/**
 * Панель действий над выделенными операциями. «Липкая»: стоит внизу содержимого и при прокрутке остаётся над нижним меню
 * (на ПК — просто у нижнего края), поэтому ни меню, ни кнопку «+» не перекрывает.
 */
export function BulkSelectionBar({ count, allSelected, onToggleAll, categoryReason, onCategory, onDelete, busy = false }: BulkSelectionBarProps) {
  const none = count === 0;
  return (
    <div className="pointer-events-none sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 md:bottom-4" data-testid="bulk-bar">
      <Card className="pointer-events-auto flex flex-col gap-2 !bg-surface !p-3 shadow-float" role="region" aria-label="Действия с выбранными операциями">
        <div className="flex items-center justify-between gap-3">
          <p className="text-base font-semibold" aria-live="polite">
            {none ? 'Выберите операции' : `Выбрано: ${count}`}
          </p>
          <button
            type="button"
            onClick={onToggleAll}
            className="press inline-flex min-h-[44px] items-center rounded-lg px-2 text-base font-semibold text-brand"
          >
            {allSelected ? 'Снять выбор' : 'Выбрать все'}
          </button>
        </div>
        {!none && categoryReason && <p className="-mt-1 text-sm text-muted">{categoryReason}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" icon="tag" disabled={none || busy || categoryReason !== null} onClick={onCategory}>
            Категория
          </Button>
          <Button variant="danger" icon="trash" disabled={none || busy} onClick={onDelete}>
            Удалить
          </Button>
        </div>
      </Card>
    </div>
  );
}
