import { cn } from '@/lib/cn';
import { inputClasses } from './Field';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Имя поля для скринридера: «Поиск по категориям». */
  label: string;
  placeholder?: string;
  className?: string;
}

/** Не длиннее: поиск по названию, а не по тексту. */
export const SEARCH_MAX_LENGTH = 60;

/** Поле поиска над списком: значок слева, справа — «очистить», пока что-то набрано. Тот же вид, что поиск по операциям. */
export function SearchField({ value, onChange, label, placeholder = 'Название', className }: SearchFieldProps) {
  return (
    <div className={cn('relative', className)}>
      <Icon name="search" size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
      <input
        type="search"
        inputMode="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        maxLength={SEARCH_MAX_LENGTH}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        // своя кнопка «очистить» ниже: встроенный крестик браузера прячем, чтобы их не стало два
        className={cn(inputClasses(false), 'min-h-[44px] py-2 pl-10 pr-11 [&::-webkit-search-cancel-button]:hidden')}
      />
      {value !== '' && (
        <IconButton icon="close" label="Очистить поиск" iconSize={18} className="absolute right-0 top-1/2 -translate-y-1/2" onClick={() => onChange('')} />
      )}
    </div>
  );
}
