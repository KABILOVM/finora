import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { useShoppingItems } from '@/db';
import { activeItems, itemTitle } from '@/domain/shopping';
import { pluralRu } from '@/lib/plural';
import { blockCardClass, BlockBusy, BlockEmpty, BlockTitle } from './BlockParts';

/** Сколько позиций показываем: во всю ширину и в половину. */
export const SHOPPING_ROWS = 4;
export const SHOPPING_ROWS_HALF = 2;

/**
 * Блок «Покупки» на «Главной» (по умолчанию скрыт, включается в настройке главной): сколько позиций осталось купить и первые из
 * них; то, что уже лежит в корзине (отмечено флажком), показано зачёркнутым. Отмечать и покупать — в разделе «Покупки», куда
 * ведёт заголовок.
 */
export default function ShoppingHomeCard({ half = false }: { half?: boolean }) {
  const items = useShoppingItems();
  const active = items ? activeItems(items) : [];
  // сначала то, что ещё не в корзине: именно это человеку надо найти в магазине
  const sorted = [...active.filter((i) => i.checkedAt === null), ...active.filter((i) => i.checkedAt !== null)];
  const left = active.filter((i) => i.checkedAt === null).length;
  const limit = half ? SHOPPING_ROWS_HALF : SHOPPING_ROWS;
  const more = sorted.length - limit;
  return (
    <Card aria-labelledby="home-shopping" data-testid="shopping-card" className={blockCardClass(half)}>
      <BlockTitle id="home-shopping" to="/shopping" icon="cart" tone="bg-brand/10 text-brand" label="Покупки: открыть список" half={half}>
        Покупки
      </BlockTitle>
      {items === undefined ? (
        <BlockBusy />
      ) : active.length === 0 ? (
        <BlockEmpty text="Список пуст." to="/shopping" action="Добавить покупки" />
      ) : (
        <>
          <p data-testid="home-shopping-count" className="mt-1 text-sm text-muted">
            {left > 0 ? (
              <>
                Осталось купить: <span className="font-semibold text-text">{left} {pluralRu(left, 'позиция', 'позиции', 'позиций')}</span>
              </>
            ) : (
              'Всё в корзине — осталось оплатить'
            )}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {sorted.slice(0, limit).map((it) => (
              <li key={it.id} className="flex items-center gap-2 text-sm" data-testid="home-shopping-row">
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${it.checkedAt !== null ? 'border-income bg-income text-brand-fg' : 'border-border-strong'}`}
                >
                  {it.checkedAt !== null && <Icon name="check" size={11} strokeWidth={3} />}
                </span>
                <span className={`min-w-0 truncate ${it.checkedAt !== null ? 'text-muted line-through' : 'font-medium'}`}>{itemTitle(it.name, it.qtyMilli, it.unit)}</span>
              </li>
            ))}
          </ul>
          {more > 0 && <p className="mt-1.5 text-sm text-muted">и ещё {more}</p>}
        </>
      )}
    </Card>
  );
}
