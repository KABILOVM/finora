import { Link } from 'react-router-dom';
import type { Forecast } from '@/features/weather/api';
import { weatherAdvice } from '@/features/weather/advice';
import { useNow } from '@/features/weather/useNow';
import { WeatherIcon } from '@/features/weather/WeatherIcon';

/**
 * Нижняя строка полосы «Курсы и погода»: «возьмите зонт» при дожде, «оденьтесь потеплее» при снеге. Показывается, только когда в
 * ближайшие часы есть осадки; ясно или облачно — строки нет вовсе. Нажатие открывает «Погоду».
 */
export default function WeatherAdviceRow({ forecast }: { forecast: Forecast }) {
  const advice = weatherAdvice(forecast, useNow());
  if (!advice) return null;

  return (
    <Link
      to="/weather"
      data-testid="weather-advice"
      className="press slide-down flex min-h-[44px] items-center gap-2 border-t border-border/60 bg-brand/5 px-3 py-2 text-sm font-semibold hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-brand/40 min-[360px]:col-span-2"
    >
      <WeatherIcon kind={advice.icon} size={28} className="shrink-0" />
      <span className="min-w-0 flex-1">{advice.text}</span>
    </Link>
  );
}
