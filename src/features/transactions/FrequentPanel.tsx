import { Glyph } from '@/components/Glyph';

/** Одна «частая» операция в панели категорий: всё уже превращено в текст, здесь только рисуем. */
export interface FrequentChoice {
  key: string;
  /** Заметка или, если её нет, название категории. */
  title: string;
  /** «Еда · Наличные · 3 раза»: для подсказки при наведении и скринридера. */
  subtitle: string;
  amount: string;
  icon: string;
  color?: string;
}

export const FREQUENT_LABEL = 'Частые операции';

/**
 * Полоса чипов над категориями: «☕ Кофе 15 с.». Нажатие подставляет кошелёк, категорию, сумму и заметку сразу.
 * Лежит внутри панели категорий, а не в верхней строке формы: там на узком телефоне нет места (подписи «Расход / Доход / Перевод»
 * наезжали друг на друга), а панель всё равно открывают, когда выбирают категорию.
 */
export function FrequentStrip({ items, onPick }: { items: readonly FrequentChoice[]; onPick: (key: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="px-1 text-sm font-semibold text-muted">Часто вносите</p>
      <div role="group" aria-label={FREQUENT_LABEL} className="flex gap-2 overflow-x-auto overscroll-x-contain px-0.5 pb-1 [scrollbar-width:thin]">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            title={it.subtitle}
            onClick={() => onPick(it.key)}
            className="flex min-h-[44px] max-w-[70%] shrink-0 items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1.5 pr-3 text-left transition-colors hover:bg-surface-2 active:bg-border/60"
          >
            <Glyph value={it.icon} color={it.color} size={30} />
            <span className="min-w-0 truncate text-base font-semibold text-text">{it.title}</span>
            <span className="money shrink-0 text-base font-semibold text-muted">{it.amount}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
