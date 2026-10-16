import { Link } from 'react-router-dom';
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
 * Левая ячейка полосы «Курсы и погода» на «Главной»: доллар и рубль к основной валюте, две строки по 20 px. Нажатие открывает
 * «Курсы и конвертер». Курсы лежат на устройстве, поэтому работает без интернета; нет курса — так и пишем, без выдуманных цифр.
 * Дата курса и «устарел» — в имени ссылки и жёлтой точкой, чтобы не занимать место.
 */
export default function RatesWidget({ base }: { base: CurrencyCode }) {
  const { getRate } = useRates();
  const rows: Row[] = widgetCurrencies(base).map((code) => ({ code, lookup: getRate(code, base) }));
  const known = rows.filter((r): r is Row & { lookup: RateLookup } => r.lookup !== null);
  const asOf = known.map((r) => r.lookup.asOf).sort()[0];
  const stale = known.some((r) => r.lookup.stale);
  const manual = known.some((r) => r.lookup.manual);

  const label = known.length
    ? `Курсы к ${currencyInfo(base).name}: ${known.map((r) => rowText(r, base)).join('; ')}${asOf ? `, на ${shortAsOf(asOf)}` : ''}${stale ? '. Курсы устарели' : ''}${manual && !stale ? '. Свой курс' : ''}. Открыть курсы и конвертер`
    : 'Курсы валют: пока нет данных. Открыть курсы и конвертер';

  return (
    <Link
      to="/rates"
      aria-label={label}
      data-testid="rates-widget"
      className="press relative flex min-h-[64px] min-w-0 flex-col justify-center gap-0.5 rounded-l-3xl px-3 py-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-brand/40"
    >
      {rows.map((r, i) => (
        <span key={r.code} data-testid="rates-widget-row" style={{ '--i': i } as React.CSSProperties} className="pop-spring flex items-center gap-2 text-sm leading-5">
          <FlagIcon code={r.code} size={18} />
          {r.lookup ? (
            <>
              <span className="text-muted">
                {formatUnits(scaleRate(r.lookup.rate).units)} {r.code}
              </span>
              <span className="ml-auto font-semibold tabular-nums">
                {formatWidgetRate(scaleRate(r.lookup.rate).value)} {currencyInfo(base).symbol}
              </span>
            </>
          ) : (
            <>
              <span className="text-muted">{r.code}</span>
              <span className="ml-auto text-muted">нет курса</span>
            </>
          )}
        </span>
      ))}
      {(stale || manual) && (
        <span
          aria-hidden="true"
          title={stale ? 'Курс устарел' : 'Свой курс'}
          className={`absolute right-2 top-2 h-2 w-2 rounded-full ${stale ? 'bg-warning' : 'bg-brand'}`}
        />
      )}
    </Link>
  );
}
