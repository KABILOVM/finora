import { useId, type ReactNode } from 'react';
import { Card } from '@/components/Card';

/** Блок настроек: заголовок снаружи, содержимое в карточке. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mb-6">
      <h2 id={id} className="mb-2 px-1 text-sm font-bold uppercase tracking-wide text-muted">
        {title}
      </h2>
      <Card className="flex flex-col gap-3">{children}</Card>
    </section>
  );
}
