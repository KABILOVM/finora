import { Link } from 'react-router-dom';
import { Card } from '@/components/Card';
import type { Forecast } from '@/features/weather/api';
import { weatherAdvice } from '@/features/weather/advice';
import { useNow } from '@/features/weather/useNow';
import { WeatherIcon } from '@/features/weather/WeatherIcon';
import { cn } from '@/lib/cn';

/**
 * Строка-совет блока «Погода» на «Главной»: «возьмите зонт» при дожде, «оденьтесь потеплее» при снеге. Показывается, только когда в
 * ближайшие часы есть осадки; ясно или облачно — строки нет вовсе. Нажатие открывает «Погоду».
 * `detached` — совет стоит отдельной карточкой под рядом с погодой (когда погода в половину ширины), а не нижней строкой её карточки.
 */
export default function WeatherAdviceRow({ forecast, detached = false }: { forecast: Forecast; detached?: boolean }) {
  const advice = weatherAdvice(forecast, useNow());
  if (!advice) return null;

  const row = (
    <Link
      to="/weather"
      data-testid="weather-advice"
      className={cn(
        'press slide-down flex min-h-[44px] items-center gap-2 bg-brand/5 px-3 py-2 text-sm font-semibold hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-brand/40',
        !detached && 'border-t border-border/60',
      )}
    >
      <WeatherIcon kind={advice.icon} size={28} className="shrink-0" />
      <span className="min-w-0 flex-1">{advice.text}</span>
    </Link>
  );
  return detached ? (
    <Card padding="none" className="overflow-hidden">
      {row}
    </Card>
  ) : (
    row
  );
}
