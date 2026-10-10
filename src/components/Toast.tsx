import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastOptions {
  tone?: ToastTone;
  /** Сколько показывать, мс. По умолчанию 4000 (ошибки — 7000). 0 — пока не закроют. */
  durationMs?: number;
  /** Кнопка в тосте, например «Отменить» после удаления. */
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

export interface ToastApi {
  show: (message: string, options?: ToastOptions) => number;
  success: (message: string, options?: Omit<ToastOptions, 'tone'>) => number;
  error: (message: string, options?: Omit<ToastOptions, 'tone'>) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const MAX_VISIBLE = 3;
const TONE_ICON: Record<ToastTone, IconName> = { info: 'info', success: 'check', error: 'alert' };
const TONE_CLASS: Record<ToastTone, string> = {
  info: 'text-brand',
  success: 'text-income',
  error: 'text-danger',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((cur) => cur.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = nextId.current++;
      const tone = options.tone ?? 'info';
      const duration = options.durationMs ?? (tone === 'error' ? 7000 : 4000);
      setItems((cur) => [...cur, { ...options, tone, id, message }].slice(-MAX_VISIBLE));
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m, o) => show(m, { ...o, tone: 'success' }),
      error: (m, o) => show(m, { ...o, tone: 'error' }),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className={cn(
          'pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4',
          // Над нижней панелью на телефоне, в правом нижнем углу на ПК.
          'bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:bottom-6 lg:left-auto lg:right-6 lg:items-end',
        )}
      >
        {items.map((t) => {
          const tone = t.tone ?? 'info';
          return (
            <div
              key={t.id}
              role={tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm animate-pop-in items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-float"
            >
              <Icon name={TONE_ICON[tone]} size={22} className={cn('shrink-0', TONE_CLASS[tone])} />
              <p className="min-w-0 flex-1 text-base text-text">{t.message}</p>
              {t.action && (
                <button
                  type="button"
                  className="-my-2 min-h-[44px] shrink-0 rounded-lg px-2 text-base font-semibold text-brand"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                aria-label="Закрыть уведомление"
                className="-mr-2 -my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted"
                onClick={() => dismiss(t.id)}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast: компонент должен быть внутри <ToastProvider>');
  return ctx;
}
