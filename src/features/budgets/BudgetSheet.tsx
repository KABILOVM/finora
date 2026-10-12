import { useRef, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { Field, inputClasses } from '@/components/Field';
import { Glyph } from '@/components/Glyph';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { ValidationError, useStore } from '@/db';
import type { Budget, Category, CurrencyCode, LocalRow, Minor, UUID } from '@/domain/types';
import { UNDO_MS } from '@/features/transactions/txActions';
import { budgetLabel } from './budgetText';

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
  /** Все категории (для названия при правке). */
  names: ReadonlyMap<UUID, Pick<Category, 'name' | 'icon' | 'color'>>;
  onClose: () => void;
}

/** Что сказать человеку, если лимит на эту область уже есть (создание в репозитории обновит его, а не заведёт второй). */
function existingNote(existing: LocalRow<Budget> | undefined, isTotal: boolean): string | null {
  if (!existing) return null;
  if (existing.archivedAt !== null) return 'Такой лимит лежал в архиве — вернём его с новой суммой.';
  return isTotal ? 'Общий лимит уже есть — изменим сумму.' : 'Лимит на эту категорию уже есть — изменим сумму.';
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
  const [amountError, setAmountError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const existing = !editing && scope !== null ? budgets.find((b) => b.categoryId === categoryId) : undefined;
  const label = editing ? budgetLabel(budget.categoryId, names) : null;

  const pickScope = (value: string) => {
    setScope(value);
    setScopeError(null);
    setFormError(null);
    const same = budgets.find((b) => b.categoryId === (value === TOTAL ? null : value));
    // у лимита, который уже есть, показываем его сумму: меняют её, а не вводят с нуля
    if (same && same.currency === base) setAmount(same.amountMinor);
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
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            {note && <p className="text-sm font-medium text-brand">{note}</p>}
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
