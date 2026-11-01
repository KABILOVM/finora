import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { DEBT_OVERFLOW_MESSAGE } from '@/db';
import type { IsoDate } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { overdueCount } from './debtSummary';
import { totalsLine, type Person } from './people';
import { PersonAvatar } from './personAvatar';

/** Список людей с открытыми долгами: имя, сколько долгов, итог по каждой валюте и просрочка. Строка — ссылка на страницу человека. */
export function PeopleList({ people, today }: { people: readonly Person[]; today: IsoDate }) {
  return (
    <Card padding="none" className="overflow-hidden">
      <ul aria-label="Люди" className="divide-y divide-border">
        {people.map((p) => {
          const late = overdueCount(p.open, today);
          return (
            <li key={p.key}>
              <Link
                to={`/debts/people/${encodeURIComponent(p.key)}`}
                className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 active:bg-border/60"
              >
                <PersonAvatar name={p.name} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="line-clamp-2 min-w-0 break-words font-semibold">{p.name}</span>
                    <span className="text-sm text-muted">
                      {p.open.length} {pluralRu(p.open.length, 'долг', 'долга', 'долгов')}
                    </span>
                  </span>
                  {p.overflow ? (
                    <span role="alert" className="mt-0.5 block text-sm font-medium text-danger">
                      {DEBT_OVERFLOW_MESSAGE}
                    </span>
                  ) : (
                    p.totals.map((t) => (
                      <span key={t.currency} className="mt-0.5 block text-sm text-muted">
                        {totalsLine(t)}
                      </span>
                    ))
                  )}
                  {late > 0 && (
                    <Badge tone="danger" className="mt-1">
                      Просрочено: {late}
                    </Badge>
                  )}
                </span>
                <Icon name="chevron" size={18} className="shrink-0 text-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
