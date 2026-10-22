import { Glyph } from '@/components/Glyph';

/** Одна подсказка под полем заметки: всё уже превращено в текст, здесь только рисуем. */
export interface NoteChoice {
  key: string;
  /** Заметка, как её писали раньше. */
  note: string;
  /** «Еда · Наличные»: категория и кошелёк, которые подставятся. */
  detail: string;
  /** Сумма последнего раза. */
  amount: string;
  icon: string;
  color?: string;
}

export const NOTE_SUGGEST_LABEL = 'Похожие записи';

/**
 * Что вы уже вносили с похожей заметкой: нажатие подставляет заметку, категорию и кошелёк (и сумму, если она ещё не набрана).
 * Одна полоса чипов высотой с кнопку «Готово», которую она заменяет: над полем заметки места нет (панель и так занимает всё
 * доступное над суммой), поэтому подсказки не должны её удлинять, иначе поле ввода уезжает под шапку окна.
 */
export function NoteSuggestions({ items, onPick }: { items: readonly NoteChoice[]; onPick: (key: string) => void }) {
  return (
    <div role="group" aria-label={NOTE_SUGGEST_LABEL} className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-label={`${it.note}, ${it.detail}, ${it.amount}`}
          title={it.detail}
          onClick={() => onPick(it.key)}
          className="flex min-h-[44px] max-w-[85%] shrink-0 items-center gap-2 rounded-full border border-border bg-surface-2 py-1 pl-1.5 pr-3 text-left transition-colors hover:bg-border/50 active:bg-border/80"
        >
          <Glyph value={it.icon} color={it.color} size={28} />
          <span className="min-w-0 truncate text-base font-semibold text-text">{it.note}</span>
          <span className="money shrink-0 text-base font-semibold text-muted">{it.amount}</span>
        </button>
      ))}
    </div>
  );
}
