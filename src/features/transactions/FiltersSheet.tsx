import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { ChipPicker } from "@/components/ChipPicker";
import { Field, inputClasses, TextInput } from "@/components/Field";
import { Sheet } from "@/components/Sheet";
import type { Category, LocalRow, TxKind, Wallet } from "@/domain/types";
import { groupUnderParents, pathLabel } from "@/features/categories/categoryTree";
import { FieldGroup } from "./FieldGroup";
import type { KnownTag } from "./knownTags";
import { rankByPopularity, usePopularity } from "./popularity";
import {
  activeFilterCount,
  EMPTY_SHEET_FILTERS,
  NO_CATEGORY,
  normalizeAmountText,
  withKind,
  type SheetFilters,
  type SourceFilter,
} from "./txFilters";

const KIND_OPTIONS: readonly { value: "" | TxKind; label: string }[] = [
  { value: "", label: "Все виды" },
  { value: "expense", label: "Расходы" },
  { value: "income", label: "Доходы" },
  { value: "transfer", label: "Переводы" },
];

const SOURCE_OPTIONS: readonly { value: SourceFilter; label: string }[] = [
  { value: "", label: "Все" },
  { value: "recurring", label: "Регулярные платежи" },
  { value: "debt", label: "По долгам" },
];

/** В списке сумма пишется с запятой, внутри лежит с точкой. */
const shown = (t: string) => t.replace(".", ",");

/** Ошибки полей суммы: не число; «До» меньше «От». Пусто — это не ошибка (граница не задана). */
function amountErrors(f: Pick<SheetFilters, "amountFrom" | "amountTo">): { from: string | null; to: string | null } {
  const from = normalizeAmountText(f.amountFrom);
  const to = normalizeAmountText(f.amountTo);
  return {
    from: from === null ? "Введите сумму числом" : null,
    to:
      to === null
        ? "Введите сумму числом"
        : from !== null && from !== "" && to !== "" && Number(to) < Number(from)
          ? "«До» меньше «От»"
          : null,
  };
}

export interface FiltersSheetProps {
  /** Что включено сейчас: с этого шит начинает. */
  initial: SheetFilters;
  wallets: readonly LocalRow<Wallet>[];
  categories: readonly LocalRow<Category>[];
  /** Метки, что уже встречались в заметках: из них выбирается «Метка» (нет меток — поля нет). */
  tags?: readonly KnownTag[];
  /** «Применить»: выбранное попадает в список. Закрытие без «Применить» ничего не меняет. */
  onApply: (next: SheetFilters) => void;
  onClose: () => void;
}

/**
 * Шит «Фильтры»: кошелёк, вид и категория. Выбор копится здесь и попадает в список только по «Применить»;
 * «Сбросить» очищает выбор в шите (список обновится после «Применить»). Свернули шит — список остался прежним.
 */
