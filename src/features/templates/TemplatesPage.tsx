import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Glyph } from '@/components/Glyph';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useCategories, useStore, useWallets } from '@/db';
import { useAddLink } from '@/layout/nav';
import { toastWithUndo } from '@/features/transactions/txActions';
import { NameDialog } from './NameDialog';
import { useTemplates } from './templateStore';
import { KIND_LABEL, resolveTemplate, TEMPLATES_MAX, type ResolvedTemplate, type Template } from './templates';

interface RowProps {
  template: Template;
  resolved: ResolvedTemplate | null;
  onRename: () => void;
  onDelete: () => void;
}

function TemplateRow({ template: t, resolved, onRename, onDelete }: RowProps) {
  const addLink = useAddLink(t.prefill.kind, undefined, undefined, t.prefill);
  const kind = KIND_LABEL[t.prefill.kind];
  const where = resolved
    ? t.prefill.kind === 'transfer'
      ? `${resolved.wallet.name} → ${resolved.toWallet?.name ?? ''}`
      : [resolved.category?.name ?? 'Без категории', resolved.wallet.name].join(' · ')
    : null;
  return (
    <li className="flex flex-col gap-2 py-3" data-testid="template-row">
      <div className="flex items-start gap-3">
        <Glyph value={t.prefill.kind === 'transfer' ? '🔁' : (resolved?.category?.icon ?? '🏷️')} color={resolved?.category?.color ?? undefined} size={36} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-base font-semibold">{t.name}</p>
          <p className="break-words text-sm text-muted">
            {resolved ? `${kind} · ${where}` : `${kind} · кошелёк или категория недоступны`}
            {t.prefill.note !== '' && ` · ${t.prefill.note}`}
          </p>
        </div>
        {resolved && (
          <MoneyText minor={t.prefill.amountMinor} currency={resolved.wallet.currency} tone="none" className="shrink-0 text-base font-semibold" />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {resolved && (
          <Link {...addLink} aria-label={`Внести: ${t.name}`} className={buttonClasses('primary', 'md')}>
            Внести
          </Link>
        )}
        <Button variant="secondary" aria-label={`Переименовать: ${t.name}`} onClick={onRename}>
          Переименовать
        </Button>
        <Button variant="ghost" aria-label={`Удалить: ${t.name}`} className="!text-danger hover:!bg-danger/10" onClick={onDelete}>
          Удалить
        </Button>
      </div>
    </li>
  );
}

/**
 * «Шаблоны операций» (Настройки): список заготовок, которые хранятся на этом устройстве (templateStore.ts). «Внести» открывает
 * «Новую операцию» с заполненными полями, «Переименовать» меняет название, «Удалить» убирает (с «Отменить»). Новый шаблон создаётся
 * кнопкой «Сохранить как шаблон» внизу формы операции.
 */
export default function TemplatesPage() {
  const store = useStore();
  const toast = useToast();
  const wallets = useWallets();
  const categories = useCategories(undefined, { includeArchived: true });
  const { templates, rename, remove, restore } = useTemplates(store.userId);
  const [renaming, setRenaming] = useState<Template | null>(null);
  const addLink = useAddLink();

  const header = <PageHeader title="Шаблоны операций" subtitle="Готовые операции в один тап" back={{ to: '/settings', label: 'Настройки' }} />;
  if (!wallets || !categories) {
    return (
      <>
        {header}
        <div role="status" aria-busy="true">
          <span className="sr-only">Загружаем…</span>
          <Skeleton aria-hidden="true" className="h-40 !rounded-card" />
        </div>
      </>
    );
  }
  if (templates.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon="star"
          title="Шаблонов пока нет"
          text="Заполните «Новую операцию» (сумму, категорию, заметку) и нажмите «Сохранить как шаблон» внизу формы. То же есть в правке любой прошлой операции."
          action={
            <Link {...addLink} className={buttonClasses('primary', 'md')}>
              Новая операция
            </Link>
          }
        />
      </>
    );
  }
  return (
    <>
      {header}
      <Card padding="none" className="px-4 py-1" aria-label="Шаблоны">
        <ul className="flex flex-col divide-y divide-border">
          {templates.map((t) => (
            <TemplateRow
              key={t.id}
              template={t}
              resolved={resolveTemplate(t, wallets, categories)}
              onRename={() => setRenaming(t)}
              onDelete={() => {
                const removed = remove(t.id);
                if (removed) toastWithUndo(toast, `Шаблон «${t.name}» удалён`, async () => restore(removed.template, removed.index), 'Шаблон возвращён');
              }}
            />
          ))}
        </ul>
      </Card>
      <p className="px-1 pt-3 text-sm text-muted">
        {templates.length} из {TEMPLATES_MAX}. Шаблоны лежат только на этом устройстве: на другом телефоне их нужно завести заново.
      </p>
      <NameDialog
        open={renaming !== null}
        title="Название шаблона"
        initial={renaming?.name ?? ''}
        confirmLabel="Сохранить"
        onCancel={() => setRenaming(null)}
        onConfirm={(name) => {
          if (renaming) rename(renaming.id, name);
          setRenaming(null);
        }}
      />
    </>
  );
}
