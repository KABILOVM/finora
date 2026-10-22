import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';

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
  /** Именованный шаблон (templates.ts): в строке стоит первым, со звёздочкой. */
  template?: boolean;
}

export const FREQUENT_LABEL = 'Частые операции';
export const TEMPLATES_LABEL = 'Шаблоны и частые операции';

/**
 * Полоса чипов над категориями: «☕ Кофе 15 с.». Нажатие подставляет кошелёк, категорию, сумму и заметку сразу.
 * Лежит внутри панели категорий, а не в верхней строке формы: там на узком телефоне нет места (подписи «Расход / Доход / Перевод»
 * наезжали друг на друга), а панель всё равно открывают, когда выбирают категорию.
 */
export function FrequentStrip({ items, onPick, onSaveTemplate }: { items: readonly FrequentChoice[]; onPick: (key: string) => void; onSaveTemplate?: () => void }) {
  const withTemplates = items.some((it) => it.template);
  const label = withTemplates || (items.length === 0 && onSaveTemplate) ? 'Шаблоны и частые' : 'Часто вносите';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="min-w-0 text-sm font-semibold text-muted">{label}</p>
        {onSaveTemplate && (
          <button
            type="button"
            onClick={onSaveTemplate}
            className="-mr-1 inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold text-brand hover:bg-brand/10 active:bg-brand/15"
          >
            <Icon name="star" size={16} />
            Сохранить как шаблон
          </button>
        )}
      </div>
      {items.length > 0 && (
      <div role="group" aria-label={withTemplates ? TEMPLATES_LABEL : FREQUENT_LABEL} className="flex gap-2 overflow-x-auto overscroll-x-contain px-0.5 pb-1 [scrollbar-width:thin]">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            title={it.subtitle}
            onClick={() => onPick(it.key)}
            className="flex min-h-[44px] max-w-[70%] shrink-0 items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1.5 pr-3 text-left transition-colors hover:bg-surface-2 active:bg-border/60"
          >
            <Glyph value={it.icon} color={it.color} size={30} />
            {it.template && <Icon name="star" size={14} className="-mr-1 shrink-0 text-brand" />}
            <span className="min-w-0 truncate text-base font-semibold text-text">{it.title}</span>
            <span className="money shrink-0 text-base font-semibold text-muted">{it.amount}</span>
          </button>
        ))}
      </div>
      )}
    </div>
  );
}
