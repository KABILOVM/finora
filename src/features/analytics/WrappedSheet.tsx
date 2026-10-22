import { Fragment, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/Button';
import { MoneyText } from '@/components/MoneyText';
import { Sheet } from '@/components/Sheet';
import type { CurrencyCode } from '@/domain/types';
import { cn } from '@/lib/cn';
import type { Seg, WrappedCard } from './wrapped';

const TONE: Record<WrappedCard['tone'], string> = {
  brand: 'bg-gradient-to-br from-brand to-accent text-brand-fg',
  income: 'bg-income text-brand-fg',
  expense: 'bg-expense text-on-danger',
};

function Segs({ segs, base, strong = false }: { segs: readonly Seg[]; base: CurrencyCode; strong?: boolean }) {
  return (
    <>
      {segs.map((s, i) =>
        typeof s === 'string' ? (
          <Fragment key={i}>{s}</Fragment>
        ) : (
          <MoneyText key={i} minor={s.money} currency={base} tone={s.tone ?? 'none'} className={strong ? undefined : 'font-bold'} />
        ),
      )}
    </>
  );
}

/** Крупный текст слайда: длинному («самый затратный месяц», название категории) — размер меньше, чтобы не вылезал за карточку. */
function bigSize(segs: readonly Seg[]): string {
  const len = segs.reduce((n, s) => n + (typeof s === 'string' ? s.length : 10), 0);
  return len > 16 ? 'text-[clamp(1.5rem,8vw,2rem)]' : 'text-[clamp(2rem,11vw,3rem)]';
}

export interface WrappedSheetProps {
  title: string;
  cards: readonly WrappedCard[];
  base: CurrencyCode;
  onClose: () => void;
}

/**
 * «Итоги года» карточками: слайды листаются пальцем (прокрутка с прилипанием), кнопками «Назад» / «Далее» или стрелками клавиатуры.
 * Карточки — картинка для глаз с настоящим текстом внутри: скринридер читает их подряд как группы «1 из 8». Суммы — через MoneyText
 * («Скрыть суммы» прячет и их).
 */
export function WrappedSheet({ title, cards, base, onClose }: WrappedSheetProps) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const last = cards.length - 1;

  const goTo = (i: number) => {
    const el = track.current;
    const next = Math.max(0, Math.min(last, i));
    setIndex(next);
    if (!el || typeof el.scrollTo !== 'function') return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: next * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
  };

  const onScroll = () => {
    const el = track.current;
    if (el && el.clientWidth > 0) setIndex(Math.max(0, Math.min(last, Math.round(el.scrollLeft / el.clientWidth))));
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(index + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(index - 1);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => goTo(index - 1)} disabled={index === 0} aria-label="Предыдущая карточка" className="min-w-[7rem]">
            Назад
          </Button>
          <p className="min-w-0 flex-1 text-center text-sm text-muted" aria-live="polite" data-testid="wrapped-position">
            {index + 1} из {cards.length}
          </p>
          <Button onClick={() => (index === last ? onClose() : goTo(index + 1))} aria-label={index === last ? 'Закрыть итоги' : 'Следующая карточка'} className="min-w-[7rem]">
            {index === last ? 'Готово' : 'Далее'}
          </Button>
        </div>
      }
    >
      <div
        ref={track}
        role="region"
        aria-roledescription="карусель"
        aria-label="Итоги года"
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKey}
        data-testid="wrapped-track"
        className="-mx-1 flex snap-x snap-mandatory overflow-x-auto scroll-smooth rounded-3xl outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {cards.map((c, i) => (
          <section
            key={c.id}
            role="group"
            aria-roledescription="карточка"
            aria-label={`${i + 1} из ${cards.length}: ${c.heading}`}
            data-testid={`wrapped-${c.id}`}
            className={cn('mx-1 flex min-h-[19rem] min-w-[calc(100%-0.5rem)] snap-center flex-col justify-between rounded-3xl p-5', TONE[c.tone])}
          >
            <h3 className="text-sm font-semibold uppercase tracking-wide opacity-90">{c.heading}</h3>
            <div>
              <p className={cn('break-words font-extrabold leading-tight tracking-tight', bigSize(c.big))}>
                <Segs segs={c.big} base={base} strong />
              </p>
              <div className="mt-3 flex flex-col gap-1 text-base">
                {c.lines.map((line, j) => (
                  <p key={j} className="break-words">
                    <Segs segs={line} base={base} />
                  </p>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
