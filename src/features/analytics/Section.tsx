import type { ReactNode } from 'react';
import { Card } from '@/components/Card';

/** Карточка экрана «Аналитика»: заголовок и содержимое. */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card aria-labelledby={id} className="!py-4 md:!p-5">
      <h2 id={id} className="mb-3 text-base font-semibold">
        {title}
      </h2>
      {children}
    </Card>
  );
}
