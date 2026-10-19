import { useId, type ReactNode } from 'react';
import { Card } from '@/components/Card';
import { SectionHeader } from '@/components/SectionHeader';

/** Блок настроек: заголовок снаружи, содержимое в карточке. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mb-6">
      <SectionHeader id={id}>{title}</SectionHeader>
      <Card className="flex flex-col gap-3">{children}</Card>
    </section>
  );
}
