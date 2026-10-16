import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { conditionOf, formatTemp } from '@/features/weather/conditions';
import { locate } from '@/features/weather/geolocation';
import { withCity } from '@/features/weather/places';
import { useForecast } from '@/features/weather/useForecast';
import { usePlaces } from '@/features/weather/usePlaces';
import { WeatherIcon } from '@/features/weather/WeatherIcon';

const CELL = 'press relative flex min-h-[64px] min-w-0 items-center gap-2 px-3 py-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-brand/40';

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Правая ячейка полосы «Курсы и погода» на «Главной»: сейчас в выбранном городе. Нажатие открывает «Погоду» — день по часам и
 * следующие дни. Пока город не выбран, в сеть не ходим: ячейка предлагает определить место или выбрать город.
 */
export default function WeatherWidget() {
  const { ready, cities, chosen: city, commit } = usePlaces();
  const { data, loading, error } = useForecast(city);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Геолокацию спрашиваем только по нажатию: само приложение за человеком не следит.
  const findMe = async () => {
    setLocating(true);
    setLocateError(null);
    try {
      const here = await locate();
      const change = withCity(cities, here);
      if (!change) throw new Error('Список городов полон. Откройте «Погоду» и удалите ненужный');
      await commit(change);
    } catch (e) {
      setLocateError(e instanceof Error ? e.message : 'Не удалось определить местоположение');
    } finally {
      setLocating(false);
    }
  };

  if (!ready) return <div data-testid="weather-widget" aria-busy="true" className="min-h-[64px] px-3 py-3"><div className="skeleton h-9 w-24 rounded-xl" aria-hidden="true" /></div>;

  if (!city) {
    return (
      <div data-testid="weather-widget" aria-label="Погода" role="group" className="flex min-h-[64px] min-w-0 flex-col justify-center px-2 py-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void findMe()}
            disabled={locating}
            aria-busy={locating}
            className="press inline-flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-brand/10 px-2 text-sm font-semibold leading-tight text-brand hover:bg-brand/15 disabled:opacity-60"
          >
            {locating && <Spinner size={16} />}
            <span className="truncate">{locating ? 'Определяем…' : 'Определить место'}</span>
          </button>
          <Link
            to="/weather"
            aria-label="Выбрать город"
            className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-brand hover:bg-brand/10"
          >
            <Icon name="search" size={20} />
          </Link>
        </div>
        {locateError && (
          <p role="alert" className="px-1 text-xs font-medium leading-tight text-danger">
            {locateError}
          </p>
        )}
      </div>
    );
  }

  if (!data) {
    const failed = !loading && error !== null;
    return (
      <Link
        to="/weather"
        data-testid="weather-widget"
        aria-label={`Погода, ${city.name}: ${failed ? 'не удалось получить' : 'загружается'}. Открыть погоду`}
        className={CELL}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{city.name}</span>
          {failed ? (
            <span className="block text-xs text-muted">Погода недоступна</span>
          ) : (
            <span role="status" className="mt-1 flex items-center gap-2 text-xs text-muted">
              <span className="skeleton h-3 w-16 rounded" aria-hidden="true" />
              <span className="sr-only">Загружаем…</span>
            </span>
          )}
        </span>
        <Icon name="chevron" size={16} className="shrink-0 text-muted" />
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
      className={CELL}
    >
      <WeatherIcon kind={cond.kind} isDay={data.current.isDay} size={40} className="pop-spring shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-2xl font-extrabold leading-none tracking-tight tabular-nums">{formatTemp(data.current.temp)}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">{city.name}</span>
      </span>
      {note && <span aria-hidden="true" title={`Данные ${note}`} className="absolute right-2 top-2 h-2 w-2 rounded-full bg-warning" />}
    </Link>
  );
}
