import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Collapsible } from '@/components/Collapsible';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import type { AttentionItem } from './attention';
import { useAttention } from './useAttention';

const TONE = {
  danger: 'border-danger/30 bg-danger/10 text-danger',
  warning: 'border-warning/30 bg-warning/10 text-warning',
} as const;

/**
 * Строка «Требует внимания»: одна тонкая красная (жёлтая) полоса над остальным, только когда что-то горит. Один пункт — ссылка в
 * нужный раздел; несколько — «первый пункт + N», по нажатию раскрывается список ссылок. Всё спокойно — строки нет вовсе.
 */
export default function AttentionRow() {
  const items = useAttention();
  const [open, setOpen] = useState(false);
  if (!items || items.length === 0) return null;

  const first = items[0]!;
  const more = items.length - 1;
  const tone: AttentionItem['tone'] = items.some((i) => i.tone === 'danger') ? 'danger' : 'warning';
  const rowClass = cn('press flex min-h-[44px] w-full items-center gap-2 rounded-2xl border px-3 py-2 text-left text-sm font-semibold', TONE[tone]);

  return (
    <section aria-label="Требует внимания" data-testid="attention-row" className="slide-down">
      {more === 0 ? (
        <Link to={first.to} className={rowClass}>
          <Icon name="alert" size={18} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{first.text}</span>
          <Icon name="chevron" size={16} className="shrink-0" />
        </Link>
      ) : (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={rowClass}>
            <Icon name="alert" size={18} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{open ? `Требует внимания: ${items.length}` : first.text}</span>
            {!open && <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs text-text">+{more}</span>}
            <Icon name="chevron" size={16} className={cn('shrink-0 transition-transform duration-300', open && 'rotate-90')} />
          </button>
          <Collapsible open={open}>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {items.map((it) => (
                <li key={it.id}>
                  <Link to={it.to} className={cn('press flex min-h-[44px] items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold', TONE[it.tone])}>
                    <span className="min-w-0 flex-1 truncate">{it.text}</span>
                    <Icon name="chevron" size={16} className="shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </Collapsible>
        </>
      )}
    </section>
  );
}
