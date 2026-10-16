import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { conditionOf, formatTemp } from '@/features/weather/conditions';
import { locate } from '@/features/weather/geolocation';
import { rememberCity } from '@/features/weather/places';
import { loadChosenCity } from '@/features/weather/store';
import { useForecast } from '@/features/weather/useForecast';
import { WeatherIcon } from '@/features/weather/WeatherIcon';

const CARD_LINK =
  'block min-w-0 rounded-3xl transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/40';

function Heading() {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-muted">Погода</h2>
      <Icon name="chevron" size={18} className="shrink-0 text-muted" />
    </div>
  );
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Карточка «Погода» для «Главной»: сейчас и на сегодня в выбранном городе. Нажатие открывает «Погоду» — весь день по часам и
 * следующие дни. Пока город не выбран, в сеть не ходим: карточка предлагает выбрать место.
 */
export default function WeatherWidget() {
  const [city, setCity] = useState(loadChosenCity);
  const { data, loading, error } = useForecast(city);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Геолокацию спрашиваем только по нажатию: само приложение за человеком не следит.
  const findMe = async () => {
    setLocating(true);
    setLocateError(null);
    try {
      const here = await locate();
      if (!rememberCity(here)) throw new Error('Список городов полон. Откройте «Погоду» и удалите ненужный');
      setCity(loadChosenCity());
    } catch (e) {
      setLocateError(e instanceof Error ? e.message : 'Не удалось определить местоположение');
    } finally {
      setLocating(false);
    }
  };

  if (!city) {
    return (
      <Card data-testid="weather-widget" aria-labelledby="weather-widget-title" className="h-full !p-3 md:!p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 id="weather-widget-title" className="text-base font-semibold text-muted">
            Погода
          </h2>
        </div>
        <p className="mt-1.5 text-sm font-semibold leading-snug">Покажем погоду там, где вы</p>
        <button
          type="button"
          onClick={() => void findMe()}
          disabled={locating}
          aria-busy={locating}
          className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-brand/10 px-2 text-sm font-semibold leading-tight text-brand transition active:scale-[0.97] hover:bg-brand/15 disabled:opacity-60"
        >
          {locating && <Spinner size={16} />}
          {locating ? 'Определяем…' : 'Определить место'}
        </button>
        {locateError && (
          <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
            {locateError}
          </p>
        )}
        <Link to="/weather" className="mt-0.5 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand">
          Выбрать город
        </Link>
      </Card>
    );
  }

  if (!data) {
    const failed = !loading && error !== null;
    return (
      <Link
        to="/weather"
        data-testid="weather-widget"
        aria-label={`Погода, ${city.name}: ${failed ? 'не удалось получить' : 'загружается'}. Открыть погоду`}
        className={CARD_LINK}
      >
        <Card className="h-full !p-3 hover:bg-surface-2 md:!p-5">
          <Heading />
          <p className="mt-1.5 truncate text-sm font-semibold">{city.name}</p>
          {failed ? (
            <p className="mt-1 text-sm text-muted">Погода недоступна. Нажмите, чтобы повторить</p>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted" role="status">
              <Spinner size={16} /> Загружаем…
            </p>
          )}
        </Card>
      </Link>
    );
  }

  const cond = conditionOf(data.current.code);
  const today = data.days[0];
  const range = today ? `днём ${formatTemp(today.max)}, ночью ${formatTemp(today.min)}` : null;
  const note = error ? `на ${hhmm(data.fetchedAt)}` : null;

  return (
    <Link
      to="/weather"
      data-testid="weather-widget"
      aria-label={`Погода, ${city.name}: ${formatTemp(data.current.temp)}, ${cond.label}${range ? `, ${range}` : ''}${note ? `. Данные ${note}` : ''}. Открыть погоду`}
      className={CARD_LINK}
    >
      <Card className="h-full !p-3 hover:bg-surface-2 md:!p-5">
        <Heading />
        <div className="mt-1 flex items-center gap-2">
          <WeatherIcon kind={cond.kind} isDay={data.current.isDay} size={44} className="shrink-0" />
          <span className="min-w-0">
            <span className="block text-3xl font-extrabold leading-none tracking-tight tabular-nums">{formatTemp(data.current.temp)}</span>
            <span className="mt-1 block text-sm font-medium leading-tight">{cond.label}</span>
          </span>
        </div>
        <p className="mt-2 truncate text-xs text-muted">{city.name}</p>
        {range && <p className="text-xs text-muted">{range}</p>}
        {note && <p className="text-xs font-medium text-warning">{note}</p>}
      </Card>
    </Link>
  );
}
