import { useState } from 'react';
import type { ChipOption } from '@/components/ChipPicker';
import { TextInput } from '@/components/Field';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { IconSelect } from '@/components/IconSelect';
import { MoneyText } from '@/components/MoneyText';
import { CATEGORY_NAME_MAX, checkDraft, type DictCategory, type DraftExpense } from '@/domain/expensesAi';
import { currencyInfo } from '@/domain/currency';
import type { LocalRow, Wallet } from '@/domain/types';
import { suggestGlyph } from '@/features/categories/suggestGlyph';
import { walletOptions } from '@/features/transactions/ContextRow';
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
const NO_CATEGORY = '__none__';
const TAG = suggestGlyph('');

/** Небольшая «таблетка» с значком: счёт, категория, дата. */
function Pill({ children, dashed, tone }: { children: React.ReactNode; dashed?: boolean; tone?: 'brand' }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold',
        dashed
          ? 'border-dashed border-border-strong text-muted'
          : tone === 'brand'
            ? 'border-brand/30 bg-brand/10 text-brand'
            : 'border-border bg-surface text-text',
      )}
    >
      {children}
    </span>
  );
}

/**
 * «+ Новая категория» внутри списка категорий: пишете название — значок подберётся сам. Такая уже есть — выбирается она.
 * Категория создаётся при сохранении расходов, поэтому здесь запоминается только название.
 */
