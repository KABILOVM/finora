import { hasTag, tagKey, withoutTag, withTag } from '@/features/trips/trips';
import type { KnownTag } from './knownTags';
import { NOTE_MAX } from './txForm';

/**
 * Метки в поле заметки новой операции и правки: что предложить и что сделать при нажатии. Чистая логика (без React).
 * Два режима. Пока в конце заметки нет «недописанной» метки, чипы — переключатели: нажатие добавляет метку в конец заметки или убирает её.
 * Как только в конце стоит `#` и начало метки (`кофе #са`), чипы — подсказки: остаются метки на это начало, нажатие дописывает метку.
 */

/** Сколько чипов показываем: полоса листается, но огромный список ни к чему. */
export const MAX_TAG_CHIPS = 12;

/** «Недописанная» метка в конце заметки: `#` (перед ним пробел или начало строки) и начало метки, возможно пустое. null — такой нет. */
export function tagPartial(note: string): { start: number; text: string } | null {
  const m = /(^|\s)#([\p{L}\p{N}_-]{0,40})$/u.exec(note);
  if (!m) return null;
  return { start: m.index + (m[1]?.length ?? 0), text: m[2] ?? '' };
}

export type TagChips = { mode: 'toggle' | 'complete'; items: KnownTag[] };

/** Какие метки показать под полем заметки. Пусто — полосы нет (и остаётся обычная кнопка «Готово»). */
export function noteTagChips(known: readonly KnownTag[], note: string): TagChips {
  const partial = tagPartial(note);
  const prefix = partial === null ? null : tagKey(partial.text);
  // в конце стоит целая известная метка (`кофе #Самарканд`) — это не «недописанное»: чипы остаются переключателями, и можно добавить вторую
  if (partial === null || prefix === null || known.some((t) => t.key === prefix)) return { mode: 'toggle', items: known.slice(0, MAX_TAG_CHIPS) };
  return { mode: 'complete', items: known.filter((t) => t.key.startsWith(prefix)).slice(0, MAX_TAG_CHIPS) };
}

/** Нажата ли метка (есть ли она в заметке): для переключателей. */
export const tagIsOn = (note: string, tag: KnownTag): boolean => hasTag(note, tag.tag);

/**
 * Заметка после нажатия на метку. toggle: есть — убирается, нет — добавляется в конец. complete: недописанное начало заменяется меткой
 * целиком. Если заметка с меткой не поместилась бы в предел — остаётся прежней.
 */
export function pickTag(note: string, tag: KnownTag, mode: TagChips['mode']): string {
  if (mode === 'toggle') return hasTag(note, tag.tag) ? withoutTag(note, tag.tag) : withTag(note, tag.tag);
  const partial = tagPartial(note);
  if (partial === null) return withTag(note, tag.tag);
  const next = `${note.slice(0, partial.start)}#${tag.tag}`;
  return next.length > NOTE_MAX ? note : next;
}
