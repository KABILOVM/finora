import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { minorToDraft } from '@/components/amountText';
import { inputClasses, TextInput } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Segmented } from '@/components/Segmented';
import { Sheet } from '@/components/Sheet';
import { normName } from '@/domain/products/catalog';
import type { PriceBook } from '@/domain/products/stats';
import { expectedPrice, formatQty, itemTitle, NAME_MAX, SHOPPING_UNITS, UNIT_LABEL } from '@/domain/shopping';
import type { CurrencyCode, ShoppingUnit } from '@/domain/types';
import { cn } from '@/lib/cn';
import { pluralRu } from '@/lib/plural';
import { moneyText, priceLine } from './productText';
import { checkLines, statsOfName, totalOfLines, viewLine, type PurchaseLine } from './purchase';
import { searchProducts, type Choice } from './suggest';
import { useProductsData } from './useProductsData';
import { canAutoFocusText } from '@/lib/pointer';

const UNITS = SHOPPING_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }));
/** Сколько подсказок показываем под строкой поиска. */
const SUGGEST_MAX = 8;

function picksFor(query: string, book: PriceBook): Choice[] {
  if (normName(query) === '') {
    // Пока ничего не набрано — то, что покупали недавно: чаще всего это и нужно
    return [...book.values()]
      .sort((a, b) => (a.lastAt !== b.lastAt ? (a.lastAt < b.lastAt ? 1 : -1) : a.name < b.name ? -1 : 1))
      .slice(0, SUGGEST_MAX)
      .map((s) => ({ key: `h:${s.key}|${s.unit}`, name: s.name, unit: s.unit, stats: s }));
  }
  const all = searchProducts(query, book, SUGGEST_MAX);
  // Своё название, которого нет в подсказках: его можно добавить как есть (потом оно появится в «Мои продукты»)
  if (!all.some((p) => normName(p.name) === normName(query))) all.push({ key: 'new', name: query.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX), unit: 'pcs', stats: null, fresh: true });
  return all;
}

export interface PurchasesSheetProps {
  lines: readonly PurchaseLine[];
  onChange: (lines: PurchaseLine[]) => void;
  currency: CurrencyCode;
  /** Какую строку раскрыть сразу (например, ту, на которой не удалось сохранить). */
  focusRid?: number | null;
  /** Сообщения об ошибках по номеру строки. */
  errors?: ReadonlyMap<number, string>;
  onClose: () => void;
}

/**
 * «Что куплено»: продукты чека. Поиск по каталогу и своим продуктам, у каждой строки — количество, единица и сумма за всё;
 * цена за единицу считается сама и сравнивается с прошлой и средней. Сумма расхода будет равна сумме строк.
 */
