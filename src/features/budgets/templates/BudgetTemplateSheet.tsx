import { useMemo, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { Glyph } from '@/components/Glyph';
import { glyphValue } from '@/components/glyphs';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useCategories, useStore } from '@/db';
import { formatMinor } from '@/domain/money';
import type { Budget, CurrencyCode, LocalRow, Minor } from '@/domain/types';
import { CATALOG } from '@/features/categories/catalog/catalogData';
import type { ExistingCategory } from '@/features/categories/catalog/catalogPlan';
import { cn } from '@/lib/cn';
import { pluralRu } from '@/lib/plural';
import { applyTemplateRows, templateApplyText } from './applyTemplate';
import { BUDGET_TEMPLATES, buildTemplateRows, defaultRowKeys, rowKey, type BudgetTemplate } from './budgetTemplates';
import { useIncomeHint } from './useIncomeHint';

export interface BudgetTemplateSheetProps {
  base: CurrencyCode;
  /** Лимиты, которые уже есть (не в архиве): по ним видно, где шаблон обновит сумму. */
  budgets: readonly LocalRow<Budget>[];
  onClose: () => void;
}

const groupIcon = (group: string): string => {
  if (group === 'total') return 'i:pie';
  const g = CATALOG.find((x) => x.slug === group);
  return glyphValue(g?.icon ?? 'box');
};
const groupColor = (group: string): string | undefined => CATALOG.find((x) => x.slug === group)?.color;

/**
 * «Шаблон лимитов»: выбрать шаблон (50/30/20, семья, студент…), указать доход за месяц — и получить лимиты по вашим категориям списком с
 * галочками. Ставятся сразу пачкой; стоящие лимиты по умолчанию не отмечены, чтобы шаблон не перезаписал ваши суммы случайно.
 */
