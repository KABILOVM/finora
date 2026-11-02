import { useState } from 'react';
import { Card } from '@/components/Card';
import type { CurrencyCode } from '@/domain/types';
import type { Forecast } from '@/features/weather/api';
import RatesWidget from './RatesWidget';
import WeatherAdviceRow from './WeatherAdviceRow';
import WeatherWidget from './WeatherWidget';

/**
 * Тонкая полоса «Курсы и погода»: слева доллар и рубль к основной валюте, справа погода сегодня. Каждая половина ведёт в свой
 * раздел. На совсем узком экране (< 360 px) половины встают друг под друга. Если в ближайшие часы дождь или снег, под ними
 * появляется строка-совет («возьмите зонт», «оденьтесь потеплее»).
 */
export function GlanceStrip({ base }: { base: CurrencyCode }) {
  // прогноз грузит сама ячейка погоды; строке-совету он передаётся оттуда, чтобы не ходить в сеть дважды
  const [forecast, setForecast] = useState<Forecast | null>(null);
  return (
    <Card padding="none" data-testid="home-glance" className="grid grid-cols-1 overflow-hidden min-[360px]:grid-cols-[auto_minmax(0,1fr)]">
      <RatesWidget base={base} />
      <div className="min-w-0 border-t border-border/60 min-[360px]:border-l min-[360px]:border-t-0">
        <WeatherWidget onForecast={setForecast} />
      </div>
      {forecast && <WeatherAdviceRow forecast={forecast} />}
    </Card>
  );
}
