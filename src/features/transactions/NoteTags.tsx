import { cn } from '@/lib/cn';
import type { KnownTag } from './knownTags';
import { tagIsOn, type TagChips } from './noteTags';

export const NOTE_TAGS_LABEL = 'Метки';

/**
 * Метки под полем заметки: одна полоса чипов высотой с кнопку «Готово», которую она заменяет (панель не растёт, как и у подсказок).
 * В режиме toggle чип — переключатель («нажата», если метка уже в заметке); в режиме complete — подсказка к недописанной метке.
 */
export function NoteTags({ chips, note, onPick }: { chips: TagChips; note: string; onPick: (tag: KnownTag) => void }) {
  const toggle = chips.mode === 'toggle';
  return (
    <div role="group" aria-label={NOTE_TAGS_LABEL} className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]">
      {chips.items.map((t) => {
        const on = toggle && tagIsOn(note, t);
        return (
          <button
            key={t.key}
            type="button"
            {...(toggle ? { 'aria-pressed': on } : {})}
            title={`${t.count} ${t.count === 1 ? 'операция' : 'операций'}`}
            onClick={() => onPick(t)}
            className={cn(
              'inline-flex min-h-[44px] max-w-[85%] shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-base font-semibold transition-colors',
              on ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface-2 text-text hover:bg-border/50 active:bg-border/80',
            )}
          >
            <span className="truncate">#{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
