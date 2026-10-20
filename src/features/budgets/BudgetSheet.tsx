import { useMemo, useRef, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { Field, inputClasses } from '@/components/Field';
import { Glyph } from '@/components/Glyph';
import { cn } from '@/lib/cn';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { ValidationError, useStore } from '@/db';
import { formatMinor } from '@/domain/money';
import type { Budget, Category, CurrencyCode, LocalRow, Minor, UUID } from '@/domain/types';
import { UNDO_MS } from '@/features/transactions/txActions';
import { categoryCovers } from '@/domain/budgetLevels';
import { limitHints } from './budgetHints';
import { budgetLabel } from './budgetText';
import { useSpendingHistory } from './useSpendingHistory';

const TOTAL = 'total';

export interface BudgetSheetProps {
  /** null — новый лимит; иначе правка суммы существующего (категорию у бюджета менять нельзя: она задаёт его номер). */
  budget: LocalRow<Budget> | null;
  /** Основная валюта: лимит всегда в ней. */
  base: CurrencyCode;
  /** Все живые бюджеты, в том числе архивные: по ним видно, что лимит на категорию уже есть. */
  budgets: readonly LocalRow<Budget>[];
  /** Категории расходов, которые можно выбрать (не архивные). */
  categories: readonly LocalRow<Category>[];
  /** Все категории (для названия при правке и родителей подкатегорий). */
  names: ReadonlyMap<UUID, Pick<Category, 'name' | 'icon' | 'color'> & { parentId?: UUID | null }>;
  onClose: () => void;
}

/** Что сказать человеку, если лимит на эту область уже есть (создание в репозитории обновит его, а не заведёт второй). */
function existingNote(existing: LocalRow<Budget> | undefined, isTotal: boolean): string | null {
  if (!existing) return null;
  if (existing.archivedAt !== null) return 'Такой лимит лежал в архиве — вернём его с новой суммой.';
  return isTotal ? 'Общий лимит уже есть — изменим сумму.' : 'Лимит на эту категорию уже есть — изменим сумму.';
}

interface ScopeOption {
  id: UUID;
  name: string;
  /** Глубина вложенности: подкатегории идут под родителем со сдвигом. */
  depth: number;
}

/** Категории деревом: родитель, под ним его подкатегории. Категория, чьего родителя нет в списке (архив), считается верхней. */
function scopeOptions(categories: readonly LocalRow<Category>[]): ScopeOption[] {
  const ids = new Set(categories.map((c) => c.id));
  const children = new Map<UUID | null, LocalRow<Category>[]>();
  for (const c of categories) {
    const parent = c.parentId !== null && ids.has(c.parentId) ? c.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), c]);
  }
  const out: ScopeOption[] = [];
  const seen = new Set<UUID>();
  const walk = (parent: UUID | null, depth: number) => {
    for (const c of children.get(parent) ?? []) {
      if (seen.has(c.id)) continue; // защита от петли в данных
      seen.add(c.id);
      out.push({ id: c.id, name: c.name, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  // Категории «в кольце» родителей (A → B → A, их мог создать слияние данных с двух устройств) обходом от корня недостижимы — не теряем их
  for (const c of categories) if (!seen.has(c.id)) out.push({ id: c.id, name: c.name, depth: 0 });
  return out;
}

/** «Лимит охватывает и подкатегории: Фрукты, Овощи» — до трёх названий, остальные числом. */
function subcategoriesNote(subs: readonly ScopeOption[]): string {
  const shown = subs.slice(0, 3).map((o) => o.name);
  const rest = subs.length - shown.length;
  return `Лимит охватывает и подкатегории: ${shown.join(', ')}${rest > 0 ? ` и ещё ${rest}` : ''}.`;
}

/** Новый лимит или правка суммы: «на что» (все расходы или категория) и сколько в месяц. Деньги вводятся только через AmountInput. */
export function BudgetSheet({ budget, base, budgets, categories, names, onClose }: BudgetSheetProps) {
  const store = useStore();
  const toast = useToast();
  const editing = budget !== null;
  const hasTotal = budgets.some((b) => b.categoryId === null && b.archivedAt === null);
  const [scope, setScope] = useState<string | null>(editing ? (budget.categoryId ?? TOTAL) : hasTotal ? null : TOTAL);
  const categoryId = scope === null || scope === TOTAL ? null : scope;
  const wrongCurrency = editing && budget.currency !== base;
  const [amount, setAmount] = useState<Minor | null>(editing && !wrongCurrency ? budget.amountMinor : null);
  // Сумма подставлена программой (подсказка, лимит, который уже есть), а не набрана: при смене области её не переносим
  const [autoAmount, setAutoAmount] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const existing = !editing && scope !== null ? budgets.find((b) => b.categoryId === categoryId) : undefined;
  const label = editing ? budgetLabel(budget.categoryId, names) : null;
  const options = useMemo(() => scopeOptions(categories), [categories]);
  const parentOf = useMemo(() => new Map([...names].map(([id, c]) => [id, c.parentId ?? null] as const)), [names]);
  // Лимит на категорию охватывает и её подкатегории: говорим об этом, когда они есть
  const subcategories = useMemo(
    () => (categoryId === null ? [] : options.filter((o) => o.id !== categoryId && categoryCovers(categoryId, o.id, parentOf))),
    [options, categoryId, parentOf],
  );

  // Подсказки суммы по прошлым тратам в той же области, что и лимит
  const history = useSpendingHistory();
  const hints = useMemo(
    () => (history && scope !== null ? limitHints(history, categoryId, parentOf, base) : null),
    [history, scope, categoryId, parentOf, base],
  );
  const hasExcluded = (history ?? []).some((m) => (m.excludedCount ?? 0) > 0);
  const chips = useMemo(() => {
    if (!hints || scope === null) return [];
    const list: { label: string; value: Minor }[] = [];
    if (hints.lastMonthLimit !== null) list.push({ label: 'Как в прошлом месяце', value: hints.lastMonthLimit });
    if (hints.typicalLimit !== null && hints.typicalLimit !== hints.lastMonthLimit) list.push({ label: 'Как обычно', value: hints.typicalLimit });
    return list;
  }, [hints, scope]);

  const pickScope = (value: string) => {
    setScope(value);
    setScopeError(null);
    setFormError(null);
    const same = budgets.find((b) => b.categoryId === (value === TOTAL ? null : value));
    // у лимита, который уже есть, показываем его сумму: меняют её, а не вводят с нуля
    if (same && same.currency === base) {
      setAmount(same.amountMinor);
      setAutoAmount(true);
    } else if (autoAmount) {
      setAmount(null); // сумма чужой области (из подсказки или чужого лимита) к этой не относится
      setAutoAmount(false);
    }
  };

  const fail = (e: unknown, fallback: string) => {
    if (e instanceof ValidationError) setFormError(e.message);
    else {
      console.error(fallback, e);
      setFormError(`${fallback} Данные не изменены, попробуйте ещё раз.`);
    }
  };

  const save = async () => {
    if (busy.current) return;
    setFormError(null);
    if (!editing && scope === null) return setScopeError('Выберите, на что поставить лимит');
    if (amount === null || amount <= 0) return setAmountError('Введите сумму лимита больше нуля');
    busy.current = true;
    setSaving(true);
    try {
      if (editing) await store.budgets.update(budget.id, { amountMinor: amount });
      else await store.budgets.create({ categoryId, amountMinor: amount });
      toast.success(editing || existing ? 'Сумма лимита изменена' : 'Лимит добавлен');
      onClose();
    } catch (e) {
      fail(e, 'Не удалось сохранить лимит.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!editing || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const archived = await store.budgets.archive(budget.id);
      toast.success(`Лимит «${label?.name ?? ''}» убран в архив`, {
        durationMs: UNDO_MS,
        action: {
          label: 'Вернуть',
          onClick: () => {
            store.budgets.restore(archived.id).catch((e: unknown) => {
              console.error('Не удалось вернуть лимит:', e);
              toast.error('Не удалось вернуть лимит. Его можно вернуть из архива на этом экране.');
            });
          },
        },
      });
      onClose();
    } catch (e) {
      fail(e, 'Не удалось убрать лимит в архив.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const note = existingNote(existing, scope === TOTAL);

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title={editing ? `Лимит: ${label?.name ?? ''}` : 'Новый лимит'}
      footer={
        <div className="flex flex-col gap-2">
          {formError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {formError}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} onClick={() => void save()}>
            Сохранить
          </Button>
          {editing && (
            <Button variant="ghost" fullWidth disabled={saving} onClick={() => void archive()}>
              Убрать в архив
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {editing && label && (
          <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
            <Glyph value={label.icon} color={label.color ?? undefined} size={48} />
            <p className="text-sm text-muted">Лимит действует на каждый месяц. Изменить сумму можно ниже.</p>
          </div>
        )}
        {!editing && (
          <div className="flex flex-col gap-1.5">
            <Field id="budget-scope" label="На что лимит" error={scopeError}>
              <select
                id="budget-scope"
                value={scope ?? ''}
                onChange={(e) => e.target.value !== '' && pickScope(e.target.value)}
                className={`${inputClasses(scopeError !== null)} min-h-[48px]`}
              >
                {scope === null && (
                  <option value="" disabled>
                    Выберите…
                  </option>
                )}
                <option value={TOTAL}>Все расходы</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.depth > 0 ? `${'\u00a0\u00a0'.repeat(o.depth)}↳ ${o.name}` : o.name}
                  </option>
                ))}
              </select>
            </Field>
            {note && <p className="text-sm font-medium text-brand">{note}</p>}
            {subcategories.length > 0 && <p className="text-sm text-muted">{subcategoriesNote(subcategories)}</p>}
          </div>
        )}

        {hints && (hints.lastMonth !== null || hints.typical !== null || hasExcluded) && (
          <div className="flex flex-col gap-2" data-testid="limit-hints">
            {(hints.lastMonth !== null || hints.typical !== null) && (
              <p className="text-center text-sm text-muted">
                Потрачено: {hints.lastMonth !== null ? `в прошлом месяце ${formatMinor(hints.lastMonth, base)}` : 'в прошлом месяце ничего'}
                {hints.typical !== null ? `, обычно ${formatMinor(hints.typical, base)} в месяц` : ''}.
              </p>
            )}
            {hasExcluded && (
              <p className="text-center text-sm font-medium text-warning">
                Часть прошлых операций внесена в другой основной валюте, чем сейчас ({base}), и в подсказку не вошла.
              </p>
            )}
            {chips.length > 0 && (
              <div role="group" aria-label="Подсказки суммы" className="flex flex-wrap justify-center gap-2">
                {chips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    aria-pressed={amount === c.value}
                    onClick={() => {
                      setAmount(c.value);
                      setAutoAmount(true);
                      setAmountError(null);
                      setFormError(null);
                    }}
                    className={cn(
                      'inline-flex min-h-[44px] items-center rounded-full border px-3.5 text-sm font-semibold transition-colors',
                      amount === c.value ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text hover:bg-surface-2',
                    )}
                  >
                    {c.label} · {formatMinor(c.value, base)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <AmountInput
            label="Сумма лимита на месяц"
            currency={base}
            value={amount}
            error={amountError}
            onChange={(v) => {
              setAmount(v);
              setAutoAmount(false);
              setAmountError(null);
              setFormError(null);
            }}
          />
          <p className="text-center text-sm text-muted">
            {wrongCurrency
              ? `Раньше лимит был в ${budget.currency}. Укажите сумму в ${base} — основной валюте сейчас.`
              : `Сумма в основной валюте (${base}). Лимит действует каждый месяц, пока вы его не измените.`}
          </p>
        </div>
      </div>
    </Sheet>
  );
}
