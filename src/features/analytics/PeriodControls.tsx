import { Field, inputClasses, TextInput } from '@/components/Field';
import { IconButton } from '@/components/IconButton';
import { Segmented, type SegmentOption } from '@/components/Segmented';
import type { IsoDate } from '@/domain/types';
import { defaultSelection, effectiveCompare, type PeriodSelection } from './periodParams';
import { MIN_YEAR, type CompareMode, type PeriodKind } from './periods';

const KINDS: readonly SegmentOption<PeriodKind>[] = [
  { value: 'year', label: 'Год' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'custom', label: 'Даты', ariaLabel: 'Свой период' },
];

/**
 * Что сравнивать. Подписи короткие: на экране в 320 px в выпадающий список помещается около 25 знаков. Для года «предыдущий» и «год
 * назад» одно и то же, поэтому «год назад» ему не предлагаем; какие именно даты сравниваются, написано в итогах.
 */
function compareOptions(kind: PeriodKind): { value: CompareMode; label: string }[] {
  const none = { value: 'none' as const, label: 'Не сравнивать' };
  if (kind === 'year') return [{ value: 'prev', label: 'С прошлым годом' }, none];
  if (kind === 'quarter') return [{ value: 'prev', label: 'С прошлым кварталом' }, { value: 'yoy', label: 'Этот квартал год назад' }, none];
  return [{ value: 'prev', label: 'С предыдущими днями' }, { value: 'yoy', label: 'Эти же даты год назад' }, none];
}

function Stepper({ text, prevLabel, nextLabel, canPrev, canNext, onPrev, onNext }: { text: string; prevLabel: string; nextLabel: string; canPrev: boolean; canNext: boolean; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <IconButton icon="chevron" label={prevLabel} className="rotate-180" disabled={!canPrev} onClick={onPrev} />
      <span className="text-base font-semibold" aria-live="polite">
        {text}
      </span>
      <IconButton icon="chevron" label={nextLabel} disabled={!canNext} onClick={onNext} />
    </div>
  );
}

export interface PeriodControlsProps {
  selection: PeriodSelection;
  onChange: (next: PeriodSelection) => void;
  today: IsoDate;
  /** Что не так с введёнными датами (свой период): показывается под полями. */
  dateError?: string | null;
}

/** Выбор периода (год, квартал, свои даты) и того, с чем сравнивать. Всё лежит в адресе (см. periodParams.ts). */
export function PeriodControls({ selection: sel, onChange, today, dateError = null }: PeriodControlsProps) {
  const now = defaultSelection(today);
  const set = (patch: Partial<PeriodSelection>) => onChange({ ...sel, ...patch });
  const cmp = effectiveCompare(sel.kind, sel.cmp);

  const prevQuarter = sel.quarter === 1 ? { year: sel.year - 1, quarter: 4 } : { year: sel.year, quarter: sel.quarter - 1 };
  const nextQuarter = sel.quarter === 4 ? { year: sel.year + 1, quarter: 1 } : { year: sel.year, quarter: sel.quarter + 1 };
  const nextQuarterOk = nextQuarter.year < now.year || (nextQuarter.year === now.year && nextQuarter.quarter <= now.quarter);

  return (
    <div className="mb-3 flex flex-col gap-3" data-testid="period-controls">
      <Segmented ariaLabel="Вид периода" options={KINDS} value={sel.kind} onChange={(kind) => set({ kind })} />
      {sel.kind === 'year' && (
        <Stepper
          text={`${sel.year} год`}
          prevLabel="Предыдущий год"
          nextLabel="Следующий год"
          canPrev={sel.year > MIN_YEAR}
          canNext={sel.year < now.year}
          onPrev={() => set({ year: sel.year - 1 })}
          onNext={() => set({ year: sel.year + 1 })}
        />
      )}
      {sel.kind === 'quarter' && (
        <Stepper
          text={`${sel.quarter}-й квартал ${sel.year}`}
          prevLabel="Предыдущий квартал"
          nextLabel="Следующий квартал"
          canPrev={prevQuarter.year >= MIN_YEAR}
          canNext={nextQuarterOk}
          onPrev={() => set(prevQuarter)}
          onNext={() => set(nextQuarter)}
        />
      )}
      {sel.kind === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <TextInput label="С" type="date" value={sel.from} max={today} onChange={(e) => e.target.value !== '' && set({ from: e.target.value })} error={dateError} wrapperClassName="min-w-0" />
          <TextInput label="По" type="date" value={sel.to} max={today} onChange={(e) => e.target.value !== '' && set({ to: e.target.value })} wrapperClassName="min-w-0" />
        </div>
      )}
      <Field id="period-compare" label="Сравнить">
        <select id="period-compare" value={cmp} onChange={(e) => set({ cmp: e.target.value as CompareMode })} className={`${inputClasses(false)} min-h-[48px]`}>
          {compareOptions(sel.kind).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
