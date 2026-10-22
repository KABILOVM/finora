import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { useStore } from '@/db';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate } from '@/domain/types';
import { budgetLabel } from '@/features/budgets/budgetText';
import { transactionsQuery } from '@/features/transactions/txFilters';
import { formatDayLabel } from '@/lib/dates';
import { useDismissedKeys } from '@/lib/dismissedKeys';
import { pluralRu } from '@/lib/plural';
import { hasAnomalies, type Anomalies } from './anomalies';
import type { AnalyticsData } from './useAnalyticsData';

/** Вид подсказок для «Скрыть» (на этом устройстве, отдельно для каждого человека). */
export const ANOMALIES_NAMESPACE = 'anomalies';

type Lookups = AnalyticsData['categories'];

export interface AnomaliesCardProps {
  anomalies: Anomalies;
  categories: Lookups;
  base: CurrencyCode;
  month: string;
  today: IsoDate;
}

interface Row {
  key: string;
  /** Короткое название для скринридера: «Скрыть: банкет». */
  name: string;
  testId: string;
  icon: ReactNode;
  title: ReactNode;
  text: string;
  to: string;
  /** Окно правки операции поверх этого экрана (иначе обычный переход). */
  overlay: boolean;
  label: string;
}

/**
 * «Что бросается в глаза»: необычно крупная трата, новая статья расходов, возможный дубль (anomalies.ts). Каждую находку можно
 * открыть или скрыть («Скрыть» помнится на этом устройстве). Ничего не утверждает: дубль — вопрос, а не приговор. Нет находок — нет карточки.
 */
export function AnomaliesCard({ anomalies, categories, base, month, today }: AnomaliesCardProps) {
  const store = useStore();
  const location = useLocation();
  const { hidden, dismiss } = useDismissedKeys(ANOMALIES_NAMESPACE, store.userId);
  if (!hasAnomalies(anomalies)) return null;

  const rows: Row[] = [];
  for (const b of anomalies.big) {
    const cat = budgetLabel(b.categoryId, categories);
    rows.push({
      key: b.key,
      name: b.note !== '' ? b.note : cat.name,
      testId: 'anomaly-big',
      icon: <Glyph value={cat.icon} color={cat.color ?? undefined} size={32} />,
      title: (
        <>
          Необычно крупная трата: <span className="font-bold">{b.note !== '' ? b.note : cat.name}</span> — <MoneyText minor={b.amountMinor} currency={base} tone="expense" />
        </>
      ),
      text: `${formatDayLabel(b.occurredOn, today)} · в «${cat.name}» обычно около ${formatMinor(b.usualMinor, base)}, крупнее не было за последние месяцы.`,
      to: `/edit/${b.txId}`,
      overlay: true,
      label: 'Открыть трату',
    });
  }
  for (const n of anomalies.fresh) {
    const cat = budgetLabel(n.categoryId, categories);
    rows.push({
      key: n.key,
      name: cat.name,
      testId: 'anomaly-new',
      icon: <Glyph value={cat.icon} color={cat.color ?? undefined} size={32} />,
      title: (
        <>
          Новая статья расходов: <span className="font-bold">{cat.name}</span> — <MoneyText minor={n.spentMinor} currency={base} tone="none" />
        </>
      ),
      text: `${n.sharePercent}% расходов месяца. За последние три месяца в этой категории трат не было.`,
      to: `/transactions?${transactionsQuery({ month, categoryId: n.categoryId, kind: 'expense' })}`,
      overlay: false,
      label: 'К операциям',
    });
  }
  for (const d of anomalies.dupes) {
    const cat = d.categoryId === null ? null : budgetLabel(d.categoryId, categories);
    const count = d.txIds.length;
    rows.push({
      key: d.key,
      name: d.note !== '' ? d.note : (cat?.name ?? 'Без категории'),
      testId: 'anomaly-dup',
      icon: (
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-warning/15 text-warning">
          <Icon name="alert" size={18} />
        </span>
      ),
      title: (
        <>
          Возможный дубль: <span className="font-bold">{d.note !== '' ? d.note : (cat?.name ?? 'Без категории')}</span> — <MoneyText minor={d.amountMinor} currency={base} tone="expense" /> × {count}
        </>
      ),
      text: `${formatDayLabel(d.occurredOn, today)} · ${count} ${pluralRu(count, 'одинаковая трата', 'одинаковые траты', 'одинаковых трат')} за день. Если это не повтор, скройте.`,
      to: `/edit/${d.txIds[0]}`,
      overlay: true,
      label: 'Открыть трату',
    });
  }
  const visible = rows.filter((r) => !hidden.has(r.key));
  if (visible.length === 0) return null;

  return (
    <Card aria-labelledby="analytics-attention" data-testid="anomalies-card" className="!py-4 md:!p-5">
      <h2 id="analytics-attention" className="mb-1 text-base font-semibold">
        Что бросается в глаза
      </h2>
      <ul className="flex flex-col divide-y divide-border">
        {visible.map((r) => (
          <li key={r.key} data-testid={r.testId} className="flex flex-col gap-2 py-3">
            <div className="flex items-start gap-3">
              {r.icon}
              <div className="min-w-0 flex-1 text-sm">
                <p className="break-words">{r.title}</p>
                <p className="mt-0.5 text-muted">{r.text}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={r.to} state={r.overlay ? { background: location } : undefined} className={buttonClasses('secondary', 'md')}>
                {r.label}
              </Link>
              <Button variant="ghost" aria-label={`Скрыть: ${r.name}`} onClick={() => dismiss(r.key)}>
                Скрыть
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
