import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';

const BARS = 28;

const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export interface RecordPanelProps {
  /** Громкость голоса сейчас, 0…1. */
  level: number;
  /** Сколько секунд идёт запись. */
  seconds: number;
  /** Сколько секунд можно записывать. */
  maxSeconds: number;
}

/**
 * Что видно во время записи: пульсирующий микрофон (кольца растут вместе с громкостью), «эквалайзер» из последних звуков и таймер.
 * Для тех, у кого отключены анимации, кольца и плавность убирает глобальное правило prefers-reduced-motion (index.css).
 */
export function RecordPanel({ level, seconds, maxSeconds }: RecordPanelProps) {
  const [history, setHistory] = useState<number[]>(() => Array(BARS).fill(0));
  const last = useRef(level);
  useEffect(() => {
    last.current = level;
    setHistory((h) => [...h.slice(1), level]);
  }, [level]);
  const left = maxSeconds - seconds;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Идёт запись"
      data-testid="record-panel"
      className="flex flex-col items-center gap-3 rounded-2xl bg-surface-2 px-4 py-5"
    >
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-danger/25 motion-safe:animate-ping"
          style={{ animationDuration: '1.6s' }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-danger/20 transition-transform duration-100"
          style={{ transform: `scale(${1 + Math.min(1, level) * 0.55})` }}
        />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-danger text-white shadow-float">
          <Icon name="mic" size={30} />
        </span>
      </div>
      <div aria-hidden="true" className="flex h-10 w-full items-center justify-center gap-[3px]">
        {history.map((v, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-danger/70 transition-[height] duration-100"
            style={{ height: `${Math.round(4 + Math.min(1, v) * 34)}px`, opacity: 0.35 + (i / BARS) * 0.65 }}
          />
        ))}
      </div>
      <p className="money text-lg font-bold tabular-nums">{clock(seconds)}</p>
      <p className="text-sm text-muted">
        {left <= 10 ? `Запись остановится через ${left} с` : 'Говорите список, потом нажмите «Остановить»'}
      </p>
    </div>
  );
}
