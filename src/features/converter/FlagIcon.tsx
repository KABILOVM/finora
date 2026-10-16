import { cn } from '@/lib/cn';
import type { CurrencyCode } from '@/domain/types';
import { CURRENCY_META } from './currencyMeta';

// Только нужные флаги попадают в сборку: Vite заменит пути на адреса файлов.
const FLAGS = import.meta.glob('/src/assets/flags/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

function flagUrl(code: CurrencyCode): string | null {
  const country = CURRENCY_META[code]?.country;
  return country ? (FLAGS[`/src/assets/flags/${country}.svg`] ?? null) : null;
}

export interface FlagIconProps {
  code: CurrencyCode;
  /** Диаметр в px. */
  size?: number;
  className?: string;
}

/** Круглый флаг страны валюты. Для неизвестной валюты — кружок с первой буквой кода. */
export function FlagIcon({ code, size = 40, className }: FlagIconProps) {
  const url = flagUrl(code);
  const style = { width: size, height: size };
  const ring = 'shrink-0 rounded-full ring-1 ring-black/10';
  if (!url) {
    return (
      <span
        aria-hidden="true"
        style={{ ...style, fontSize: size * 0.4 }}
        className={cn(ring, 'inline-flex items-center justify-center bg-brand/10 font-bold text-brand', className)}
      >
        {code.slice(0, 1)}
      </span>
    );
  }
  return <img src={url} alt="" aria-hidden="true" draggable={false} style={style} className={cn(ring, 'object-cover', className)} />;
}
