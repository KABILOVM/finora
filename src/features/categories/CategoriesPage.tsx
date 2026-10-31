import { Glyph } from '@/components/Glyph';
import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { Segmented } from '@/components/Segmented';
import { useToast } from '@/components/Toast';
import { useCategories, useStore } from '@/db';
import type { Category, CategoryKind, LocalRow } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { childrenOf, groupUnderParents, hasChildren, parentIn } from './categoryTree';
import { CategorySheet } from './CategorySheet';

type SheetState = { kind: 'new'; parentId?: string } | { kind: 'edit'; category: LocalRow<Category> };

const TABS = [
  { value: 'expense', label: 'Расходы', tone: 'expense' },
  { value: 'income', label: 'Доходы', tone: 'income' },
] as const;

function CategoryIcon({ category, small = false }: { category: Category; small?: boolean }) {
  return <Glyph value={category.icon} color={category.color} size={small ? 32 : 40} />;
}

/**
 * Категории: две вкладки, добавить, переименовать, сменить значок, архив и возврат. Подкатегории (один уровень): под родителем с отступом;
 * родителя в архив убирают вместе с его подкатегориями (в подтверждении об этом сказано), возвращают по одной.
 */
export default function CategoriesPage() {
  const store = useStore();
  const toast = useToast();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const all = useCategories(kind, { includeArchived: true });
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [archiving, setArchiving] = useState<LocalRow<Category> | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const active = useMemo(() => (all ?? []).filter((c) => c.archivedAt === null), [all]);
  const archived = useMemo(() => (all ?? []).filter((c) => c.archivedAt !== null), [all]);
  const activeById = useMemo(() => new Map(active.map((c) => [c.id, c] as const)), [active]);
  const allById = useMemo(() => new Map((all ?? []).map((c) => [c.id, c] as const)), [all]);
  // родитель, затем его подкатегории; категория с архивным родителем остаётся в списке как обычная
  const ordered = useMemo(() => groupUnderParents(active), [active]);
  const archivingKids = archiving ? childrenOf(archiving.id, active) : [];

  const fail = (e: unknown, fallback: string) => {
    console.error(fallback, e);
    toast.error(e instanceof Error && e.name === 'ValidationError' ? e.message : fallback);
  };

  const archive = async (c: LocalRow<Category>) => {
    if (busy) return;
    setBusy(true);
    try {
      // сначала подкатегории, потом родитель: если что-то пойдёт не так, родитель остаётся на месте вместе с оставшимися детьми
      for (const kid of childrenOf(c.id, active)) await store.categories.archive(kid.id);
      await store.categories.archive(c.id);
      toast.success(`Категория «${c.name}» убрана в архив`);
      setArchiving(null);
    } catch (e) {
      fail(e, 'Не удалось убрать категорию в архив');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (c: LocalRow<Category>) => {
    if (busy) return;
    setBusy(true);
    try {
      await store.categories.restore(c.id);
      toast.success(`Категория «${c.name}» возвращена`);
    } catch (e) {
      fail(e, 'Не удалось вернуть категорию');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        back={{ to: '/settings', label: 'Настройки' }}
        title="Категории"
        actions={
          <Button icon="plus" onClick={() => setSheet({ kind: 'new' })} disabled={all === undefined}>
            Добавить
          </Button>
        }
      />
      <Segmented
        ariaLabel="Вид категорий"
        options={TABS}
        value={kind}
        onChange={(v) => {
          setKind(v);
          setShowArchived(false);
        }}
        className="mb-4"
      />

      {all === undefined ? (
        <p role="status" className="py-10 text-center text-muted">
          Загрузка…
        </p>
      ) : active.length === 0 ? (
        <EmptyState
          icon="list"
          title={kind === 'expense' ? 'Нет категорий расходов' : 'Нет категорий доходов'}
          text="Добавьте первую категорию."
          action={<Button onClick={() => setSheet({ kind: 'new' })}>Добавить категорию</Button>}
        />
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-border">
            {ordered.map((c) => {
              const sub = parentIn(c, activeById) !== null;
              return (
                <li key={c.id}>
                  <ListRow
                    className={sub ? 'pl-10' : undefined}
                    leading={<CategoryIcon category={c} small={sub} />}
                    title={c.name}
                    chevron
                    onClick={() => setSheet({ kind: 'edit', category: c })}
                  />
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {archived.length > 0 && (
        <section className="mt-6">
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-1 text-left font-semibold text-muted"
          >
            <span>
              Архив · {archived.length} {pluralRu(archived.length, 'категория', 'категории', 'категорий')}
            </span>
            <Icon name="chevron" size={18} className={showArchived ? 'rotate-90' : ''} />
          </button>
          {showArchived && (
            <Card padding="none" className="mt-1">
              <ul className="divide-y divide-border">
                {archived.map((c) => (
                  <li key={c.id} className="flex items-center pr-2">
                    <ListRow
                      className="min-w-0 flex-1"
                      leading={<CategoryIcon category={c} />}
                      title={c.name}
                      subtitle={c.parentId !== null ? allById.get(c.parentId)?.name : undefined}
                    />
                    <Button variant="secondary" aria-label={`Вернуть: ${c.name}`} disabled={busy} onClick={() => void restore(c)}>
                      Вернуть
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}

      {sheet && all && (
        <CategorySheet
          key={sheet.kind === 'edit' ? sheet.category.id : `new-${sheet.parentId ?? ''}`}
          category={sheet.kind === 'edit' ? sheet.category : null}
          kind={kind}
          others={all
            .filter((c) => sheet.kind !== 'edit' || c.id !== sheet.category.id)
            .map((c) => ({ name: c.name, archived: c.archivedAt !== null }))}
          parents={active.filter((c) => c.parentId === null && (sheet.kind !== 'edit' || c.id !== sheet.category.id))}
          hasChildren={sheet.kind === 'edit' && hasChildren(sheet.category.id, all)}
          defaultParentId={sheet.kind === 'new' ? (sheet.parentId ?? null) : null}
          onClose={() => setSheet(null)}
          onAddChild={
            sheet.kind === 'edit' && sheet.category.parentId === null
              ? () => {
                  setSheet({ kind: 'new', parentId: sheet.category.id });
                }
              : undefined
          }
          onArchive={
            sheet.kind === 'edit'
              ? () => {
                  setArchiving(sheet.category);
                  setSheet(null);
                }
              : undefined
          }
        />
      )}

      <ConfirmDialog
        open={archiving !== null}
        danger
        loading={busy}
        title={archiving ? `Убрать «${archiving.name}» в архив?` : ''}
        confirmLabel="В архив"
        message={
          archivingKids.length > 0
            ? `Вместе с ней в архив уйдут подкатегории (${archivingKids.length}): ${archivingKids.map((k) => k.name).join(', ')}. Они пропадут из выбора при добавлении операций. Старые операции останутся с прежними категориями. Вернуть можно из архива, по одной.`
            : 'Категория пропадёт из выбора при добавлении операций. Старые операции останутся с этой категорией. Её можно вернуть из архива.'
        }
        onConfirm={() => archiving && void archive(archiving)}
        onCancel={() => !busy && setArchiving(null)}
      />
    </>
  );
}
