import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useStore } from '@/db';
import { tagKey, tagLabel, tagsOf } from '@/features/trips/trips';

/**
 * Метки `#…`, которые уже встречались в заметках операций: из них выбирают фильтр в списке «Операции» и подсказки в заметке.
 * Метка живёт только в тексте заметки (отдельной таблицы нет), поэтому список собирается чтением заметок.
 */
export interface KnownTag {
  /** tagKey: без регистра и «ё»; по нему сравнивают и пишут в адрес. */
  key: string;
  /** Как показать человеку: самое частое написание без «_» («Поездка в Самарканд»). */
  label: string;
  /** Метка как в заметках (самое частое написание, с «_»): её и вставляют в заметку. */
  tag: string;
  /** В скольких операциях встречается (операция с одной меткой дважды — один раз). */
  count: number;
}

/** Метки из заметок: чаще встречающиеся первыми, при равенстве — по названию. Само написание — самое частое, при равенстве — по алфавиту. */
export function collectTags(notes: readonly string[]): KnownTag[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const note of notes) {
    const seen = new Set<string>();
    for (const tag of tagsOf(note)) {
      const key = tagKey(tag);
      const g = groups.get(key) ?? { count: 0, spellings: new Map<string, number>() };
      g.spellings.set(tag, (g.spellings.get(tag) ?? 0) + 1);
      if (!seen.has(key)) {
        seen.add(key);
        g.count += 1;
      }
      groups.set(key, g);
    }
  }
  const out: KnownTag[] = [];
  for (const [key, g] of groups) {
    const best = [...g.spellings.entries()].sort(([an, a], [bn, b]) => b - a || (an < bn ? -1 : an > bn ? 1 : 0))[0]?.[0] ?? key;
    out.push({ key, label: tagLabel(best), tag: best, count: g.count });
  }
  return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru') || (a.key < b.key ? -1 : 1));
}

/** Все известные метки (не удалённые операции), обновляется вместе с базой. undefined — ещё читается. */
export function useKnownTags(): KnownTag[] | undefined {
  const store = useStore();
  const notes = useLiveQuery(
    async () =>
      (await store.db.transactions.filter((t) => t.deletedAt === null && t.note.includes('#')).toArray()).map((t) => t.note),
    [store],
  );
  return useMemo(() => (notes === undefined ? undefined : collectTags(notes)), [notes]);
}
