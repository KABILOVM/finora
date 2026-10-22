import { MoneyText } from '@/components/MoneyText';
import type { Category, CurrencyCode, LocalRow } from '@/domain/types';
import { Section } from './Section';
import { incomeFlow, type FlowSegment, type PeriodSummary } from './periods';

const HEX = /^#[0-9a-f]{6}$/i;
/** Цвета тех, у кого своего нет: без категории, комиссии, «остальное». */
const PLAIN: Record<string, string> = { none: '#a8a29e', fee: '#94a3b8', rest: '#cbd5e1' };

const colorOf = (seg: FlowSegment, cat: LocalRow<Category> | undefined): string =>
  cat?.color && HEX.test(cat.color) ? cat.color : (PLAIN[seg.key] ?? '#a8a29e');

function nameOf(seg: FlowSegment, cat: LocalRow<Category> | undefined): string {
  if (seg.kind === 'fee') return 'Комиссии';
  if (seg.kind === 'rest') return 'Остальное';
  return cat?.name ?? 'Без категории';
}

/** «<1%» вместо «0%» для малых долей. */
const shareText = (share: number): string => (share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`);

export interface IncomeFlowCardProps {
  summary: PeriodSummary;
  categories: ReadonlyMap<string, LocalRow<Category>>;
  base: CurrencyCode;
}

/**
 * «Куда ушли деньги»: одна полоса — весь доход периода, поделённая на расходы по категориям и остаток. Расходы больше дохода — полоса
 * это все расходы, а превышение подписано отдельно. Картинка для глаз (aria-hidden), настоящее содержимое — список под ней.
 */
export function IncomeFlowCard({ summary, categories, base }: IncomeFlowCardProps) {
  const flow = incomeFlow(summary);
  if (!flow) return null;
  const rows = flow.segments.map((seg) => {
    const cat = seg.categoryId === null ? undefined : categories.get(seg.categoryId);
    return { seg, name: nameOf(seg, cat), color: colorOf(seg, cat) };
  });
  const lead =
    summary.incomeMinor <= 0
      ? 'Доходов за период нет: полоса — все расходы.'
      : flow.deficitMinor > 0
        ? 'Расходы больше дохода: полоса — все расходы.'
        : 'Вся полоса — доход за период.';
  return (
    <Section id="period-flow" title="Куда ушли деньги">
      <div data-testid="income-flow">
        <p className="mb-2 text-sm text-muted">{lead}</p>
        <div aria-hidden="true" className="flex h-4 w-full gap-px overflow-hidden rounded-pill bg-surface-2" data-testid="income-flow-bar">
          {rows.map(({ seg, color }) => (
            <span key={seg.key} style={{ flexGrow: seg.share, flexBasis: 0, minWidth: 3, backgroundColor: color }} />
          ))}
          {flow.savedMinor > 0 && <span className="bg-income" style={{ flexGrow: flow.savedShare, flexBasis: 0, minWidth: 3 }} />}
        </div>
        <ul className="mt-3 flex flex-col divide-y divide-border" aria-label="Из чего состоит доход">
          {rows.map(({ seg, name, color }) => (
            <li key={seg.key} className="flex min-h-[40px] items-center gap-2 py-1.5 text-sm" data-testid={`flow-${seg.key}`}>
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <span className="shrink-0 text-xs text-muted">{shareText(seg.share)}</span>
              <MoneyText minor={seg.minor} currency={base} tone="none" className="shrink-0 font-semibold" />
            </li>
          ))}
          {flow.savedMinor > 0 && (
            <li className="flex min-h-[40px] items-center gap-2 py-1.5 text-sm" data-testid="flow-saved">
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm bg-income" />
              <span className="min-w-0 flex-1 truncate">Осталось</span>
              <span className="shrink-0 text-xs text-muted">{shareText(flow.savedShare)}</span>
              <MoneyText minor={flow.savedMinor} currency={base} tone="income" className="shrink-0 font-semibold" />
            </li>
          )}
        </ul>
        {flow.deficitMinor > 0 && (
          <p className="mt-2 text-sm font-medium text-expense" data-testid="flow-deficit">
            {summary.incomeMinor > 0 ? 'Потрачено сверх дохода: ' : 'Потрачено: '}
            <MoneyText minor={flow.deficitMinor} currency={base} tone="expense" />
          </p>
        )}
      </div>
    </Section>
  );
}
