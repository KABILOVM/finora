import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { inputClasses } from '@/components/Field';
import type { CurrencyCode } from '@/domain/types';
import { cn } from '@/lib/cn';
import { CURRENCY_META, POPULAR_CURRENCIES, currencyName } from './currencyMeta';
import { FlagIcon } from './FlagIcon';

export interface CurrencyPickerProps {
  open: boolean;
  title: string;
  value: CurrencyCode;
  /** Валюты, по которым есть курс. */
  available: readonly CurrencyCode[];
  onPick: (code: CurrencyCode) => void;
  onClose: () => void;
}

/** Выбор валюты: поиск по коду и названию, популярные сверху. */
export function CurrencyPicker({ open, title, value, available, onPick, onClose }: CurrencyPickerProps) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const set = new Set(available);
    const all = Object.keys(CURRENCY_META).filter((c) => set.has(c));
    const popular = POPULAR_CURRENCIES.filter((c) => set.has(c));
    const rest = all.filter((c) => !popular.includes(c)).sort((a, b) => currencyName(a).localeCompare(currencyName(b), 'ru'));
    const ordered = q ? all : [...popular, ...rest];
    return ordered.filter((c) => !q || c.toLowerCase().includes(q) || currencyName(c).toLowerCase().includes(q));
  }, [available, query]);

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={title}>
      <div className="relative mb-3">
        <Icon name="search" size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          data-autofocus
          type="search"
          inputMode="search"
          autoComplete="off"
          aria-label="Поиск валюты"
          placeholder="Название или код"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={cn(inputClasses(false), 'min-h-[48px] pl-11')}
        />
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-muted">Ничего не найдено</p>
      ) : (
        <ul className="-mx-1 divide-y divide-border/60">
          {rows.map((code) => (
            <li key={code}>
              <button
                type="button"
                onClick={() => {
                  onPick(code);
                  close();
                }}
                aria-current={code === value ? 'true' : undefined}
                className={cn(
                  'flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-surface-2 active:bg-border/60',
                  code === value && 'bg-brand/10',
                )}
              >
                <FlagIcon code={code} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-text">{code}</span>
                  <span className="block truncate text-sm text-muted">{currencyName(code)}</span>
                </span>
                {code === value && <Icon name="check" size={20} className="text-brand" label="Выбрано" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
