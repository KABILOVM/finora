import { useState } from 'react';
import { Button } from '@/components/Button';
import { ChipPicker } from '@/components/ChipPicker';
import { Field, inputClasses } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import type { Category, LocalRow, TxKind, Wallet } from '@/domain/types';
import { FieldGroup } from './FieldGroup';
import { activeFilterCount, EMPTY_SHEET_FILTERS, NO_CATEGORY, withKind, type SheetFilters } from './txFilters';

const KIND_OPTIONS: readonly { value: '' | TxKind; label: string }[] = [
  { value: '', label: 'Все виды' },
  { value: 'expense', label: 'Расходы' },
  { value: 'income', label: 'Доходы' },
  { value: 'transfer', label: 'Переводы' },
];

export interface FiltersSheetProps {
  /** Что включено сейчас: с этого шит начинает. */
  initial: SheetFilters;
  wallets: readonly LocalRow<Wallet>[];
  categories: readonly LocalRow<Category>[];
  /** «Применить»: выбранное попадает в список. Закрытие без «Применить» ничего не меняет. */
  onApply: (next: SheetFilters) => void;
  onClose: () => void;
}

/**
 * Шит «Фильтры»: кошелёк, вид и категория. Выбор копится здесь и попадает в список только по «Применить»;
 * «Сбросить» очищает выбор в шите (список обновится после «Применить»). Свернули шит — список остался прежним.
 */
export function FiltersSheet({ initial, wallets, categories, onApply, onClose }: FiltersSheetProps) {
  const [draft, setDraft] = useState<SheetFilters>(initial);
  const expense = categories.filter((c) => c.kind === 'expense');
  const income = categories.filter((c) => c.kind === 'income');
  const nameOf = (c: LocalRow<Category>) => (c.archivedAt === null ? c.name : `${c.name} (в архиве)`);
  const transfers = draft.kind === 'transfer';

  const onKind = (value: string) => {
    const kind = value as '' | TxKind;
    const chosen = categories.find((c) => c.id === draft.categoryId);
    setDraft((cur) => withKind(cur, kind, chosen?.kind));
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Фильтры"
      footer={
        <div className="grid grid-cols-2 gap-2">
          {/* Пока сбрасывать нечего, кнопка неактивна, но читается (контраст не падает от «затемнения» disabled). */}
          <Button
            variant="secondary"
            size="lg"
            className="disabled:!opacity-100 disabled:!text-muted"
            disabled={activeFilterCount(draft) === 0}
            onClick={() => setDraft(EMPTY_SHEET_FILTERS)}
          >
            Сбросить
          </Button>
          <Button size="lg" onClick={() => onApply(draft)}>
            Применить
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field id="filter-wallet" label="Кошелёк">
          <select
            id="filter-wallet"
            value={draft.walletId}
            onChange={(e) => setDraft((cur) => ({ ...cur, walletId: e.target.value }))}
            className={`${inputClasses(false)} min-h-[48px]`}
          >
            <option value="">Все кошельки</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.archivedAt === null ? w.name : `${w.name} (в архиве)`}
              </option>
            ))}
          </select>
        </Field>

        <FieldGroup label="Вид операции">
          <ChipPicker ariaLabel="Вид операции" options={KIND_OPTIONS} value={draft.kind} onChange={onKind} />
        </FieldGroup>

        <Field id="filter-category" label="Категория" hint={transfers ? 'У переводов категорий нет.' : undefined}>
          <select
            id="filter-category"
            value={draft.categoryId}
            disabled={transfers}
            onChange={(e) => setDraft((cur) => ({ ...cur, categoryId: e.target.value }))}
            className={`${inputClasses(false)} min-h-[48px]`}
          >
            <option value="">Все категории</option>
            <option value={NO_CATEGORY}>Без категории</option>
            {draft.kind !== 'income' && expense.length > 0 && (
              <optgroup label="Расходы">
                {expense.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nameOf(c)}
                  </option>
                ))}
              </optgroup>
            )}
            {draft.kind !== 'expense' && income.length > 0 && (
              <optgroup label="Доходы">
                {income.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nameOf(c)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
      </div>
    </Sheet>
  );
}
