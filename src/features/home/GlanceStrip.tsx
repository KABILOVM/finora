import { Card } from '@/components/Card';
import type { CurrencyCode } from '@/domain/types';
import RatesWidget from './RatesWidget';
import WeatherWidget from './WeatherWidget';

/**
 * Тонкая полоса «Курсы и погода»: слева доллар и рубль к основной валюте, справа погода сегодня. Каждая половина ведёт в свой
 * раздел. На совсем узком экране (< 360 px) половины встают друг под друга.
 */
export function GlanceStrip({ base }: { base: CurrencyCode }) {
  return (
    <Card padding="none" data-testid="home-glance" className="grid grid-cols-1 overflow-hidden min-[360px]:grid-cols-[auto_minmax(0,1fr)]">
      <RatesWidget base={base} />
      <div className="min-w-0 border-t border-border/60 min-[360px]:border-l min-[360px]:border-t-0">
        <WeatherWidget />
      </div>
    </Card>
  );
}