export default function BudgetTemplateSheet({ base, budgets, onClose }: BudgetTemplateSheetProps) {
  const store = useStore();
  const toast = useToast();
  const categories = useCategories('expense', { includeArchived: true });
  const hint = useIncomeHint();
  const [template, setTemplate] = useState<BudgetTemplate | null>(null);
  const [income, setIncome] = useState<Minor | null>(null);
  const [touched, setTouched] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing: ExistingCategory[] = useMemo(
    () => (categories ?? []).map((c) => ({ id: c.id, name: c.name, kind: c.kind, parentId: c.parentId, archived: c.archivedAt !== null, color: c.color })),
    [categories],
  );
  const limits = useMemo(() => {
    const m = new Map<string, Minor>();
    for (const b of budgets) if (b.archivedAt === null && b.currency === base) m.set(b.categoryId ?? 'total', b.amountMinor);
    return m;
  }, [budgets, base]);

  // Доход по умолчанию — обычный по последним месяцам, пока человек не ввёл свой
  const effectiveIncome = touched ? income : (income ?? hint ?? null);
  const result = useMemo(
    () => (template && effectiveIncome !== null ? buildTemplateRows(template, effectiveIncome, existing, limits, base) : null),
    [template, effectiveIncome, existing, limits, base],
  );
  const rows = result?.rows ?? [];
  // Отметки: пока человек их не трогал — по умолчанию (где лимита ещё нет); сменили шаблон или доход — снова по умолчанию
  const selected = picked ?? defaultRowKeys(rows);
  const count = rows.filter((r) => selected.has(rowKey(r))).length;

  const pickTemplate = (t: BudgetTemplate) => {
    setTemplate(t);
    setPicked(null);
    setError(null);
  };
  const flip = (key: string) => {
    const next = new Set(selected);
    if (!next.delete(key)) next.add(key);
    setPicked(next);
  };

  const save = async () => {
    if (saving || !result || count === 0) return;
    setSaving(true);
    setError(null);
    try {
      const done = await applyTemplateRows(store, rows, selected);
      if (done.failed > 0) {
        console.error('Не удалось поставить лимиты по шаблону:', done.error);
        const msg = done.error instanceof Error && done.error.name === 'ValidationError' ? `${done.error.message}. ` : '';
        const set = done.created + done.updated;
        setError(`${msg}Поставлено ${set}, не удалось ещё ${done.failed}. Нажмите «Поставить лимиты» ещё раз: уже поставленные не задвоятся.`);
        // то, что поставилось, видно в списке как «сейчас …»; отметки сбрасываем, чтобы повтор взял только оставшееся
        setPicked(null);
        return;
      }
      toast.success(templateApplyText(done));
      onClose();
    } catch (e) {
      console.error('Не удалось поставить лимиты по шаблону:', e);
      setError('Не удалось поставить лимиты. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  const title = template ? `Шаблон «${template.name}»` : 'Шаблоны лимитов';
  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title={title}
      footer={
        template ? (
          <div className="flex flex-col gap-2">
            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}
            <Button size="lg" fullWidth loading={saving} disabled={count === 0} onClick={() => void save()}>
              {count === 0 ? 'Отметьте лимиты' : `Поставить лимиты · ${count}`}
            </Button>
            <Button size="lg" variant="ghost" fullWidth disabled={saving} onClick={() => setTemplate(null)}>
              Другой шаблон
            </Button>
          </div>
        ) : (
          <Button size="lg" variant="ghost" fullWidth onClick={onClose}>
            Отмена
          </Button>
        )
      }
    >
      {!template ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Шаблон сам разложит ваш месячный доход по категориям и подскажет лимиты. Потом любой лимит можно поменять.
          </p>
          <ul aria-label="Шаблоны лимитов" className="flex flex-col gap-2">
            {BUDGET_TEMPLATES.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => pickTemplate(t)}
                  className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-border bg-surface/80 px-4 py-3 text-left transition-colors hover:bg-surface-2 active:bg-border/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{t.name}</span>
                    <span className="block text-sm text-muted">{t.tagline}</span>
                  </span>
                  <Icon name="chevron" size={18} className="shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{template.about}</p>
          <div className="flex flex-col gap-1">
            <AmountInput
              label="Доход в месяц"
              currency={base}
              // экранная клавиатура заняла бы весь экран и спрятала список лимитов: набираем системной цифровой
              showKeypad={false}
              value={effectiveIncome}
              onChange={(v) => {
                setIncome(v);
                setTouched(true);
                setPicked(null);
              }}
            />
            <p className="text-center text-sm text-muted">
              {hint != null && !touched && income === null
                ? `Подставили обычный доход за последние месяцы: ${formatMinor(hint, base)}. Можно изменить.`
                : `Сколько вы получаете в месяц (${base}).`}
            </p>
          </div>

          {categories === undefined ? (
            <p role="status" className="py-4 text-center text-muted">
              Загрузка…
            </p>
          ) : result && rows.length > 0 ? (
            <>
              <ul aria-label="Лимиты по шаблону" className="flex flex-col gap-2">
                {rows.map((r) => {
                  const key = rowKey(r);
                  const on = selected.has(key);
                  return (
                    <li key={key} className="overflow-hidden rounded-2xl border border-border bg-surface/80">
                      <label className="flex min-h-[56px] cursor-pointer items-center gap-3 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={r.name}
                          onChange={() => flip(key)}
                          className="h-5 w-5 shrink-0 cursor-pointer accent-brand"
                        />
                        <Glyph value={groupIcon(r.group)} color={groupColor(r.group)} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{r.name}</span>
                          <span className={cn('block truncate text-sm', r.currentMinor !== null ? 'font-medium text-warning' : 'text-muted')}>
                            {r.currentMinor !== null ? `сейчас ${formatMinor(r.currentMinor, base)} · обновим` : `${r.percent}% дохода`}
                          </span>
                        </span>
                        <span className="money shrink-0 text-right font-bold tabular-nums">{formatMinor(r.amountMinor, base)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="text-sm text-muted" data-testid="template-savings">
                {template.savingsPercent > 0 && `На накопления остаётся ${template.savingsPercent}%: ${formatMinor(result.savingsMinor, base)} в месяц. `}
                Общий лимит — это доход без накоплений.
              </p>
              {result.missing.length > 0 && (
                <p className="rounded-2xl bg-surface-2 p-3 text-sm text-muted" data-testid="template-missing">
                  Нет подходящей категории для {result.missing.length} {pluralRu(result.missing.length, 'набора', 'наборов', 'наборов')}: {result.missing.map((m) => m.name).join(', ')}. Добавьте их из
                  «Настройки → Категории → Готовые категории», и шаблон поставит и на них.
                </p>
              )}
            </>
          ) : (
            <p className="py-2 text-center text-muted">{effectiveIncome === null ? 'Укажите доход, и мы посчитаем лимиты.' : 'Для этого дохода лимиты не получаются: сумма слишком мала.'}</p>
          )}
        </div>
      )}
    </Sheet>
  );
}
