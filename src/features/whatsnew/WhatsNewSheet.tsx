import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { longDate } from '@/features/budgets/budgetText';
import type { Release } from './releases';

export interface WhatsNewSheetProps {
  releases: readonly Release[];
  onClose: () => void;
}

/** Окно «Что нового»: короткий список по версиям (если версий несколько — с заголовками), одна кнопка «Понятно». */
export function WhatsNewSheet({ releases, onClose }: WhatsNewSheetProps) {
  const several = releases.length > 1;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Что нового"
      footer={
        <Button size="lg" fullWidth data-autofocus onClick={onClose}>
          Понятно
        </Button>
      }
    >
      <div className="flex flex-col gap-5" data-testid="whats-new">
        {releases.map((r) => (
          <section key={r.version} aria-label={`Версия ${r.version}`}>
            {several && (
              <h3 className="mb-2 text-sm font-semibold text-muted">
                Версия {r.version} · {longDate(r.date)}
              </h3>
            )}
            <ul className="flex flex-col gap-3">
              {r.items.map((it) => (
                <li key={it.text} className="flex items-start gap-3">
                  <span aria-hidden="true" className="mt-0.5 w-7 shrink-0 text-center text-xl leading-6">
                    {it.icon}
                  </span>
                  <span className="min-w-0 flex-1 text-base">{it.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
