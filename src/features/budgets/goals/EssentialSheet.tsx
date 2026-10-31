import { useState } from 'react';
import { Button } from '@/components/Button';
import { Glyph } from '@/components/Glyph';
import { Sheet } from '@/components/Sheet';
import { SwitchTrack } from '@/components/Switch';
import { useToast } from '@/components/Toast';
import { ValidationError, useStore } from '@/db';
import type { Category, LocalRow, UUID } from '@/domain/types';

export interface EssentialSheetProps {
  /** Расходные категории, не в архиве. */
  categories: readonly LocalRow<Category>[];
  onClose: () => void;
}

/**
 * «Обязательные категории»: аренда, связь, кредиты — то, что цель накопления не «урезает» в разборе трат. Отметка хранится
 * у самой категории (одна на все цели) и применяется сразу: сохранять отдельно нечего.
 */
export function EssentialSheet({ categories, onClose }: EssentialSheetProps) {
  const store = useStore();
  const toast = useToast();
  const [busyId, setBusyId] = useState<UUID | null>(null);
  const list = [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));

  const toggle = async (c: LocalRow<Category>, on: boolean) => {
    if (busyId !== null) return;
    setBusyId(c.id);
    try {
      await store.categories.setEssential(c.id, on);
    } catch (e) {
      console.error('Не удалось изменить отметку категории:', e);
      toast.error(e instanceof ValidationError ? e.message : 'Не удалось изменить отметку. Данные не изменены, попробуйте ещё раз.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Обязательные категории"
      footer={
        <Button size="lg" fullWidth onClick={onClose}>
          Готово
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Отметьте то, что нельзя сократить: аренду, связь, кредиты. Цель накопления предложит экономить только на остальном. Отметка применяется сразу.
      </p>
      {list.length === 0 ? (
        <p className="text-muted">Категорий расходов пока нет.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border/70" aria-label="Категории расходов">
          {list.map((c) => (
            <li key={c.id}>
              {/* вся строка — переключатель (как ToggleRow): попасть пальцем легко, а скринридер читает «Обязательная: Аренда» */}
              <button
                type="button"
                role="switch"
                aria-checked={c.essential === 1}
                aria-label={`Обязательная: ${c.name}`}
                disabled={busyId !== null}
                onClick={() => void toggle(c, c.essential !== 1)}
                className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
              >
                <Glyph value={c.icon} color={c.color} size={36} />
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <SwitchTrack checked={c.essential === 1} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
