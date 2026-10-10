import { ChipPicker, type ChipOption } from '@/components/ChipPicker';
import { FieldGroup } from './FieldGroup';

/**
 * На телефоне чипы идут в два ряда с горизонтальной прокруткой (самые частые — в начале): так категории и цифры помещаются
 * на одном экране и прокручивать вниз не нужно (на совсем невысоком экране — один ряд). На широком экране — строки с переносом.
 */
const CHIPS_LAYOUT =
  'max-md:-mx-5 max-md:grid max-md:auto-cols-max max-md:grid-flow-col max-md:grid-rows-2 max-md:overflow-x-auto max-md:px-5 max-md:pb-1 ' +
  'max-md:[scrollbar-width:none] max-md:[@media(max-height:700px)]:!grid-rows-1';

export interface CategoryPickerProps {
  /** Уже упорядочены: самые частые первыми. */
  options: readonly ChipOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  error?: string | null;
}

/** Выбор категории чипами (на невысоком экране подпись скрыта: чипы и так понятны). Касание выбранной категории снимает выбор (категорию можно не указывать). */
export function CategoryPicker({ options, value, onChange, error }: CategoryPickerProps) {
  return (
    <FieldGroup
      label="Категория"
      hint="можно не выбирать"
      error={error}
      className="[@media(max-height:700px)]:[&>div:first-child]:hidden"
    >
      {options.length > 0 ? (
        <ChipPicker
          ariaLabel="Категория"
          options={options}
          value={value}
          className={CHIPS_LAYOUT}
          onChange={(id) => onChange(id === value ? null : id)}
        />
      ) : (
        <p className="text-sm text-muted">Категорий пока нет — операция сохранится без категории.</p>
      )}
    </FieldGroup>
  );
}
