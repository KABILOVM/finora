import { useState } from 'react';
import type { ChipOption } from '@/components/ChipPicker';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import type { CategoryKind } from '@/domain/types';
import { suggestColor, suggestGlyph } from '@/features/categories/suggestGlyph';
import { cleanName, sameName } from '@/features/wallets/walletUi';

export interface NewCategoryFormProps {
  /** Уже есть: категория с таким названием не создаётся второй раз, а выбирается. */
  options: readonly ChipOption[];
  /** Вид операции: новая категория создаётся для него. */
  kind: CategoryKind;
  /** Категория создана (или найдена такая же): выбрать её. */
  onPick: (id: string) => void;
  /** Закрыть форму (после добавления или «Отмена»). */
  onClose: (created: boolean) => void;
  /** Название заранее (например, то, что искали и не нашли). */
  initialName?: string;
}

/**
 * Строка «Новая категория»: достаточно написать название, значок и цвет подберутся сами. Enter добавляет категорию, а не
 * сохраняет всю операцию.
 */
export function NewCategoryForm({ options, kind, onPick, onClose, initialName = '' }: NewCategoryFormProps) {
  const store = useStore();
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (busy) return;
    const clean = cleanName(name);
    if (clean === '') return setProblem('Введите название');
    if (clean.length > 60) return setProblem('Не длиннее 60 символов');
    const twin = options.find((o) => sameName(o.label, clean));
    if (twin) {
      onPick(twin.value); // такая уже есть — просто выбираем её
      onClose(false);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const row = await store.categories.create({ name: clean, kind, color: suggestColor(options.length), icon: suggestGlyph(clean) });
      onPick(row.id);
      onClose(true);
    } catch (e) {
      console.error('Не удалось добавить категорию:', e);
      setProblem(e instanceof Error && e.name === 'ValidationError' ? e.message : 'Не удалось добавить. Попробуйте ещё раз.');
      toast.error('Категория не добавлена');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-2 flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="Название, например «Кофе»"
          aria-label="Название новой категории"
          maxLength={60}
          autoComplete="off"
          enterKeyHint="done"
          className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-base outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] rounded-xl bg-brand px-4 font-semibold text-brand-fg disabled:opacity-60"
        >
          Добавить
        </button>
        <button
          type="button"
          aria-label="Отмена"
          onClick={() => onClose(false)}
          className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl text-muted hover:bg-surface-2"
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      {problem && (
        <p role="alert" className="text-sm font-medium text-danger">
          {problem}
        </p>
      )}
    </form>
  );
}
