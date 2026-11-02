import { useState } from 'react';
import type { ChipOption } from '@/components/ChipPicker';
import { TextInput } from '@/components/Field';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { IconSelect } from '@/components/IconSelect';
import { MoneyText } from '@/components/MoneyText';
import { Segmented } from '@/components/Segmented';
import { CATEGORY_NAME_MAX, checkDraft, type DictCategory, type DictKind, type DraftExpense } from '@/domain/expensesAi';
import { currencyInfo } from '@/domain/currency';
import type { LocalRow, Wallet } from '@/domain/types';
import { suggestGlyph } from '@/features/categories/suggestGlyph';
import { walletOptions } from '@/features/transactions/ContextRow';
import { cn } from '@/lib/cn';
import { formatDayLabel } from '@/lib/dates';
import { canAutoFocusText } from '@/lib/pointer';

export interface DraftExpensesEditorProps {
  drafts: readonly DraftExpense[];
  onChange: (drafts: DraftExpense[]) => void;
  wallets: readonly LocalRow<Wallet>[];
  /** Категории расходов. */
  categories: readonly DictCategory[];
  /** Категории доходов. */
  incomeCategories?: readonly DictCategory[];
  today: string;
  /** Ошибки сохранения по номеру строки (поверх проверки полей). */
  errors?: ReadonlyMap<number, string>;
}

