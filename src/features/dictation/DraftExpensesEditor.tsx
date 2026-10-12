import { useState } from 'react';
import { Field, inputClasses, TextInput } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MoneyText } from '@/components/MoneyText';
import { checkDraft, type DictCategory, type DraftExpense } from '@/domain/expensesAi';
import { currencyInfo } from '@/domain/currency';
import type { LocalRow, Wallet } from '@/domain/types';
import { cn } from '@/lib/cn';
import { formatDayLabel } from '@/lib/dates';

export interface DraftExpensesEditorProps {
  drafts: readonly DraftExpense[];
  onChange: (drafts: DraftExpense[]) => void;
  wallets: readonly LocalRow<Wallet>[];
  categories: readonly DictCategory[];
  today: string;
  /** Ошибки сохранения по номеру строки (поверх проверки полей). */
  errors?: ReadonlyMap<number, string>;
}

const NEW_PREFIX = '__new__';
const SELECT = cn(inputClasses(false), 'min-h-[48px]');

/**
 * Список расходов из диктовки: каждую строку можно открыть и поправить (название, сумма, комиссия, счёт, категория, дата, заметка)
 * или убрать. Сумма и комиссия — в валюте выбранного счёта; в расход сохраняется сумма вместе с комиссией.
 */
export function DraftExpensesEditor({ drafts, onChange, wallets, categories, today, errors }: DraftExpensesEditorProps) {
  const [open, setOpen] = useState<number | null>(null);
  const patch = (rid: number, p: Partial<DraftExpense>) => onChange(drafts.map((d) => (d.rid === rid ? { ...d, ...p } : d)));
  const remove = (rid: number) => onChange(drafts.filter((d) => d.rid !== rid));

  return (
    <ul className="divide-y divide-border rounded-2xl bg-surface-2 px-1">
      {drafts.map((d) => {
        const wallet = wallets.find((w) => w.id === d.walletId);
        const check = checkDraft(d, wallet?.currency);
        const error = errors?.get(d.rid) ?? check.error;
        const catName = d.categoryId ? categories.find((c) => c.id === d.categoryId)?.name : d.newCategory ? `${d.newCategory} (новая)` : undefined;
        const isOpen = open === d.rid;
        const label = d.title || 'Без названия';
        return (
          <li key={d.rid} className="py-0.5" data-testid="draft-expense">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`Изменить: ${label}`}
                onClick={() => setOpen(isOpen ? null : d.rid)}
                className="flex min-h-[56px] min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left active:bg-border/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{label}</span>
                  <span className="block truncate text-xs text-muted">
                    {[catName ?? 'Без категории', wallet ? wallet.name + (d.walletGuessed ? ' (по умолчанию)' : '') : 'Счёт не выбран', formatDayLabel(d.date, today)].join(' · ')}
                  </span>
                  {error && <span className="block text-xs font-medium text-danger">{error}</span>}
                </span>
                <span className="shrink-0 text-right">
                  {wallet && check.totalMinor !== null ? (
                    <>
                      <MoneyText minor={-check.totalMinor} currency={wallet.currency} tone="expense" />
                      {check.feeMinor > 0 && <span className="block text-xs text-muted">с комиссией</span>}
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </span>
                <Icon name="chevron" size={16} className={cn('shrink-0 text-muted transition-transform', isOpen && 'rotate-90')} />
              </button>
              <IconButton icon="close" iconSize={18} label={`Убрать: ${label}`} onClick={() => remove(d.rid)} />
            </div>
            {isOpen && (
              <div className="flex flex-col gap-3 px-2 pb-3 pt-1">
                <TextInput label="Название" value={d.title} maxLength={80} onChange={(e) => patch(d.rid, { title: e.target.value })} />
                <Field id={`w-${d.rid}`} label="Счёт">
                  <select
                    id={`w-${d.rid}`}
                    className={SELECT}
                    value={d.walletId}
                    onChange={(e) => patch(d.rid, { walletId: e.target.value, walletGuessed: false })}
                  >
                    {wallets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} · {w.currency}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <TextInput
                    label={`Сумма, ${currencyInfo(wallet?.currency ?? 'TJS').symbol}`}
                    inputMode="decimal"
                    value={d.amountText}
                    onChange={(e) => patch(d.rid, { amountText: e.target.value.replace('.', ',') })}
                  />
                  <TextInput
                    label="Комиссия"
                    inputMode="decimal"
                    placeholder="0"
                    value={d.feeText}
                    onChange={(e) => patch(d.rid, { feeText: e.target.value.replace('.', ',') })}
                  />
                </div>
                <Field id={`c-${d.rid}`} label="Категория">
                  <select
                    id={`c-${d.rid}`}
                    className={SELECT}
                    value={d.categoryId || (d.newCategory ? NEW_PREFIX : '')}
                    onChange={(e) => {
                      const v = e.target.value;
                      patch(d.rid, v === NEW_PREFIX ? {} : { categoryId: v, newCategory: '' });
                    }}
                  >
                    <option value="">Без категории</option>
                    {d.newCategory && <option value={NEW_PREFIX}>{`Новая: ${d.newCategory}`}</option>}
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <TextInput label="Дата" type="date" value={d.date} onChange={(e) => patch(d.rid, { date: e.target.value as DraftExpense['date'] })} />
                <TextInput label="Заметка" value={d.note} maxLength={200} onChange={(e) => patch(d.rid, { note: e.target.value })} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
