import { useEffect, useState } from 'react';
import { useStore, type Store } from '@/db';
import { isAdjustment } from '@/domain/adjustment';
import type { IsoDate, Minor, Transaction } from '@/domain/types';
import { addDays, todayLocal } from '@/lib/dates';

/** За сколько последних дней ищем похожие заметки. */
export const NOTE_SUGGEST_DAYS = 365;
/** Сколько подсказок показываем под полем заметки. */
export const NOTE_SUGGEST_LIMIT = 3;

/**
 * Что вносилось раньше с такой заметкой: вид, заметка, категория, кошелёк — одна запись на сочетание, с числом повторов,
 * датой последнего раза и суммой последнего раза. Строится один раз при открытии формы, дальше поиск идёт в памяти.
 */
export interface NoteEntry {
  kind: 'expense' | 'income';
  /** Заметка последней такой операции, как её написал человек (без пробелов по краям). */
  note: string;
  categoryId: string | null;
  walletId: string;
  /** Сумма последней такой операции. */
  amountMinor: Minor;
  count: number;
  lastOn: IsoDate;
  /** Заметка в нижнем регистре, пробелы схлопнуты: по ней ищем. */
  norm: string;
}

type Row = Pick<
  Transaction,
  'kind' | 'walletId' | 'categoryId' | 'amountMinor' | 'note' | 'occurredOn' | 'debtId' | 'recurringRuleId' | 'fxSource'
> & { deletedAt: unknown };

/** Для сравнения: без регистра, без лишних пробелов, «ё» как «е» (набирают и так, и так). */
export const normNote = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');

/**
 * Индекс заметок за NOTE_SUGGEST_DAYS дней до `today` включительно. В него не попадают: пустые заметки, удалённые, переводы,
 * движение по долгам, операции по расписанию (их заметку человек не набирал), корректировки остатка и записи «из будущего».
 */
export function buildNoteIndex(rows: readonly Row[], today: IsoDate): NoteEntry[] {
  const since = addDays(today, -NOTE_SUGGEST_DAYS);
  const groups = new Map<string, NoteEntry>();
  for (const t of rows) {
    if (t.deletedAt !== null) continue;
    if (t.kind !== 'expense' && t.kind !== 'income') continue;
    if (t.debtId !== null || t.recurringRuleId !== null || isAdjustment(t)) continue;
    if (t.occurredOn < since || t.occurredOn > today) continue;
    const note = t.note.trim();
    if (note === '') continue;
    const norm = normNote(note);
    const key = [t.kind, norm, t.categoryId ?? '', t.walletId].join('|');
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { kind: t.kind, note, categoryId: t.categoryId, walletId: t.walletId, amountMinor: t.amountMinor, count: 1, lastOn: t.occurredOn, norm });
    } else {
      g.count++;
      // «последний раз» — самая поздняя дата; при равенстве дат остаётся уже взятая запись (результат не зависит от порядка строк)
      if (t.occurredOn > g.lastOn) {
        g.lastOn = t.occurredOn;
        g.note = note;
        g.amountMinor = t.amountMinor;
      }
    }
  }
  return [...groups.values()];
}

/**
 * Подсказки для набираемой заметки. Совпадает начало заметки («ко» → «Кофе с собой») или начало любого её слова («соб» →
 * «Кофе с собой»); середина слова не в счёт: так меньше случайных попаданий. Порядок: сначала совпадения с начала заметки,
 * потом по числу повторов, потом свежее. Пустой запрос подсказок не даёт.
 */
export function suggestNotes(index: readonly NoteEntry[], kind: string, query: string, limit = NOTE_SUGGEST_LIMIT): NoteEntry[] {
  const q = normNote(query);
  if (q === '' || (kind !== 'expense' && kind !== 'income')) return [];
  const ranked: { e: NoteEntry; rank: number }[] = [];
  for (const e of index) {
    if (e.kind !== kind) continue;
    if (e.norm.startsWith(q)) ranked.push({ e, rank: 0 });
    else if (e.norm.split(' ').some((w) => w.startsWith(q))) ranked.push({ e, rank: 1 });
  }
  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.e.count - a.e.count ||
        (a.e.lastOn < b.e.lastOn ? 1 : a.e.lastOn > b.e.lastOn ? -1 : 0) ||
        (a.e.norm < b.e.norm ? -1 : a.e.norm > b.e.norm ? 1 : 0) ||
        (a.e.walletId < b.e.walletId ? -1 : a.e.walletId > b.e.walletId ? 1 : 0) ||
        ((a.e.categoryId ?? '') < (b.e.categoryId ?? '') ? -1 : 1),
    )
    .slice(0, limit)
    .map((x) => x.e);
}

export async function loadNoteIndex(store: Store, today: IsoDate): Promise<NoteEntry[]> {
  const rows = await store.db.transactions.where('occurredOn').aboveOrEqual(addDays(today, -NOTE_SUGGEST_DAYS)).toArray();
  return buildNoteIndex(rows, today);
}

/**
 * Один раз при открытии формы. Пока читается (миллисекунды) или если чтение не удалось — пустой индекс: подсказок нет,
 * внести операцию это не мешает.
 */
export function useNoteIndex(): readonly NoteEntry[] {
  const store = useStore();
  const [index, setIndex] = useState<readonly NoteEntry[]>([]);
  useEffect(() => {
    let alive = true;
    loadNoteIndex(store, todayLocal())
      .then((i) => alive && setIndex(i))
      .catch((e: unknown) => console.error('Не удалось прочитать заметки для подсказок:', e));
    return () => {
      alive = false;
    };
  }, [store]);
  return index;
}
