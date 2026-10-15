import { Card } from '@/components/Card';
import { MoneyText } from '@/components/MoneyText';
import { formatMinor } from '@/domain/money';
import { endSentence } from '@/features/transactions/txDisplay';
import { BalanceLine } from './charts/BalanceLine';
import type { MissingRate } from './netWorth';
import type { NetWorthData } from './useNetWorth';

const WHERE: Record<MissingRate['where'], string> = { wallets: 'в кошельках', owed: 'мне должны', owe: 'я должен' };

/** «100 $ (в кошельках), 20 $ (я должен)» — что не вошло в итог из-за отсутствия курса. */
export function missingText(missing: readonly MissingRate[]): string {
  return missing.map((m) => `${formatMinor(m.amountMinor, m.currency)} (${WHERE[m.where]})`).join(', ');
}

function Row({ label, tone, children }: { label: string; tone?: 'income' | 'expense'; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`font-semibold ${tone === 'income' ? 'text-income' : tone === 'expense' ? 'text-expense' : ''}`}>{children}</dd>
    </div>
  );
}

/**
 * «Чистый капитал»: деньги в кошельках (с накоплениями) + мне должны − я должен, и график денег в кошельках по месяцам.
 * В историю долги не входят: сумма долга хранится без истории, прошлые значения не восстановить — об этом сказано под графиком.
 */
export function NetWorthCard({ data }: { data: NetWorthData }) {
  const { net, history, base } = data;
  return (
    <Card aria-labelledby="analytics-networth" data-testid="networth-card" className="!py-4 md:!p-5">
      <h2 id="analytics-networth" className="mb-1 text-base font-semibold">
        Чистый капитал
      </h2>
      <p className="text-[clamp(1.75rem,8vw,2.25rem)] font-extrabold leading-tight tracking-tight" data-testid="networth-total">
        {net.approximate && <span title="Приблизительно: часть сумм пересчитана по курсу или не вошла в расчёт">≈ </span>}
        <MoneyText minor={net.netMinor} currency={base} tone={net.netMinor < 0 ? 'expense' : 'none'} />
      </p>
      <dl className="mt-3 flex flex-col gap-1.5 text-sm" data-testid="networth-rows">
        <Row label="Деньги в кошельках">
          <MoneyText minor={net.walletsMinor} currency={base} tone="none" />
        </Row>
        {net.owedToMeMinor > 0 && (
          <Row label="Мне должны" tone="income">
            <MoneyText minor={net.owedToMeMinor} currency={base} tone="income" sign="always" />
          </Row>
        )}
        {net.iOweMinor > 0 && (
          <Row label="Я должен" tone="expense">
            <MoneyText minor={-net.iOweMinor} currency={base} tone="expense" />
          </Row>
        )}
      </dl>
      {net.missing.length > 0 && (
        <p className="mt-2 text-sm font-medium text-warning" data-testid="networth-missing">
          Не вошло в расчёт — нет курса: {endSentence(missingText(net.missing))}
        </p>
      )}

      <h3 className="mt-5 text-sm font-semibold text-muted">Деньги в кошельках по месяцам</h3>
      <div className="mt-2">
        <BalanceLine points={history} base={base} />
      </div>
      <p className="mt-2 text-xs text-muted">Долги в историю не входят: сумма долга хранится без истории, прошлые значения не восстановить.</p>
    </Card>
  );
}