export function FiltersSheet({
  initial,
  wallets,
  categories,
  tags = [],
  onApply,
  onClose,
}: FiltersSheetProps) {
  // суммы в шите — как набирает человек (с запятой); в список они уходят «чистыми» (normalizeAmountText)
  const [draft, setDraft] = useState<SheetFilters>({ ...initial, amountFrom: shown(initial.amountFrom), amountTo: shown(initial.amountTo) });
  const errors = amountErrors(draft);
  // Поля суммы ниже первого экрана: ошибка («До меньше От») не должна прятаться под панелью кнопок, пока «Применить» неактивна
  const amountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.from === null && errors.to === null) return;
    // в тестовой среде (jsdom) scrollIntoView нет
    amountRef.current?.querySelector('[role="alert"]')?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [errors.from, errors.to]);
  const apply = () =>
    onApply({ ...draft, amountFrom: normalizeAmountText(draft.amountFrom) ?? "", amountTo: normalizeAmountText(draft.amountTo) ?? "" });
  // Порядок — по популярности, посчитан один раз при открытии шита
  const pop = usePopularity();
  // «Родитель, затем его подкатегории»; группа стоит там, где встретился её самый частый член
  const expense = groupUnderParents(
    pop
      ? rankByPopularity(
          categories.filter((c) => c.kind === "expense"),
          pop.categories.expense,
        )
      : categories.filter((c) => c.kind === "expense"),
  );
  const income = groupUnderParents(
    pop
      ? rankByPopularity(
          categories.filter((c) => c.kind === "income"),
          pop.categories.income,
        )
      : categories.filter((c) => c.kind === "income"),
  );
  const byId = new Map(categories.map((c) => [c.id, c] as const));
  const walletList = pop ? rankByPopularity(wallets, pop.wallets) : wallets;
  const nameOf = (c: LocalRow<Category>) =>
    c.archivedAt === null ? pathLabel(c, byId) : `${pathLabel(c, byId)} (в архиве)`;
  const transfers = draft.kind === "transfer";

  const onKind = (value: string) => {
    const kind = value as "" | TxKind;
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
          <Button size="lg" disabled={errors.from !== null || errors.to !== null} onClick={apply}>
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
            onChange={(e) =>
              setDraft((cur) => ({ ...cur, walletId: e.target.value }))
            }
            className={`${inputClasses(false)} min-h-[48px]`}
          >
            <option value="">Все кошельки</option>
            {walletList.map((w) => (
              <option key={w.id} value={w.id}>
                {w.archivedAt === null ? w.name : `${w.name} (в архиве)`}
              </option>
            ))}
          </select>
        </Field>

        <FieldGroup label="Вид операции">
          <ChipPicker
            ariaLabel="Вид операции"
            options={KIND_OPTIONS}
            value={draft.kind}
            onChange={onKind}
          />
        </FieldGroup>

        <Field
          id="filter-category"
          label="Категория"
          hint={transfers ? "У переводов категорий нет." : undefined}
        >
          <select
            id="filter-category"
            value={draft.categoryId}
            disabled={transfers}
            onChange={(e) =>
              setDraft((cur) => ({ ...cur, categoryId: e.target.value }))
            }
            className={`${inputClasses(false)} min-h-[48px]`}
          >
            <option value="">Все категории</option>
            <option value={NO_CATEGORY}>Без категории</option>
            {draft.kind !== "income" && expense.length > 0 && (
              <optgroup label="Расходы">
                {expense.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nameOf(c)}
                  </option>
                ))}
              </optgroup>
            )}
            {draft.kind !== "expense" && income.length > 0 && (
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

        {(tags.length > 0 || draft.tag !== "") && (
          <Field id="filter-tag" label="Метка" hint="Метка в заметке: #Самарканд, #работа.">
            <select
              id="filter-tag"
              value={draft.tag}
              onChange={(e) => setDraft((cur) => ({ ...cur, tag: e.target.value }))}
              className={`${inputClasses(false)} min-h-[48px]`}
            >
              <option value="">Все метки</option>
              {/* выбранная метка, которой уже нет ни в одной операции (их удалили), остаётся в списке: иначе её нечем снять */}
              {draft.tag !== "" && !tags.some((t) => t.key === draft.tag) && <option value={draft.tag}>{`#${draft.tag}`}</option>}
              {tags.map((t) => (
                <option key={t.key} value={t.key}>
                  {`#${t.label} (${t.count})`}
                </option>
              ))}
            </select>
          </Field>
        )}

        <FieldGroup label="Сумма">
          <div ref={amountRef} className="grid grid-cols-2 gap-2">
            <TextInput
              label="От"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={draft.amountFrom}
              error={errors.from}
              onChange={(e) => setDraft((cur) => ({ ...cur, amountFrom: e.target.value }))}
              wrapperClassName="min-w-0"
            />
            <TextInput
              label="До"
              inputMode="decimal"
              autoComplete="off"
              placeholder="без предела"
              value={draft.amountTo}
              error={errors.to}
              onChange={(e) => setDraft((cur) => ({ ...cur, amountTo: e.target.value }))}
              wrapperClassName="min-w-0"
            />
          </div>
          <p className="mt-1 text-sm text-muted">В валюте кошелька операции, границы входят.</p>
        </FieldGroup>

        <FieldGroup label="Откуда операция">
          <ChipPicker
            ariaLabel="Откуда операция"
            options={SOURCE_OPTIONS}
            value={draft.source}
            onChange={(value) => setDraft((cur) => ({ ...cur, source: value as SourceFilter }))}
          />
        </FieldGroup>
      </div>
    </Sheet>
  );
}
