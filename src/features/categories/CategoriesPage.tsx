import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { CategorySheet } from './CategorySheet';

type SheetState = { kind: 'new' } | { kind: 'edit'; category: LocalRow<Category> };

const TABS = [
  { value: 'expense', label: 'Расходы', tone: 'expense' },
  { value: 'income', label: 'Доходы', tone: 'income' },
] as const;

function CategoryIcon({ category }: { category: Category }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 items-center justify-center rounded-full text-xl"
      style={{ backgroundColor: `${category.color}26` }}
    >
      {category.icon}
    </span>
  );
}

/** Категории (без подкатегорий): две вкладки, добавить, переименовать, сменить значок, архив и возврат. */
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

  const fail = (e: unknown, fallback: string) => {
    console.error(fallback, e);
    toast.error(e instanceof Error && e.name === 'ValidationError' ? e.message : fallback);
  };

  const archive = async (c: LocalRow<Category>) => {
    if (busy) return;
    setBusy(true);
    try {
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
      <Link to="/settings" className="-ml-1 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1 font-semibold text-brand">
        <Icon name="chevron" size={18} className="rotate-180" />
        Настройки
      </Link>
      <PageHeader
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
            {active.map((c) => (
              <li key={c.id}>
                <ListRow leading={<CategoryIcon category={c} />} title={c.name} chevron onClick={() => setSheet({ kind: 'edit', category: c })} />
              </li>
            ))}
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
                    <ListRow className="min-w-0 flex-1" leading={<CategoryIcon category={c} />} title={c.name} />
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
          key={sheet.kind === 'edit' ? sheet.category.id : 'new'}
          category={sheet.kind === 'edit' ? sheet.category : null}
          kind={kind}
          others={all
            .filter((c) => sheet.kind !== 'edit' || c.id !== sheet.category.id)
            .map((c) => ({ name: c.name, archived: c.archivedAt !== null }))}
          onClose={() => setSheet(null)}
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
        message="Категория пропадёт из выбора при добавлении операций. Старые операции останутся с этой категорией. Её можно вернуть из архива."
        onConfirm={() => archiving && void archive(archiving)}
        onCancel={() => !busy && setArchiving(null)}
      />
    </>
  );
}