const KINDS: readonly { value: DictKind; label: string; tone: 'expense' | 'income' | 'brand' }[] = [
  { value: 'expense', label: 'Расход', tone: 'expense' },
  { value: 'income', label: 'Доход', tone: 'income' },
  { value: 'transfer', label: 'Перевод', tone: 'brand' },
];

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
export function NewCategory({
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
          autoFocus={canAutoFocusText()}
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
 * Список операций из диктовки (расходы, доходы, переводы): у каждой крупный значок категории, под названием — счёт (со значком), категория и дата,
 * справа сумма. Строку можно открыть и поправить (название, сумма, комиссия, счёт, категория значками, дата, заметка) или убрать.
 * Сумма и комиссия — в валюте выбранного счёта; в расход сохраняется сумма вместе с комиссией.
 */
export function DraftExpensesEditor({ drafts, onChange, wallets, categories, incomeCategories = [], today, errors }: DraftExpensesEditorProps) {
  const [open, setOpen] = useState<number | null>(null);
  const patch = (rid: number, p: Partial<DraftExpense>) => onChange(drafts.map((d) => (d.rid === rid ? { ...d, ...p } : d)));
  const remove = (rid: number) => onChange(drafts.filter((d) => d.rid !== rid));
  const walletChoices = walletOptions(wallets);
  const choicesOf = (list: readonly DictCategory[]): ChipOption[] => [
    { value: NO_CATEGORY, label: 'Без категории', icon: TAG },
    ...list.map((c) => ({ value: c.id, label: c.name, icon: c.icon, color: c.color })),
  ];
  const expenseChoices = choicesOf(categories);
  const incomeChoices = choicesOf(incomeCategories);
  // смена вида: категория прежнего вида не подходит, перевод без счёта назначения ждёт выбора
  const setKind = (d: DraftExpense, kind: DictKind) =>
    patch(d.rid, {
      kind,
      categoryId: '',
      newCategory: '',
      toWalletId: kind === 'transfer' ? (wallets.find((w) => w.id !== d.walletId && w.currency === wallets.find((x) => x.id === d.walletId)?.currency)?.id ?? '') : '',
    });

  return (
    <ul className="flex flex-col gap-2">
      {drafts.map((d) => {
        const wallet = wallets.find((w) => w.id === d.walletId);
        const toWallet = d.kind === 'transfer' ? wallets.find((w) => w.id === d.toWalletId) : undefined;
        const check = checkDraft(d, wallet?.currency, toWallet?.currency);
        const error = errors?.get(d.rid) ?? check.error;
        const list = d.kind === 'income' ? incomeCategories : categories;
        const choices = d.kind === 'income' ? incomeChoices : expenseChoices;
        const category = d.categoryId ? list.find((c) => c.id === d.categoryId) : undefined;
        const fresh = !category && d.newCategory ? d.newCategory : null;
        const catName = d.kind === 'transfer' ? 'Перевод' : (category?.name ?? (fresh ? `${fresh} · новая` : 'Без категории'));
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
                {d.kind === 'transfer' ? (
                  <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-brand/10 text-brand">
                    <Icon name="transfer" size={22} />
                  </span>
                ) : (
                  <Glyph value={catIcon} color={category?.color} size={44} className={fresh ? 'opacity-80' : undefined} />
                )}
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
                    {d.kind === 'transfer' && (
                      <Pill dashed={!toWallet}>
                        <span aria-hidden="true">→</span>
                        {toWallet ? <Glyph value={toWallet.icon ?? '👛'} color={toWallet.color} size={16} /> : null}
                        <span className="truncate">{toWallet ? toWallet.name : 'Куда?'}</span>
                      </Pill>
                    )}
                  </span>
                  {error && <span className="mt-1 block text-xs font-semibold text-danger">{error}</span>}
                </span>
                <span className="shrink-0 text-right">
                  {wallet && check.totalMinor !== null ? (
                    <>
                      <MoneyText
                        minor={d.kind === 'expense' ? -check.totalMinor : (check.receivedMinor ?? check.totalMinor)}
                        currency={wallet.currency}
                        tone={d.kind === 'expense' ? 'expense' : d.kind === 'income' ? 'income' : 'none'}
                        sign={d.kind === 'income' ? 'always' : undefined}
                        className="text-lg font-bold"
                      />
                      {check.feeMinor > 0 && <span className="block text-xs text-muted">{d.kind === 'transfer' ? 'и комиссия' : 'с комиссией'}</span>}
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
              <div className="flex flex-col gap-2 border-t border-border/60 px-3 pb-3 pt-2">
                <Segmented
                  ariaLabel={`Вид: ${label}`}
                  options={KINDS}
                  value={d.kind}
                  onChange={(kind) => setKind(d, kind)}
                  compact
                />
                <TextInput label="Название" value={d.title} maxLength={80} onChange={(e) => patch(d.rid, { title: e.target.value })} />
                <div className="grid grid-cols-2 gap-2">
                  <TextInput
                    label={`Сумма, ${currencyInfo(wallet?.currency ?? 'TJS').symbol}`}
                    inputMode="decimal"
                    value={d.amountText}
                    onChange={(e) => patch(d.rid, { amountText: e.target.value.replace('.', ',') })}
                  />
                  {d.kind !== 'income' && (
                    <TextInput
                      label="Комиссия"
                      inputMode="decimal"
                      placeholder="0"
                      value={d.feeText}
                      onChange={(e) => patch(d.rid, { feeText: e.target.value.replace('.', ',') })}
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold">{d.kind === 'transfer' ? 'Откуда' : 'Счёт'}</span>
                    <IconSelect
                      size="sm"
                      label={d.kind === 'transfer' ? 'Откуда' : 'Счёт'}
                      options={walletChoices}
                      value={d.walletId}
                      onChange={(id) => patch(d.rid, { walletId: id, walletGuessed: false, ...(id === d.toWalletId ? { toWalletId: '' } : {}) })}
                    />
                  </div>
                  {d.kind === 'transfer' ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-semibold">Куда</span>
                      <IconSelect
                        size="sm"
                        align="right"
                        label="Куда"
                        options={walletChoices.filter((o) => o.value !== d.walletId)}
                        value={d.toWalletId}
                        onChange={(id) => patch(d.rid, { toWalletId: id })}
                      />
                    </div>
                  ) : (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold">Категория</span>
                    <IconSelect
                      size="sm"
                      align="right"
                      label="Категория"
                      options={[
                        ...(d.newCategory
                          ? [{ value: NEW_PREFIX, label: `Новая: ${d.newCategory}`, icon: suggestGlyph(d.newCategory) }]
                          : []),
                        ...choices,
                      ]}
                      value={d.categoryId || (d.newCategory ? NEW_PREFIX : NO_CATEGORY)}
                      onChange={(v) => {
                        if (v === NEW_PREFIX) return patch(d.rid, { categoryId: '' });
                        patch(d.rid, v === NO_CATEGORY ? { categoryId: '', newCategory: '' } : { categoryId: v, newCategory: '' });
                      }}
                      footer={(close) => (
                        <NewCategory
                          existing={list}
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
                  )}
                </div>
                {/* у поля-календаря на iPhone своя минимальная ширина: без ограничений оно вылезает за край окна */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="min-w-0 overflow-hidden [&_input]:w-full [&_input]:min-w-0 [&_input]:max-w-full [&_input]:appearance-none">
                    <TextInput
                      label="Дата"
                      type="date"
                      value={d.date}
                      onChange={(e) => patch(d.rid, { date: e.target.value as DraftExpense['date'] })}
                    />
                  </div>
                  <TextInput label="Заметка" value={d.note} maxLength={200} onChange={(e) => patch(d.rid, { note: e.target.value })} />
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