export function PurchasesSheet({ lines, onChange, currency, focusRid = null, errors, onClose }: PurchasesSheetProps) {
  const data = useProductsData();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<number | null>(focusRid);
  const [shownErrors, setShownErrors] = useState<ReadonlyMap<number, string>>(errors ?? new Map());
  const book = data?.book;

  const picks = useMemo(() => (book ? picksFor(query, book) : []), [query, book]);
  const total = totalOfLines(lines, currency);

  const patch = (rid: number, p: Partial<PurchaseLine>) => {
    onChange(lines.map((l) => (l.rid === rid ? { ...l, ...p } : l)));
    if (shownErrors.has(rid)) setShownErrors((m) => new Map([...m].filter(([k]) => k !== rid)));
  };
  const add = (pick: Choice) => {
    const rid = lines.reduce((m, l) => Math.max(m, l.rid), 0) + 1;
    onChange([...lines, { rid, name: pick.name, unit: pick.unit, qtyText: '1', amountText: '' }]);
    setOpen(rid);
    setQuery('');
  };
  const done = () => {
    const r = checkLines(lines, currency);
    // пустой список — не ошибка: покупку можно внести и без продуктов; недописанные строки закрывать нельзя
    if (!r.ok && lines.length > 0) {
      if (r.rid !== null) {
        setShownErrors(new Map([[r.rid, r.message]]));
        setOpen(r.rid);
      }
      return;
    }
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Что куплено"
      footer={
        <div className="flex flex-col gap-2">
          {lines.length > 0 && (
            <p className="flex items-baseline justify-between gap-3 px-1 text-base">
              <span className="text-muted">
                Итого · {lines.length} {pluralRu(lines.length, 'продукт', 'продукта', 'продуктов')}
              </span>
              <span className="money text-lg font-bold">{total === null ? '—' : moneyText(total, currency)}</span>
            </p>
          )}
          <Button size="lg" fullWidth onClick={done}>
            Готово
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Необязательно. Впишите, что купили и за сколько: сумма операции станет суммой продуктов, а цены запомнятся для следующих покупок.
        </p>

        {lines.length > 0 && (
          <ul className="divide-y divide-border rounded-2xl bg-surface-2/70 px-1" data-testid="purchase-lines">
            {lines.map((l) => (
              <LineItem
                key={l.rid}
                line={l}
                currency={currency}
                book={book}
                open={open === l.rid}
                error={shownErrors.get(l.rid) ?? null}
                onToggle={() => setOpen(open === l.rid ? null : l.rid)}
                onPatch={(p) => patch(l.rid, p)}
                onRemove={() => {
                  onChange(lines.filter((x) => x.rid !== l.rid));
                  if (open === l.rid) setOpen(null);
                }}
              />
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2">
          <input
            type="search"
            inputMode="search"
            aria-label="Найти продукт"
            placeholder={lines.length === 0 ? 'Найти продукт: картошка, молоко…' : 'Добавить ещё продукт…'}
            autoComplete="off"
            value={query}
            maxLength={60}
            onChange={(e) => setQuery(e.target.value)}
            className={`${inputClasses(false)} min-h-[48px]`}
          />
          {data === undefined ? (
            <p role="status" className="py-2 text-center text-sm text-muted">
              Загрузка…
            </p>
          ) : data === null ? (
            <p className="py-2 text-center text-sm text-muted">Данные ещё загружаются: подождите немного.</p>
          ) : (
            <>
              {query.trim() === '' && picks.length > 0 && <h3 className="px-1 text-sm font-bold text-muted">Недавно покупали</h3>}
              {picks.length > 0 && (
                <ul className="divide-y divide-border rounded-2xl border border-border bg-surface/80" aria-label="Подсказки">
                  {picks.map((p) => (
                    <li key={p.key}>
                      <button
                        type="button"
                        onClick={() => add(p)}
                        className="flex min-h-[56px] w-full items-center gap-3 px-3.5 py-2 text-left active:bg-border/50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.fresh ? `Добавить «${p.name}»` : p.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {p.fresh ? 'Свой продукт: появится в «Мои продукты»' : priceLine(p.stats, p.unit, currency)}
                          </span>
                        </span>
                        <Icon name="plus" size={18} className="shrink-0 text-brand" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}

interface LineItemProps {
  line: PurchaseLine;
  currency: CurrencyCode;
  book: PriceBook | undefined;
  open: boolean;
  error: string | null;
  onToggle: () => void;
  onPatch: (p: Partial<PurchaseLine>) => void;
  onRemove: () => void;
}

/** Одна строка: свёрнутая — название, количество, цена за единицу и сумма; раскрытая — поля для правки. */
function LineItem({ line, currency, book, open, error, onToggle, onPatch, onRemove }: LineItemProps) {
  const v = viewLine(line, currency);
  const label = line.name.trim() || 'Без названия';
  const stats = book ? statsOfName(book, line.name, line.unit) : null;
  const expected = stats !== null && v.qtyMilli !== null ? expectedPrice(stats.lastUnitMinor, v.qtyMilli) : null;
  const sub = [
    v.qtyMilli !== null ? (line.unit === 'pcs' && v.qtyMilli === 1000 ? '1 шт' : `${formatQty(v.qtyMilli)} ${UNIT_LABEL[line.unit]}`) : null,
    v.unitMinor !== null ? `${moneyText(v.unitMinor, currency)} за ${UNIT_LABEL[line.unit]}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li data-testid="purchase-line" className="py-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Изменить: ${label}`}
          onClick={onToggle}
          className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1 text-left active:bg-border/50"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{v.qtyMilli !== null && !(line.unit === 'pcs' && v.qtyMilli === 1000) ? itemTitle(label, v.qtyMilli, line.unit) : label}</span>
            {error ? <span className="block text-xs font-semibold text-danger">{error}</span> : sub !== '' && <span className="block truncate text-xs text-muted">{sub}</span>}
          </span>
          <span className="shrink-0 text-right font-semibold">
            {v.amountMinor !== null && v.amountMinor > 0 ? <span className="money">{moneyText(v.amountMinor, currency)}</span> : <span className="text-muted">—</span>}
          </span>
          <Icon name="chevron" size={16} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-90')} />
        </button>
        <IconButton icon="close" iconSize={18} label={`Убрать: ${label}`} onClick={onRemove} />
      </div>
      {open && (
        <div className="flex flex-col gap-2 px-2 pb-3 pt-1">
          <TextInput label="Название" value={line.name} maxLength={NAME_MAX} autoComplete="off" onChange={(e) => onPatch({ name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <TextInput label="Количество" inputMode="decimal" value={line.qtyText} onChange={(e) => onPatch({ qtyText: e.target.value.replace('.', ',') })} />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Единица</span>
              <Segmented ariaLabel={`Единица: ${label}`} options={UNITS} value={line.unit} onChange={(unit: ShoppingUnit) => onPatch({ unit })} compact />
            </div>
          </div>
          <TextInput
            label="Сумма за всё"
            inputMode="decimal"
            placeholder="0"
            autoComplete="off"
            autoFocus={line.amountText === '' && canAutoFocusText()}
            value={line.amountText}
            onChange={(e) => onPatch({ amountText: e.target.value.replace('.', ',') })}
            {...(v.unitMinor !== null ? { hint: `Цена: ${moneyText(v.unitMinor, currency)} за ${UNIT_LABEL[line.unit]}` } : {})}
          />
          {stats !== null && (
            <p className="text-sm text-muted">
              Прошлый раз {moneyText(stats.lastUnitMinor, currency)}, в среднем {moneyText(stats.avgUnitMinor, currency)} за {UNIT_LABEL[stats.unit]}
            </p>
          )}
          {line.amountText.trim() === '' && expected !== null && expected > 0 && (
            <Button variant="secondary" size="md" onClick={() => onPatch({ amountText: minorToDraft(expected, currency) })}>
              Подставить {moneyText(expected, currency)} по прошлой цене
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
