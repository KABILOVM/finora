import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { Sheet } from '@/components/Sheet';
import { TextInput } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { safeItems, SHOPPING_ITEMS_MAX, SHOPPING_NAME_MAX, useShoppingList, useStore } from '@/db';
import { formatMinor } from '@/domain/money';
import type { LocalRow, ShoppingItem, ShoppingList } from '@/domain/types';
import { humanError } from '@/features/transactions/txActions';
import { cn } from '@/lib/cn';
import { ConfirmSheet } from './ConfirmSheet';
import { ItemSheet } from './ItemSheet';
import { boughtTotals, itemsWord, newItem, plannedTotals, priceText, progressText, qtyText, repeatItems } from './shoppingText';

function BackLink() {
  return (
    <Link to="/shopping" className="-ml-1 inline-flex min-h-[44px] items-center gap-1 pr-3 text-base font-semibold text-brand">
      <Icon name="chevron" size={18} className="rotate-180" />
      Все списки
    </Link>
  );
}

function longDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return '';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Экран списка покупок: отмечайте купленное, вписывайте цены, подтвердите покупку одним расходом. Подтверждённый список — «чек». */
export default function ShoppingListPage() {
  const { id = '' } = useParams();
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const list = useShoppingList(id);

  const [title, setTitle] = useState('');
  const [itemId, setItemId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inputRef = useRef<HTMLInputElement>(null);

  if (list === undefined) {
    return (
      <p role="status" className="py-10 text-center text-muted">
        Загружаем…
      </p>
    );
  }
  if (list === null) {
    return (
      <>
        <BackLink />
        <PageHeader title="Список" />
        <EmptyState
          icon="alert"
          title="Список не найден"
          text="Возможно, его удалили на другом устройстве."
          action={
            <Link to="/shopping" className={buttonClasses('primary', 'lg')}>
              К спискам покупок
            </Link>
          }
        />
      </>
    );
  }

  const cur: LocalRow<ShoppingList> = list;
  const items = safeItems(cur);
  const open = cur.status === 'open';

  /** Правка товаров по очереди: каждая читает свежий список из базы, поэтому два быстрых нажатия не затирают друг друга. */
  const mutate = (fn: (items: ShoppingItem[]) => ShoppingItem[]): Promise<unknown> => {
    queue.current = queue.current
      .then(async () => {
        const row = await store.db.shopping_lists.get(id);
        if (!row || row.deletedAt !== null || row.status !== 'open') return;
        await store.shopping.update(id, { items: fn(safeItems(row)) });
      })
      .catch((e: unknown) => {
        console.error('Не удалось сохранить список:', e);
        toast.error(humanError(e, 'Не удалось сохранить список. Попробуйте ещё раз.'));
      });
    return queue.current;
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (t === '') return;
    if (items.length >= SHOPPING_ITEMS_MAX) return void toast.error(`В списке не больше ${SHOPPING_ITEMS_MAX} товаров`);
    setTitle('');
    void mutate((all) => [...all, newItem(t)]);
    inputRef.current?.focus();
  };

  const rename = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await store.shopping.update(id, { name });
      setRenameOpen(false);
    } catch (e) {
      toast.error(humanError(e, 'Не удалось переименовать список'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await store.shopping.softDelete(id);
      toast.success('Список удалён');
      navigate('/shopping', { replace: true });
    } catch (e) {
      toast.error(humanError(e, 'Не удалось удалить список'));
      setBusy(false);
    }
  };

  const repeat = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await store.shopping.create({ name: cur.name.replace(/ \(остаток\)$/, '').slice(0, SHOPPING_NAME_MAX), items: repeatItems(items), categoryId: cur.categoryId });
      navigate(`/shopping/${next.id}`);
    } catch (e) {
      toast.error(humanError(e, 'Не удалось создать список'));
      setBusy(false);
    }
  };

  const editing = itemId === null ? undefined : items.find((i) => i.id === itemId);
  const planned = plannedTotals(items);
  const bought = boughtTotals(items);
  // купленное — внизу, порядок внутри групп сохраняется
  const shown = [...items].sort((a, b) => Number(a.checked) - Number(b.checked));

  const dialogs = (
    <>
      <ConfirmDialog
        open={deleteOpen}
        title="Удалить список?"
        message={cur.status === 'done' ? 'Расход, созданный этой покупкой, останется.' : 'Список и его товары будут удалены.'}
        confirmLabel="Удалить"
        danger
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );

  if (!open) {
    return (
      <>
        <BackLink />
        <PageHeader title={cur.name} subtitle={`Покупка · ${longDate(cur.doneOn)}`} />
        <Card className="mb-4">
          <p className="text-sm font-semibold text-muted">Итог по чеку</p>
          <p className="money mt-0.5 text-3xl font-bold tracking-tight">{formatMinor(cur.totalMinor ?? 0, cur.currency)}</p>
          <p className="mt-0.5 text-sm text-muted">{itemsWord(items.length)} · записано расходом</p>
        </Card>
        {items.length > 0 && (
          <Card padding="none">
            <ul className="divide-y divide-border">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{i.title}</span>
                    {qtyText(i) !== '' && <span className="block text-sm text-muted">{qtyText(i)}</span>}
                  </span>
                  <span className="money shrink-0 font-semibold">{priceText(i.priceMinor, cur.currency)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div className="mt-4 flex flex-col gap-2">
          <Button size="lg" fullWidth icon="plus" loading={busy} onClick={() => void repeat()}>
            Повторить покупку
          </Button>
          <Button variant="ghost" fullWidth onClick={() => setDeleteOpen(true)}>
            Удалить список
          </Button>
        </div>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title={cur.name}
        actions={
          <Button
            variant="secondary"
            icon="edit"
            aria-label="Переименовать список"
            onClick={() => {
              setName(cur.name);
              setRenameOpen(true);
            }}
          />
        }
      />

      <Card className="mb-4 bg-gradient-to-br from-brand/10 to-accent/10">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-muted">{items.length === 0 ? 'Список пуст' : progressText(items)}</span>
          {planned.sum !== null && planned.sum > 0 && (
            <span className="money text-sm text-muted">План ≈ {formatMinor(planned.sum, cur.currency)}</span>
          )}
        </div>
        <p className="money mt-1 text-3xl font-bold tracking-tight">{formatMinor(bought.sum ?? 0, cur.currency)}</p>
        <p className="text-sm text-muted">в корзине{bought.unpriced > 0 && bought.priced + bought.unpriced > 0 ? ` · у ${bought.unpriced} нет цены` : ''}</p>
      </Card>

      <form onSubmit={add} className="mb-4 flex gap-2">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Новый товар"
          placeholder="Что купить?"
          maxLength={80}
          autoComplete="off"
          enterKeyHint="done"
          className="min-h-[48px] min-w-0 flex-1 rounded-2xl border border-border-strong bg-surface/80 px-3.5 text-base text-text placeholder:text-muted/80 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/20"
        />
        <Button type="submit" icon="plus" aria-label="Добавить товар" disabled={title.trim() === ''} />
      </form>

      {items.length === 0 ? (
        <EmptyState icon="cart" title="Добавьте первый товар" text="Впишите, что нужно купить. В магазине отмечайте купленное и вписывайте цены." />
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-border">
            {shown.map((i) => (
              <li key={i.id} className="flex items-stretch">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={i.checked}
                  aria-label={`Куплено: ${i.title}`}
                  onClick={() => void mutate((all) => all.map((x) => (x.id === i.id ? { ...x, checked: !x.checked } : x)))}
                  className="flex min-h-[60px] w-14 shrink-0 items-center justify-center"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-lg border-2 transition-colors',
                      i.checked ? 'border-brand bg-brand text-brand-fg' : 'border-border-strong bg-surface',
                    )}
                  >
                    {i.checked && <Icon name="check" size={18} />}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setItemId(i.id)}
                  aria-label={`Изменить: ${i.title}`}
                  className="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pr-4 text-left transition-colors hover:bg-surface-2/70 active:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate font-semibold', i.checked && 'text-muted line-through')}>{i.title}</span>
                    {qtyText(i) !== '' && <span className="block text-sm text-muted">{qtyText(i)}</span>}
                  </span>
                  <span className={cn('money shrink-0 font-semibold', !i.checked && 'text-muted')}>{priceText(i.priceMinor, cur.currency, !i.checked)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <Button size="lg" fullWidth icon="check" disabled={items.length === 0} onClick={() => setConfirmOpen(true)}>
          Подтвердить покупку
        </Button>
        <Button variant="ghost" fullWidth onClick={() => setDeleteOpen(true)}>
          Удалить список
        </Button>
      </div>

      {editing && (
        <ItemSheet
          key={editing.id}
          item={editing}
          currency={cur.currency}
          onClose={() => setItemId(null)}
          onSave={(next) => {
            setItemId(null);
            void mutate((all) => all.map((x) => (x.id === next.id ? next : x)));
          }}
          onDelete={() => {
            setItemId(null);
            void mutate((all) => all.filter((x) => x.id !== editing.id));
          }}
        />
      )}

      {confirmOpen && (
        <ConfirmSheet
          list={cur}
          items={items}
          onClose={() => setConfirmOpen(false)}
          onDone={(leftId) => {
            setConfirmOpen(false);
            toast.success('Покупка записана расходом');
            if (leftId) navigate(`/shopping/${leftId}`);
          }}
        />
      )}

      <Sheet
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Название списка"
        footer={
          <Button size="lg" fullWidth loading={busy} disabled={name.trim() === ''} onClick={() => void rename()}>
            Сохранить
          </Button>
        }
      >
        <TextInput label="Название" value={name} maxLength={SHOPPING_NAME_MAX} onChange={(e) => setName(e.target.value)} data-autofocus />
      </Sheet>
      {dialogs}
    </>
  );
}
