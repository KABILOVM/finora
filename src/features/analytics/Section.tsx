import type { ReactNode } from 'react';
import { Card } from '@/components/Card';

/** Карточка экрана «Аналитика»: заголовок и содержимое. */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card aria-labelledby={id}>
      <h2 id={id} className="section-title mb-3">
        {title}
      </h2>
      {children}
    </Card>
  );
}
