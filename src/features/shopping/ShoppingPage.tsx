import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/Toast';
import { safeItems, useShoppingLists, useStore } from '@/db';
import { formatMinor } from '@/domain/money';
import type { LocalRow, ShoppingList } from '@/domain/types';
import { humanError } from '@/features/transactions/txActions';
import { useToday } from '@/recurring/useToday';
import { itemsWord, plannedTotals, progressText } from './shoppingText';

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** '2026-10-12' → '12 окт'. */
function shortDate(iso: string | null): string {
  const m = iso ? /^\d{4}-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${Number(m[2])} ${MONTHS_SHORT[Number(m[1]) - 1] ?? ''}` : '';
}

function Row({ list }: { list: LocalRow<ShoppingList> }) {
  const items = safeItems(list);
  const planned = plannedTotals(items);
  const done = list.status === 'done';
  return (
    <Link
      to={`/shopping/${list.id}`}
      className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/70 active:bg-surface-2"
    >
      <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${done ? 'bg-income/10 text-income' : 'bg-brand/10 text-brand'}`}>
        <Icon name={done ? 'check' : 'cart'} size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{list.name}</span>
        <span className="block truncate text-sm text-muted">
          {done ? `${shortDate(list.doneOn)} · ${itemsWord(items.length)}` : items.length === 0 ? 'Пока пусто' : progressText(items)}
        </span>
      </span>
      <span className="money shrink-0 text-right font-semibold">
        {done
          ? formatMinor(list.totalMinor ?? 0, list.currency)
          : planned.sum !== null && planned.sum > 0
            ? `≈ ${formatMinor(planned.sum, list.currency)}`
            : ''}
      </span>
      <Icon name="chevron" size={18} className="shrink-0 text-muted" />
    </Link>
  );
}

/** «Покупки»: открытые списки сверху, ниже история подтверждённых покупок. */
export default function ShoppingPage() {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const today = useToday();
  const lists = useShoppingLists();
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const l = await store.shopping.create({ name: `Покупки ${shortDate(today)}` });
      navigate(`/shopping/${l.id}`);
    } catch (e) {
      console.error('Не удалось создать список:', e);
      toast.error(humanError(e, 'Не удалось создать список'));
      setBusy(false);
    }
  };

  const open = (lists ?? []).filter((l) => l.status === 'open');
  const done = (lists ?? []).filter((l) => l.status === 'done');

  return (
    <>
      <PageHeader title="Покупки" actions={<Button icon="plus" aria-label="Новый список" loading={busy} onClick={() => void create()}>Новый</Button>} />
      {lists === undefined ? (
        <p role="status" className="py-10 text-center text-muted">
          Загружаем…
        </p>
      ) : lists.length === 0 ? (
        <EmptyState
          icon="cart"
          title="Списков пока нет"
          text="Составьте список дома, а в магазине отмечайте купленное и вписывайте цены. Одно нажатие, и покупка запишется расходом."
          action={
            <Button size="lg" icon="plus" loading={busy} onClick={() => void create()}>
              Составить первый список
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          {open.length > 0 && (
            <section aria-labelledby="shop-open">
              <h2 id="shop-open" className="mb-2 text-lg font-bold">
                Списки
              </h2>
              <Card padding="none">
                <ul className="divide-y divide-border">
                  {open.map((l) => (
                    <li key={l.id}>
                      <Row list={l} />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
          {done.length > 0 && (
            <section aria-labelledby="shop-done">
              <h2 id="shop-done" className="mb-2 text-lg font-bold">
                История покупок
              </h2>
              <Card padding="none">
                <ul className="divide-y divide-border">
                  {done.map((l) => (
                    <li key={l.id}>
                      <Row list={l} />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </div>
      )}
    </>
  );
}
