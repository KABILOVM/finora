import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Glyph } from '@/components/Glyph';
import { glyphValue } from '@/components/glyphs';
import { Icon } from '@/components/Icon';
import { Segmented } from '@/components/Segmented';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useCategories, useStore } from '@/db';
import type { CategoryKind } from '@/domain/types';
import { cn } from '@/lib/cn';
import { pluralRu } from '@/lib/plural';
import { applyCatalog, applyText, type ApplyResult } from './catalogApply';
import {
  actionable,
  countSelected,
  defaultSelection,
  hasWork,
  isGroupOn,
  isGroupPartly,
  planCatalog,
  toggleChild,
  toggleGroup,
  type CatalogPlan,
  type ExistingCategory,
  type PlanChild,
  type PlanGroup,
} from './catalogPlan';

export interface CatalogSheetProps {
  /** welcome — разовое предложение действующему человеку; onboarding — в мастере первой настройки; manage — из «Категорий». */
  mode?: 'welcome' | 'onboarding' | 'manage';
  /** Окно закрыли (кнопкой, ×, Esc, «Не сейчас» или после добавления). */
  onClose: () => void;
  /** Что-то записано. */
  onApplied?: (result: ApplyResult) => void;
}

const TABS = [
  { value: 'expense', label: 'Расходы', tone: 'expense' },
  { value: 'income', label: 'Доходы', tone: 'income' },
] as const;

const INTRO: Record<NonNullable<CatalogSheetProps['mode']>, string> = {
  welcome:
    'Подготовили готовые категории с подкатегориями: коммуналка (свет, вода, газ), продукты (мясо, овощи, молочное), семья (дети, супруг) и другие. Выберите, что добавить. Ваши категории не пропадут: похожие мы соберём под нужные наборы, а операции останутся на месте.',
  onboarding:
    'Готовые наборы с подкатегориями: коммуналка (свет, вода, газ), продукты (мясо, овощи, молочное), семья (дети, супруг) и другие. Отметьте то, что вам нужно; лишнее можно убрать позже.',
  manage:
    'Готовые наборы с подкатегориями. Отметьте, что добавить. Если у вас уже есть похожие категории («Свет», «Вода», «Жена»), мы соберём их под нужный набор, а не заведём копии.',
};

/** Чекбокс: настоящий, с подписью-строкой (вся строка — область касания ≥ 44 px). */
function Check({ checked, partly = false, disabled = false, label, onChange }: { checked: boolean; partly?: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partly && !checked;
  }, [partly, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={onChange}
      className="h-5 w-5 shrink-0 cursor-pointer accent-brand disabled:cursor-default"
    />
  );
}

/** Подпись под названием набора: что с ним произойдёт. */
function groupStatus(g: PlanGroup): string {
  const created = g.children.filter((c) => c.action === 'create').length;
  const moved = g.children.filter((c) => c.action === 'move').length;
  const parts: string[] = [];
  if (g.parent.action === 'present') parts.push(`у вас есть «${g.parent.name}»`);
  else if (g.parent.action === 'restore') parts.push(`вернём «${g.parent.name}» из архива`);
  else parts.push('новый набор');
  if (created > 0) parts.push(`добавим ${created}`);
  if (moved > 0) parts.push(`перенесём ${moved}`);
  return parts.join(' · ');
}

function ChildRow({ item, color, selected, onToggle }: { item: PlanChild; color: string; selected: boolean; onToggle: () => void }) {
  const present = item.action === 'present';
  // у переносимой и уже имеющейся показываем название, которое дал человек
  const name = item.existing ? item.existing.name : item.child.name;
  return (
    <li>
      <label className={cn('flex min-h-[44px] items-center gap-3 py-1 pl-11 pr-3', present ? 'text-muted' : 'cursor-pointer')}>
        <Check checked={present || selected} disabled={present} label={name} onChange={onToggle} />
        <Glyph value={glyphValue(item.child.icon)} color={color} size={28} />
        <span className="min-w-0 flex-1 truncate text-base">{name}</span>
        {item.action === 'move' && <span className="shrink-0 rounded-pill bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">перенесём сюда</span>}
        {present && <span className="shrink-0 text-xs">уже есть</span>}
      </label>
    </li>
  );
}

