import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { currencyInfo } from '@/domain/currency';
import type { CurrencyCode } from '@/domain/types';
import { FlagIcon } from '@/features/converter/FlagIcon';
import { useRates } from '@/rates/hooks';
import type { RateLookup } from '@/rates/types';
import { formatUnits, formatWidgetRate, scaleRate, shortAsOf, widgetCurrencies } from './ratesView';

interface Row {
  code: CurrencyCode;
  lookup: RateLookup | null;
}

function rowText(row: Row, base: CurrencyCode): string | null {
  if (!row.lookup) return null;
  const { units, value } = scaleRate(row.lookup.rate);
  return `${formatUnits(units)} ${row.code} = ${formatWidgetRate(value)} ${currencyInfo(base).symbol}`;
}

/**
 * Карточка «Курсы» для «Главной»: доллар и рубль к основной валюте, дата курса и пометка «устарел». Нажатие открывает «Курсы и
 * конвертер». Курсы лежат на устройстве, поэтому карточка работает без интернета; нет курса — так и пишем, без выдуманных цифр.
 */
export default function RatesWidget({ base }: { base: CurrencyCode }) {
  const { getRate } = useRates();
  const rows: Row[] = widgetCurrencies(base).map((code) => ({ code, lookup: getRate(code, base) }));
  const known = rows.filter((r): r is Row & { lookup: RateLookup } => r.lookup !== null);
  const asOf = known.map((r) => r.lookup.asOf).sort()[0];
  const stale = known.some((r) => r.lookup.stale);
  const manual = known.some((r) => r.lookup.manual);

  const label = known.length
    ? `Курсы к ${currencyInfo(base).name}: ${known.map((r) => rowText(r, base)).join('; ')}${stale ? '. Курсы устарели' : ''}. Открыть курсы и конвертер`
    : 'Курсы валют: пока нет данных. Открыть курсы и конвертер';

  return (
    <Link
      to="/rates"
      aria-label={label}
      data-testid="rates-widget"
      className="block min-w-0 rounded-3xl transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/40"
    >
      <Card className="h-full !p-3 hover:bg-surface-2 md:!p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-muted">Курсы</h2>
          <Icon name="chevron" size={18} className="shrink-0 text-muted" />
        </div>
        <ul className="mt-1.5 space-y-1.5">
          {rows.map((r) => (
            <li key={r.code} className="flex items-center gap-2" data-testid="rates-widget-row">
              <FlagIcon code={r.code} size={24} />
              {r.lookup ? (
                <span className="min-w-0 flex-1 text-sm font-semibold leading-tight">
                  <span className="block text-muted">
                    {formatUnits(scaleRate(r.lookup.rate).units)} {r.code}
                  </span>
                  <span className="block tabular-nums text-text">
                    {formatWidgetRate(scaleRate(r.lookup.rate).value)} {currencyInfo(base).symbol}
                  </span>
                </span>
              ) : (
                <span className="min-w-0 flex-1 text-sm leading-tight text-muted">
                  <span className="block font-semibold">{r.code}</span>
                  <span className="block">нет курса</span>
                </span>
              )}
            </li>
          ))}
        </ul>
        {asOf && (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>на {shortAsOf(asOf)}</span>
            {stale && <Badge tone="warning">устарел</Badge>}
            {manual && !stale && <Badge tone="brand">свой курс</Badge>}
          </p>
        )}
        {!asOf && <p className="mt-2 text-xs text-muted">Нажмите, чтобы обновить</p>}
      </Card>
    </Link>
  );
}
