import { useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChipPicker } from '@/components/ChipPicker';
import { Field, inputClasses } from '@/components/Field';
import { MoneyText } from '@/components/MoneyText';
import { ROUND_UP_FIRST_DAYS, ROUND_UP_STEPS, isRoundUpStep } from '@/domain/roundUp';
import type { CurrencyCode, LocalRow, SavingsGoal, Wallet } from '@/domain/types';
import { longDate } from '../budgetText';
import { SaveNowSheet } from './SaveNowSheet';
import { setRoundUpStep, useRoundUpStep } from './roundUpPref';
import { useRoundUp } from './useRoundUp';

export interface RoundUpCardProps {
  base: CurrencyCode;
  /** Активные цели. Карточка работает только с теми, у кого есть привязанный кошелёк. */
  goals: readonly LocalRow<SavingsGoal>[];
  /** Все кошельки не в архиве. */
  wallets: readonly LocalRow<Wallet>[];
}

/**
 * «Копилка из мелочи»: каждая трата округляется вверх до шага (1, 5 или 10), а разница копится. Деньги сами никуда не уходят — когда
 * набежало, нажимаете «Отложить мелочь», и это обычный перевод на кошелёк цели. Нет цели с кошельком — карточки нет.
 */
export function RoundUpCard({ base, goals, wallets }: RoundUpCardProps) {
  const eligible = goals
    .map((goal) => ({ goal, wallet: goal.walletId === null ? undefined : wallets.find((w) => w.id === goal.walletId) }))
    .filter((x): x is { goal: LocalRow<SavingsGoal>; wallet: LocalRow<Wallet> } => x.wallet !== undefined && x.goal.archivedAt === null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const step = useRoundUpStep();
  const chosen = eligible.find((x) => x.goal.id === pickedId) ?? eligible[0];
  const state = useRoundUp(base, chosen?.wallet.id ?? null, step);
  if (!chosen) return null;

  const { goal, wallet } = chosen;
  const total = state?.totalMinor ?? null;
  const canSave = state !== undefined && state.note !== null && total !== null && total > 0;
  let status: string | null = null;
  if (state === undefined) status = 'Считаем…';
  else if (total === null) status = 'Не удалось посчитать: суммы слишком большие.';
  else if (state.window === null) status = 'Мелочь уже отложена по сегодняшний день.';
  else if (total === 0) status = 'Пока мелочи нет: она появится с новыми тратами.';

  return (
    <Card aria-labelledby="round-up-title" data-testid="round-up-card" className="flex flex-col gap-3">
      <div>
        <h3 id="round-up-title" className="text-sm font-semibold text-muted">
          Копилка из мелочи
        </h3>
        <p className="mt-1 text-sm text-muted">
          Каждую трату округляем вверх до шага, разница копится. Когда наберётся, одним переводом откладываете её на цель.
        </p>
      </div>

      {eligible.length > 1 && (
        <Field id="round-up-goal" label="На какую цель">
          <select id="round-up-goal" value={goal.id} onChange={(e) => setPickedId(e.target.value)} className={`${inputClasses(false)} min-h-[48px]`}>
            {eligible.map((x) => (
              <option key={x.goal.id} value={x.goal.id}>
                {x.goal.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Округлять до</span>
        <ChipPicker
          ariaLabel="Шаг округления"
          value={String(step)}
          onChange={(v) => {
            const n = Number(v);
            if (isRoundUpStep(n)) setRoundUpStep(n);
          }}
          options={ROUND_UP_STEPS.map((s) => ({ value: String(s), label: String(s) }))}
        />
      </div>

      {state?.window && total !== null && (
        <p className="text-sm">
          Накопилось с {longDate(state.window.from)}
          {state.swept === null ? ` (за последние ${ROUND_UP_FIRST_DAYS} дней)` : ''}:{' '}
          <span data-testid="round-up-amount">
            <MoneyText minor={total} currency={base} tone="none" className="font-semibold" />
          </span>
        </p>
      )}
      {status && <p className="text-sm text-muted">{status}</p>}

      <Button variant="secondary" icon="plus" className="self-start" disabled={!canSave} onClick={() => setSheet(true)}>
        Отложить мелочь
      </Button>

      {sheet && canSave && (
        <SaveNowSheet
          goal={goal}
          goalWallet={wallet}
          wallets={wallets}
          suggestedMinor={total}
          {...(state.note === null ? {} : { note: state.note })}
          onClose={() => setSheet(false)}
        />
      )}
    </Card>
  );
}
