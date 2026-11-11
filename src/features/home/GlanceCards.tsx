import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '@/components/Card';
import type { CurrencyCode } from '@/domain/types';
import type { Forecast } from '@/features/weather/api';
import RatesWidget from './RatesWidget';
import WeatherAdviceRow from './WeatherAdviceRow';
import WeatherWidget from './WeatherWidget';

/**
 * Блок «Курсы валют» на «Главной»: выбранные валюты (по умолчанию доллар и рубль) к основной, нажатие открывает «Курсы валют».
 * По умолчанию стоит парой с «Погодой» (обе — в половину ширины); каждую можно скрыть или растянуть в настройке главной, там же
 * выбирают валюты (`currencies`).
 */
export function RatesCard({ base, currencies }: { base: CurrencyCode; currencies?: readonly CurrencyCode[] }) {
  return (
    <Card padding="none" data-testid="home-rates" className="overflow-hidden">
      <RatesWidget base={base} {...(currencies ? { currencies } : {})} />
    </Card>
  );
}

/**
 * Блок «Погода» на «Главной»: сейчас в выбранном городе. Если в ближайшие часы дождь или снег, появляется строка-совет
 * («возьмите зонт», «оденьтесь потеплее»): нижней строкой этой карточки, а когда погода стоит в половину ширины — отдельной
 * карточкой во всю ширину под её рядом. Место для неё даёт главная (`adviceSlot`): не передано — совет внутри карточки;
 * null — место ещё не готово (совет появится, когда будет).
 */
export function WeatherCard({ adviceSlot }: { adviceSlot?: HTMLElement | null }) {
  // прогноз грузит сама ячейка погоды; строке-совету он передаётся оттуда, чтобы не ходить в сеть дважды
  const [forecast, setForecast] = useState<Forecast | null>(null);
  return (
    <Card padding="none" data-testid="home-weather" className="flex flex-col overflow-hidden">
      <WeatherWidget onForecast={setForecast} />
      {forecast && adviceSlot === undefined && <WeatherAdviceRow forecast={forecast} />}
      {forecast && adviceSlot && createPortal(<WeatherAdviceRow forecast={forecast} detached />, adviceSlot)}
    </Card>
  );
}