function NewCategory({
  existing,
  onPick,
  onCreate,
}: {
  existing: readonly DictCategory[];
  onPick: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (clean === '') return setProblem('Введите название');
    if ([...clean].length > CATEGORY_NAME_MAX) return setProblem(`Не длиннее ${CATEGORY_NAME_MAX} символов`);
    const twin = existing.find((c) => c.name.trim().toLocaleLowerCase('ru') === clean.toLocaleLowerCase('ru'));
    if (twin) return onPick(twin.id);
    onCreate(clean);
  };

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2 text-left font-semibold text-brand active:bg-surface-2"
      >
        <span className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-dashed border-brand/50">
          <Icon name="plus" size={18} />
        </span>
        Новая категория
      </button>
    );
  }
  return (
    <form
      className="flex flex-col gap-1 p-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          maxLength={CATEGORY_NAME_MAX}
          onChange={(e) => {
            setName(e.target.value);
            setProblem(null);
          }}
          placeholder="Название"
          aria-label="Название новой категории"
          onKeyDown={(e) => {
            // Enter добавляет категорию, а не сохраняет все расходы
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          autoComplete="off"
          enterKeyHint="done"
          className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-base outline-none focus:border-brand"
        />
        <button type="submit" className="min-h-[44px] rounded-xl bg-brand px-4 font-semibold text-brand-fg">
          Добавить
        </button>
      </div>
      {problem && (
        <p role="alert" className="text-sm font-medium text-danger">
          {problem}
        </p>
      )}
    </form>
  );
}

/**
 * Список расходов из диктовки: у каждого расхода крупный значок категории, под названием — счёт (со значком), категория и дата,
 * справа сумма. Строку можно открыть и поправить (название, сумма, комиссия, счёт, категория значками, дата, заметка) или убрать.
 * Сумма и комиссия — в валюте выбранного счёта; в расход сохраняется сумма вместе с комиссией.
 */
export function DraftExpensesEditor({ drafts, onChange, wallets, categories, today, errors }: DraftExpensesEditorProps) {
  const [open, setOpen] = useState<number | null>(null);
  const patch = (rid: number, p: Partial<DraftExpense>) => onChange(drafts.map((d) => (d.rid === rid ? { ...d, ...p } : d)));
  const remove = (rid: number) => onChange(drafts.filter((d) => d.rid !== rid));
  const walletChoices = walletOptions(wallets);
  const categoryChoices: ChipOption[] = [
    { value: NO_CATEGORY, label: 'Без категории', icon: TAG },
    ...categories.map((c) => ({ value: c.id, label: c.name, icon: c.icon, color: c.color })),
  ];

  return (
    <ul className="flex flex-col gap-2">
      {drafts.map((d) => {
        const wallet = wallets.find((w) => w.id === d.walletId);
        const check = checkDraft(d, wallet?.currency);
        const error = errors?.get(d.rid) ?? check.error;
        const category = d.categoryId ? categories.find((c) => c.id === d.categoryId) : undefined;
        const fresh = !category && d.newCategory ? d.newCategory : null;
        const catName = category?.name ?? (fresh ? `${fresh} · новая` : 'Без категории');
        const catIcon = category?.icon ?? (fresh ? suggestGlyph(fresh) : TAG);
        const isOpen = open === d.rid;
        const label = d.title || 'Без названия';
        return (
          <li
            key={d.rid}
            data-testid="draft-expense"
            className={cn(
              'rounded-2xl border bg-surface shadow-[0_8px_18px_-16px_rgb(var(--brand)/0.6)]',
              error ? 'border-danger/50' : isOpen ? 'border-brand/50' : 'border-border/70',
            )}
          >
            <div className="flex items-center gap-1 pr-1">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`Изменить: ${label}`}
                onClick={() => setOpen(isOpen ? null : d.rid)}
                className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2 text-left active:bg-surface-2"
              >
                <Glyph value={catIcon} color={category?.color} size={44} className={fresh ? 'opacity-80' : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-bold">{label}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <Pill tone={fresh ? 'brand' : undefined}>
                      <span className="truncate">{catName}</span>
                    </Pill>
                    <Pill dashed={!wallet || d.walletGuessed}>
                      {wallet ? <Glyph value={wallet.icon ?? '👛'} color={wallet.color} size={16} /> : null}
                      <span className="truncate">{wallet ? wallet.name : 'Счёт не выбран'}</span>
                    </Pill>
                  </span>
                  {error && <span className="mt-1 block text-xs font-semibold text-danger">{error}</span>}
                </span>
                <span className="shrink-0 text-right">
                  {wallet && check.totalMinor !== null ? (
                    <>
                      <MoneyText minor={-check.totalMinor} currency={wallet.currency} tone="expense" className="text-lg font-bold" />
                      {check.feeMinor > 0 && <span className="block text-xs text-muted">с комиссией</span>}
                    </>
                  ) : (
                    <span className="block text-lg text-muted">—</span>
                  )}
                  <span className="block whitespace-nowrap text-xs text-muted">{formatDayLabel(d.date, today)}</span>
                </span>
                <Icon name="chevron" size={16} className={cn('shrink-0 text-muted transition-transform', isOpen && 'rotate-90')} />
              </button>
              <IconButton icon="close" iconSize={18} label={`Убрать: ${label}`} onClick={() => remove(d.rid)} />
            </div>
            {isOpen && (
              <div className="flex flex-col gap-3 border-t border-border/60 px-3 pb-3 pt-3">
                <TextInput label="Название" value={d.title} maxLength={80} onChange={(e) => patch(d.rid, { title: e.target.value })} />
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
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold">Счёт</span>
                  <IconSelect
                    label="Счёт"
                    options={walletChoices}
                    value={d.walletId}
                    onChange={(id) => patch(d.rid, { walletId: id, walletGuessed: false })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold">Категория</span>
                  <IconSelect
                    label="Категория"
                    options={[
                      ...(d.newCategory
                        ? [{ value: NEW_PREFIX, label: `Новая: ${d.newCategory}`, icon: suggestGlyph(d.newCategory) }]
                        : []),
                      ...categoryChoices,
                    ]}
                    value={d.categoryId || (d.newCategory ? NEW_PREFIX : NO_CATEGORY)}
                    onChange={(v) => {
                      if (v === NEW_PREFIX) return patch(d.rid, { categoryId: '' });
                      patch(d.rid, v === NO_CATEGORY ? { categoryId: '', newCategory: '' } : { categoryId: v, newCategory: '' });
                    }}
                    footer={(close) => (
                      <NewCategory
                        existing={categories}
                        onPick={(id) => {
                          patch(d.rid, { categoryId: id, newCategory: '' });
                          close();
                        }}
                        onCreate={(name) => {
                          patch(d.rid, { categoryId: '', newCategory: name });
                          close();
                        }}
                      />
                    )}
                  />
                </div>
                <TextInput
                  label="Дата"
                  type="date"
                  value={d.date}
                  onChange={(e) => patch(d.rid, { date: e.target.value as DraftExpense['date'] })}
                />
                <TextInput label="Заметка" value={d.note} maxLength={200} onChange={(e) => patch(d.rid, { note: e.target.value })} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