function GroupCard({
  group,
  selected,
  expanded,
  onToggleGroup,
  onToggleChild,
  onToggleExpanded,
}: {
  group: PlanGroup;
  selected: ReadonlySet<string>;
  expanded: boolean;
  onToggleGroup: () => void;
  onToggleChild: (key: string) => void;
  onToggleExpanded: () => void;
}) {
  const on = isGroupOn(group, selected);
  const partly = isGroupPartly(group, selected);
  const color = group.parent.action === 'create' ? group.group.color : group.parent.color;
  const shown = actionable(group).length + group.children.filter((c) => c.action === 'present').length;
  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-surface/80">
      <div className="flex items-center">
        <label className="flex min-h-[56px] min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 pl-3 pr-1">
          <Check checked={on} partly={partly} label={`Набор «${group.group.name}»`} onChange={onToggleGroup} />
          <Glyph value={glyphValue(group.group.icon)} color={color} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{group.group.name}</span>
            <span className="block truncate text-sm text-muted">{group.group.hint}</span>
            <span className="block truncate text-xs text-muted">{groupStatus(group)}</span>
          </span>
        </label>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Скрыть' : 'Показать'} состав набора «${group.group.name}»`}
          onClick={onToggleExpanded}
          className="flex min-h-[56px] min-w-[44px] shrink-0 items-center justify-center gap-1 pr-2 text-sm font-semibold text-muted"
        >
          <span aria-hidden="true">{shown}</span>
          <Icon name="chevron" size={18} className={expanded ? 'rotate-90' : ''} />
        </button>
      </div>
      {expanded && (
        <ul aria-label={`Состав набора «${group.group.name}»`} className="border-t border-border pb-1 pt-1">
          {group.children.map((c) => (
            <ChildRow key={c.key} item={c} color={color} selected={selected.has(c.key)} onToggle={() => onToggleChild(c.key)} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Окно «Готовые категории»: наборы с подкатегориями (Коммунальные услуги → свет, вода, газ), которые можно завести разом. Одно окно: набор
 * целиком или отдельные подкатегории отмечаются галочками; свои категории человека, подходящие по названию, переносятся под нужный набор
 * («перенесём сюда»), а не дублируются. Записывается всё одной операцией, повтор ничего не дублирует.
 */
export default function CatalogSheet({ mode = 'manage', onClose, onApplied }: CatalogSheetProps) {
  const store = useStore();
  const toast = useToast();
  const all = useCategories(undefined, { includeArchived: true });
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan: CatalogPlan | null = useMemo(() => {
    if (all === undefined) return null;
    const existing: ExistingCategory[] = all.map((c) => ({ id: c.id, name: c.name, kind: c.kind, parentId: c.parentId, archived: c.archivedAt !== null, color: c.color }));
    return planCatalog(existing);
  }, [all]);

  // Заранее отмеченное считаем один раз, когда категории загрузились: дальше выбор принадлежит человеку (данные могут обновиться под ним)
  useEffect(() => {
    if (plan !== null && selected === null) setSelected(defaultSelection(plan));
  }, [plan, selected]);

  const chosen = selected ?? new Set<string>();
  const groups = useMemo(() => (plan?.groups ?? []).filter((g) => g.group.kind === kind && hasWork(g)), [plan, kind]);
  const otherKindHasWork = useMemo(() => (plan?.groups ?? []).some((g) => g.group.kind !== kind && hasWork(g)), [plan, kind]);
  const total = plan === null ? 0 : countSelected(plan, chosen);
  const nothingToDo = plan !== null && !plan.groups.some(hasWork);

  const flip = <T,>(set: ReadonlySet<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (!next.delete(v)) next.add(v);
    return next;
  };

  const save = async () => {
    if (saving || plan === null || total === 0) return;
    setSaving(true);
    setError(null);
    try {
      const result = await applyCatalog(store, plan, chosen);
      toast.success(applyText(result));
      onApplied?.(result);
      onClose();
    } catch (e) {
      console.error('Не удалось добавить готовые категории:', e);
      setError(e instanceof Error && e.name === 'ValidationError' ? e.message : 'Не удалось добавить категории. Ничего не изменилось, попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  const noun = pluralRu(total, 'категория', 'категории', 'категорий');
  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title="Готовые категории"
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          {nothingToDo ? (
            <Button size="lg" fullWidth onClick={onClose}>
              Понятно
            </Button>
          ) : (
            <>
              <Button size="lg" fullWidth loading={saving} disabled={total === 0 || plan === null} onClick={() => void save()}>
                {total === 0 ? 'Выберите, что добавить' : `Добавить выбранное · ${total}`}
              </Button>
              <Button size="lg" variant="ghost" fullWidth disabled={saving} onClick={onClose}>
                {mode === 'welcome' ? 'Не сейчас' : 'Отмена'}
              </Button>
            </>
          )}
        </div>
      }
    >
      {plan === null ? (
        <p role="status" className="py-10 text-center text-muted">
          Загрузка…
        </p>
      ) : nothingToDo ? (
        <p className="py-6 text-center text-muted">Все готовые наборы у вас уже есть. Добавлять нечего.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{INTRO[mode]}</p>
          <Segmented ariaLabel="Вид категорий" options={TABS} value={kind} onChange={setKind} />
          {groups.length === 0 ? (
            <p className="py-4 text-center text-muted">
              {kind === 'expense' ? 'Готовые наборы расходов у вас уже есть.' : 'Готовые наборы доходов у вас уже есть.'}
              {otherKindHasWork ? ' Загляните на соседнюю вкладку.' : ''}
            </p>
          ) : (
            <ul aria-label={kind === 'expense' ? 'Наборы категорий расходов' : 'Наборы категорий доходов'} className="flex flex-col gap-2">
              {groups.map((g) => (
                <GroupCard
                  key={g.key}
                  group={g}
                  selected={chosen}
                  expanded={expanded.has(g.key)}
                  onToggleGroup={() => setSelected(toggleGroup(g, chosen))}
                  onToggleChild={(key) => setSelected(toggleChild(g, key, chosen))}
                  onToggleExpanded={() => setExpanded(flip(expanded, g.key))}
                />
              ))}
            </ul>
          )}
          <p aria-live="polite" className="text-sm text-muted">
            {total === 0 ? 'Ничего не выбрано.' : `Будет добавлено или перенесено: ${total} ${noun}.`}
          </p>
        </div>
      )}
    </Sheet>
  );
}
