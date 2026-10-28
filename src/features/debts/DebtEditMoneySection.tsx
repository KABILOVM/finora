import { useId } from 'react';

export interface DebtEditMoneySectionProps {
  /** Человек оставил галочку: деньги в кошельке меняются вслед за суммой долга. */
  wanted: boolean;
  onWanted: (on: boolean) => void;
  /** Что случится с деньгами (editMoneyText). */
  text: string;
}

/**
 * Правка суммы долга, по которому деньги уже двигались: по умолчанию кошелёк меняется вслед за суммой (выдача растёт или убывает),
 * иначе долг и выданные деньги разошлись бы. Галочка нужна, когда деньги на самом деле не менялись, а долг правят «по бумагам».
 */
export function DebtEditMoneySection({ wanted, onWanted, text }: DebtEditMoneySectionProps) {
  const titleId = useId();
  const hintId = useId();
  return (
    <section aria-label="Движение денег" data-testid="debt-edit-money" className="flex flex-col gap-3 rounded-2xl border border-border p-3">
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={wanted}
          onChange={(e) => onWanted(e.target.checked)}
          aria-labelledby={titleId}
          aria-describedby={hintId}
          className="mt-0.5 h-6 w-6 shrink-0 accent-brand"
        />
        <span>
          <span id={titleId} className="block font-semibold">
            Изменить и движение денег
          </span>
          <span id={hintId} className="block text-sm text-muted">
            {wanted ? text : 'Сумма долга изменится, а остатки кошельков останутся прежними.'}
          </span>
        </span>
      </label>
    </section>
  );
}
