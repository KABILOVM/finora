import { useState } from 'react';
import { Button } from '@/components/Button';
import { EmojiPicker } from '@/components/EmojiPicker';
import { Sheet } from '@/components/Sheet';
import { TextInput } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { ValidationError, useStore } from '@/db';
import type { Category, CategoryKind, LocalRow } from '@/domain/types';
import { ColorSwatches } from '@/features/wallets/ColorSwatches';
import { COLOR_CHOICES, sameName } from '@/features/wallets/walletUi';

export interface CategorySheetProps {
  /** null — новая категория вида `kind`. */
  category: LocalRow<Category> | null;
  kind: CategoryKind;
  /** Другие категории того же вида (живые, включая архивные): для проверки повторов. */
  others: readonly { name: string; archived: boolean }[];
  onClose: () => void;
  /** Только при правке: убрать в архив (подтверждение показывает экран). */
  onArchive?: () => void;
}

/** Создание и правка категории: название, значок, цвет. Вид (расход/доход) задан вкладкой и не меняется. */
export function CategorySheet({ category, kind, others, onClose, onArchive }: CategorySheetProps) {
  const store = useStore();
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '📦');
  const [color, setColor] = useState(
    category?.color ?? COLOR_CHOICES[others.length % COLOR_CHOICES.length]?.value ?? '#16a34a',
  );
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    const clean = name.trim();
    setFormError(null);
    if (clean === '') return setError('Введите название категории');
    if (clean.length > 60) return setError('Название не длиннее 60 символов');
    const twin = others.find((o) => sameName(o.name, clean));
    if (twin) {
      return setError(twin.archived ? 'Такая категория уже есть в архиве: верните её оттуда' : 'Такая категория уже есть');
    }
    setError(null);
    setSaving(true);
    try {
      if (!category) {
        await store.categories.create({ name: clean, kind, color, icon });
      } else {
        const patch: Parameters<typeof store.categories.update>[1] = {};
        if (clean !== category.name) patch.name = clean;
        if (icon !== category.icon) patch.icon = icon;
        if (color !== category.color) patch.color = color;
        if (Object.keys(patch).length > 0) await store.categories.update(category.id, patch);
      }
      toast.success(category ? 'Категория сохранена' : 'Категория добавлена');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setFormError(e.message);
      else {
        console.error('Не удалось сохранить категорию:', e);
        setFormError('Не удалось сохранить категорию. Данные не изменены, попробуйте ещё раз.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title={category ? 'Правка категории' : kind === 'expense' ? 'Новая категория расходов' : 'Новая категория доходов'}
      footer={
        <div className="flex flex-col gap-2">
          {formError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {formError}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} onClick={() => void save()}>
            Сохранить
          </Button>
          {onArchive && (
            <Button variant="ghost" fullWidth disabled={saving} onClick={onArchive}>
              Убрать в архив
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <TextInput
          label="Название"
          value={name}
          maxLength={60}
          placeholder="Например, Кафе"
          autoComplete="off"
          error={error}
          onChange={(e) => setName(e.target.value)}
          data-autofocus
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Значок</span>
          <EmojiPicker value={icon} onChange={setIcon} ariaLabel="Значок категории" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Цвет</span>
          <ColorSwatches value={color} onChange={setColor} ariaLabel="Цвет категории" />
        </div>
      </div>
    </Sheet>
  );
}
