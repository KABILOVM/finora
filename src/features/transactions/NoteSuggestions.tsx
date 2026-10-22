import { Glyph } from '@/components/Glyph';
import { cn } from '@/lib/cn';

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
  /** Разобранная строка («такси 20 карта»): первый чип, выделен цветом, подпись «Применить». */
  accent?: boolean;
  /** Короткая пометка рядом с заметкой («вчера»): то, что изменится кроме суммы, но не видно из остального текста. */
  tag?: string;
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
          aria-label={`${it.accent ? 'Применить: ' : ''}${it.note}, ${it.detail}, ${it.amount}`}
          title={it.detail}
          onClick={() => onPick(it.key)}
          className={cn(
            'flex min-h-[44px] max-w-[85%] shrink-0 items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 text-left transition-colors',
            it.accent
              ? 'border-brand/50 bg-brand/10 hover:bg-brand/15 active:bg-brand/20'
              : 'border-border bg-surface-2 hover:bg-border/50 active:bg-border/80',
          )}
        >
          <Glyph value={it.icon} color={it.color} size={28} />
          <span className="min-w-0 truncate text-base font-semibold text-text">{it.note}</span>
          {it.tag && <span className="shrink-0 text-sm font-medium text-brand">{it.tag}</span>}
          <span className="money shrink-0 text-base font-semibold text-muted">{it.amount}</span>
        </button>
      ))}
    </div>
  );
}
