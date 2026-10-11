import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Logo } from '@/components/Logo';
import { Wordmark } from '@/components/Wordmark';
import { cn } from '@/lib/cn';
import { TOTAL_STEPS, stepNumber, type StepId } from './onboardingLogic';

export interface WizardFrameProps {
  step: StepId;
  title: string;
  /** Короткая подпись под заголовком. */
  lead?: string;
  children: ReactNode;
  /** Нижняя панель; по умолчанию «Назад / Дальше» из пропсов ниже. */
  footer?: ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  /** Сообщение под кнопками (например, почему «Дальше» недоступно). */
  note?: string | null;
}

/**
 * Каркас мастера: на весь экран, поверх приложения. Сверху знак и «Шаг N из 5», в середине содержимое шага
 * (при нехватке места прокручивается только оно), снизу кнопки. Заголовок шага получает фокус при смене шага.
 */
export function WizardFrame({ step, title, lead, children, footer, onBack, onNext, nextLabel = 'Дальше', nextDisabled, nextLoading, note }: WizardFrameProps) {
  const n = stepNumber(step);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Настройка Finora"
      className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-bg text-text"
    >
      <div className="shrink-0 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Logo size={28} />
            <Wordmark className="text-lg" />
          </div>
          {n !== null && (
            <p aria-live="polite" className="text-sm font-semibold text-muted">
              Шаг {n} из {TOTAL_STEPS}
            </p>
          )}
        </div>
        {n !== null && (
          <div className="mx-auto mt-2 flex w-full max-w-md gap-1" aria-hidden="true">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <span key={i} className={cn('h-1.5 flex-1 rounded-full', i < n ? 'bg-brand' : 'bg-border')} />
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3">
        <div className="mx-auto flex w-full max-w-md flex-col gap-3">
          <div>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none">
              {title}
            </h1>
            {lead && <p className="mt-1 text-base text-muted">{lead}</p>}
          </div>
          {children}
        </div>
      </div>

      {(footer || onNext) && (
        <div className="shrink-0 border-t border-border/70 bg-bg px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto w-full max-w-md">
            {note && (
              <p role="status" className="mb-2 text-center text-sm text-muted">
                {note}
              </p>
            )}
            {footer ?? (
              <div className="flex gap-2">
                {onBack && (
                  <Button variant="secondary" size="lg" onClick={onBack} className="shrink-0">
                    Назад
                  </Button>
                )}
                <Button size="lg" fullWidth onClick={onNext} disabled={nextDisabled} loading={nextLoading}>
                  {nextLabel}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
