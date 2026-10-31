import { useState } from 'react';
import { Button } from '@/components/Button';
import { GlyphPicker } from '@/components/GlyphPicker';
import { IconSelect } from '@/components/IconSelect';
import { Sheet } from '@/components/Sheet';
import { TextInput } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { ValidationError, useStore } from '@/db';
import type { Category, CategoryKind, LocalRow } from '@/domain/types';
import { ColorSwatches } from '@/features/wallets/ColorSwatches';
import { cleanName, COLOR_CHOICES, sameName } from '@/features/wallets/walletUi';

/** Значение «верхний уровень» в списке «Входит в…». */
const NO_PARENT = 'none';

export interface CategorySheetProps {
  /** null — новая категория вида `kind`. */
  category: LocalRow<Category> | null;
  kind: CategoryKind;
  /** Другие категории того же вида (живые, включая архивные): для проверки повторов. */
  others: readonly { name: string; archived: boolean }[];
  /**
   * Кого можно выбрать родителем: живые категории этого вида верхнего уровня (не архивные, не сама категория). Подкатегории в
   * интерфейсе только одного уровня, поэтому у самой подкатегории детей быть не может, а родителем — только верхняя.
   */
  parents?: readonly LocalRow<Category>[];
  /** У редактируемой категории уже есть подкатегории: сама она ни в какую другую входить не может. */
  hasChildren?: boolean;
  /** Новая категория сразу «входит в…» этого родителя (кнопка «Добавить подкатегорию»). */
  defaultParentId?: string | null;
  onClose: () => void;
  /** Только при правке: убрать в архив (подтверждение показывает экран). */
  onArchive?: () => void;
  /** Только при правке верхней категории: закрыть окно и открыть «Новая подкатегория» в ней. */
  onAddChild?: () => void;
}

/**
 * Создание и правка категории: название, «Входит в…» (подкатегория), значок, цвет. Вид (расход/доход) задан вкладкой и не меняется.
 * Цвет новой подкатегории сам берётся от родителя, пока его не выбрали вручную: так диаграммы и списки не пестрят.
 */
export function CategorySheet({
  category,
  kind,
  others,
  parents = [],
  hasChildren = false,
  defaultParentId = null,
  onClose,
  onArchive,
  onAddChild,
}: CategorySheetProps) {
  const store = useStore();
  const toast = useToast();
  const parentById = new Map(parents.map((p) => [p.id, p] as const));
  // Родитель, которого уже нет среди кандидатов (в архиве, удалён), оставляем как есть, пока человек его не сменит.
  const initialParent = category ? category.parentId : defaultParentId !== null && parentById.has(defaultParentId) ? defaultParentId : null;
  const [parentId, setParentId] = useState<string | null>(initialParent);
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '📦');
  const [color, setColor] = useState(
    category?.color ?? (initialParent !== null ? parentById.get(initialParent)?.color : undefined) ?? COLOR_CHOICES[others.length % COLOR_CHOICES.length]?.value ?? '#16a34a',
  );
  const [colorTouched, setColorTouched] = useState(category !== null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pickParent = (value: string) => {
    const next = value === NO_PARENT ? null : value;
    setParentId(next);
    // пока цвет не выбирали сами, подкатегория перенимает цвет родителя
    if (!colorTouched && next !== null) {
      const c = parentById.get(next)?.color;
      if (c) setColor(c);
    }
  };

  const save = async () => {
    if (saving) return;
    const clean = cleanName(name);
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
        await store.categories.create({ name: clean, kind, color, icon, parentId });
      } else {
        const patch: Parameters<typeof store.categories.update>[1] = {};
        if (clean !== category.name) patch.name = clean;
        if (icon !== category.icon) patch.icon = icon;
        if (color !== category.color) patch.color = color;
        if (parentId !== category.parentId) patch.parentId = parentId;
        if (Object.keys(patch).length > 0) await store.categories.update(category.id, patch);
      }
      toast.success(category ? 'Категория сохранена' : parentId !== null ? 'Подкатегория добавлена' : 'Категория добавлена');
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

  // Заголовок зависит от того, с чем открыли окно, а не от того, что выбрано сейчас: иначе он «прыгал» бы при выборе родителя
  const wasSub = initialParent !== null;
  const isSub = parentId !== null;
  const title = category
    ? wasSub
      ? 'Правка подкатегории'
      : 'Правка категории'
    : wasSub
      ? 'Новая подкатегория'
      : kind === 'expense'
        ? 'Новая категория расходов'
        : 'Новая категория доходов';

  // «Входит в…» показываем, когда есть кого выбрать или уже выбран родитель; у категории с подкатегориями — только пояснение
  const showParentField = !hasChildren && (parents.length > 0 || parentId !== null);
  const parentOptions = [
    { value: NO_PARENT, label: 'Нет, отдельная категория' },
    ...parents.map((p) => ({ value: p.id, label: p.name, icon: p.icon, color: p.color })),
    // выбранный родитель, которого нет среди кандидатов: чтобы поле не казалось пустым
    ...(parentId !== null && !parentById.has(parentId) ? [{ value: parentId, label: 'Прежняя категория' }] : []),
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title={title}
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
          {onAddChild && (
            <Button variant="secondary" fullWidth disabled={saving} onClick={onAddChild}>
              Добавить подкатегорию
            </Button>
          )}
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
          placeholder={isSub ? 'Например, Вода' : 'Например, Кафе'}
          autoComplete="off"
          error={error}
          onChange={(e) => setName(e.target.value)}
          data-autofocus
        />
        {showParentField && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Входит в</span>
            <IconSelect label="Входит в" options={parentOptions} value={parentId ?? NO_PARENT} onChange={pickParent} />
            <p className="text-sm text-muted">
              Подкатегория нужна, чтобы расходы были точнее: «Коммунальные услуги» → «Вода», «Свет». В отчётах и лимитах она входит в родительскую категорию.
            </p>
          </div>
        )}
        {hasChildren && (
          <p className="text-sm text-muted">У этой категории есть подкатегории, поэтому она не может входить в другую категорию.</p>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Значок</span>
          <GlyphPicker value={icon} color={color} onChange={setIcon} ariaLabel="Значок категории" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Цвет</span>
          <ColorSwatches
            value={color}
            onChange={(c) => {
              setColorTouched(true);
              setColor(c);
            }}
            ariaLabel="Цвет категории"
          />
        </div>
      </div>
    </Sheet>
  );
}
