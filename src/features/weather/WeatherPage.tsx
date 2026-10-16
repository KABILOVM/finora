import { useEffect, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { inputClasses } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Sheet } from '@/components/Sheet';
import { buttonClasses, Spinner } from '@/components/Button';
import { cn } from '@/lib/cn';
import { searchCities, type City } from './api';
import { conditionOf, formatTemp, skyGradient } from './conditions';
import { locate } from './geolocation';
import { withCity, withoutCity } from './places';
import { clearCache, loadCities, loadSelected, MAX_CITIES, saveCities, saveSelected } from './store';
import { useForecast } from './useForecast';
import { WeatherIcon } from './WeatherIcon';

function weekday(date: string, index: number): string {
  if (index === 0) return 'Сегодня';
  if (index === 1) return 'Завтра';
  const d = new Date(`${date}T12:00:00Z`);
  const w = d.toLocaleDateString('ru-RU', { weekday: 'long', timeZone: 'UTC' });
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-black/15 px-3 py-2.5">
      <p className="text-xs text-white/75">{label}</p>
      <p className="mt-0.5 text-base font-bold tabular-nums">{value}</p>
    </div>
  );
}

interface CitySearchProps {
  open: boolean;
  cities: City[];
  onAdd: (c: City) => void;
  onClose: () => void;
  /** Определить место по геолокации; вызывается только по нажатию. */
  onLocate: () => void;
  locating: boolean;
  locateError: string | null;
}

function CitySearch({ open, cities, onAdd, onClose, onLocate, locating, locateError }: CitySearchProps) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<City[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      setErr(null);
      setBusy(false);
      return undefined;
    }
    const c = new AbortController();
    setBusy(true);
    const t = setTimeout(() => {
      searchCities(q, c.signal)
        .then((r) => {
          setResults(r);
          setErr(null);
        })
        .catch((e: unknown) => {
          if (!c.signal.aborted) setErr(e instanceof Error ? e.message : 'Поиск не удался');
        })
        .finally(() => {
          if (!c.signal.aborted) setBusy(false);
        });
    }, 350);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [q]);

  const close = () => {
    setQ('');
    onClose();
  };
  const full = cities.length >= MAX_CITIES;

  return (
    <Sheet open={open} onClose={close} title="Добавить город">
      <button
        type="button"
        onClick={onLocate}
        disabled={locating}
        aria-busy={locating}
        className={cn(buttonClasses('secondary', 'md', true), 'mb-1')}
      >
        {locating ? <Spinner /> : <Icon name="target" size={20} />}
        {locating ? 'Определяем…' : 'Определить по геолокации'}
      </button>
      {locateError && (
        <p role="alert" className="mb-2 mt-2 text-sm font-medium text-danger">
          {locateError}
        </p>
      )}
      <p className="mb-3 mt-1 text-xs text-muted">Телефон спросит разрешение. Место запоминается с точностью около километра.</p>
      <div className="relative mb-3">
        <Icon name="search" size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          data-autofocus
          type="search"
          autoComplete="off"
          aria-label="Название города"
          placeholder="Например, Куляб"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={cn(inputClasses(false), 'min-h-[48px] pl-11')}
        />
      </div>
      {full && <p className="mb-2 text-sm text-warning">Можно сохранить до {MAX_CITIES} городов. Удалите ненужный.</p>}
      {busy && (
        <p className="flex items-center gap-2 py-4 text-muted">
          <Spinner /> Ищем…
        </p>
      )}
      {err && <p role="alert" className="py-3 text-sm font-medium text-danger">{err}</p>}
      {!busy && !err && q.trim().length >= 2 && results.length === 0 && <p className="py-6 text-center text-muted">Город не найден</p>}
      <ul className="divide-y divide-border/60">
        {results.map((c) => {
          const exists = cities.some((x) => x.id === c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={exists || full}
                onClick={() => {
                  onAdd(c);
                  close();
                }}
                className="flex min-h-[56px] w-full items-center gap-3 px-1 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                <Icon name="cloud" size={22} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{c.name}</span>
                  <span className="block truncate text-sm text-muted">{c.region}</span>
                </span>
                {exists && <Badge>Уже в списке</Badge>}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

/** Погода: текущая, по часам на сутки и на 7 дней (Open-Meteo, без ключа). Города запоминаются на устройстве. */
export default function WeatherPage() {
  const [cities, setCities] = useState<City[]>(loadCities);
  const [selectedId, setSelectedId] = useState(() => loadSelected(cities));
  const [adding, setAdding] = useState(false);
  const city = cities.find((c) => c.id === selectedId) ?? cities[0]!;
  const { data, loading, error, reload } = useForecast(city);

  const select = (id: string) => {
    setSelectedId(id);
    saveSelected(id);
  };
  const apply = (change: { cities: City[]; selectedId: string }) => {
    for (const gone of cities) if (!change.cities.some((c) => c.id === gone.id)) clearCache(gone.id);
    setCities(change.cities);
    saveCities(change.cities);
    select(change.selectedId);
  };
  const add = (c: City): boolean => {
    const change = withCity(cities, c);
    if (change) apply(change);
    return change !== null;
  };
  const remove = (c: City) => {
    const change = withoutCity(cities, selectedId, c.id);
    if (change) apply(change);
  };

  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const findMe = async () => {
    setLocating(true);
    setLocateError(null);
    try {
      const here = await locate();
      if (add(here)) setAdding(false);
      else setLocateError(`Можно сохранить до ${MAX_CITIES} городов. Удалите ненужный.`);
    } catch (e) {
      setLocateError(e instanceof Error ? e.message : 'Не удалось определить местоположение');
    } finally {
      setLocating(false);
    }
  };

  const cond = data ? conditionOf(data.current.code) : null;
  const today = data?.days[0];

  return (
    <>
      <PageHeader
        title="Погода"
        subtitle={city.region ? `${city.name}, ${city.region}` : city.name}
        actions={
          <>
            <IconButton icon="refresh" label="Обновить погоду" onClick={() => void reload()} disabled={loading} className={cn(loading && '[&_svg]:animate-spin')} />
            <IconButton icon="plus" label="Добавить город" onClick={() => setAdding(true)} />
          </>
        }
      />

      <div role="tablist" aria-label="Города" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {cities.map((c) => (
          <span key={c.id} className="flex shrink-0 items-center">
            <button
              type="button"
              role="tab"
              aria-selected={c.id === selectedId}
              onClick={() => select(c.id)}
              className={cn(
                'min-h-[40px] rounded-full px-4 text-sm font-semibold transition active:scale-95',
                c.id === selectedId ? 'bg-brand text-brand-fg shadow-float' : 'border border-border bg-surface/70 text-text hover:bg-surface-2',
              )}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      {!data && loading && (
        <Card className="flex items-center justify-center gap-3 py-16 text-muted">
          <Spinner size={22} /> Загружаем погоду…
        </Card>
      )}

      {!data && !loading && error && (
        <Card className="py-10 text-center">
          <p className="font-semibold">Погоду получить не удалось</p>
          <p className="mt-1 text-muted">{error}. Проверьте интернет и попробуйте ещё раз.</p>
          <button type="button" onClick={() => void reload()} className="mt-4 min-h-[44px] rounded-2xl bg-brand px-5 font-semibold text-brand-fg">
            Повторить
          </button>
        </Card>
      )}

      {data && cond && (
        <>
          <section
            aria-label={`Погода сейчас: ${cond.label}`}
            className={cn('animate-rise overflow-hidden rounded-3xl bg-gradient-to-br p-5 text-white shadow-card', skyGradient(cond.kind, data.current.isDay))}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-6xl font-extrabold leading-none tracking-tight tabular-nums">{formatTemp(data.current.temp)}</p>
                <p className="mt-2 text-lg font-semibold">{cond.label}</p>
                {today && (
                  <p className="mt-0.5 text-sm text-white/85">
                    Днём {formatTemp(today.max)} · ночью {formatTemp(today.min)}
                  </p>
                )}
              </div>
              <WeatherIcon kind={cond.kind} isDay={data.current.isDay} size={104} className="shrink-0 drop-shadow-lg" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Ощущается" value={formatTemp(data.current.feels)} />
              <Metric label="Ветер" value={`${data.current.wind.toFixed(1).replace('.', ',')} м/с`} />
              <Metric label="Влажность" value={`${Math.round(data.current.humidity)}%`} />
              <Metric label="Давление" value={`${data.current.pressure} мм`} />
            </div>
            {(data.sunrise || data.sunset) && (
              <p className="mt-3 text-sm text-white/85">
                Восход {data.sunrise ?? '—'} · закат {data.sunset ?? '—'}
              </p>
            )}
          </section>

          {error && (
            <p role="status" className="mt-3 rounded-2xl bg-warning/10 px-4 py-2.5 text-sm font-medium text-warning">
              Не удалось обновить ({error}). Показаны данные на {new Date(data.fetchedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.
            </p>
          )}

          {data.hours.length > 0 && (
            <section aria-labelledby="hours-title" className="mt-6">
              <h2 id="hours-title" className="mb-2 text-lg font-bold">
                По часам
              </h2>
              <Card padding="none">
                <ul className="flex gap-1 overflow-x-auto px-2 py-3">
                  {data.hours.map((h, i) => (
                    <li key={h.time + i} className="flex w-[64px] shrink-0 flex-col items-center gap-1 rounded-2xl px-1 py-1">
                      <span className="text-xs font-semibold text-muted">{i === 0 ? 'Сейчас' : h.time}</span>
                      <WeatherIcon kind={conditionOf(h.code).kind} isDay={h.isDay} size={36} />
                      <span className="font-bold tabular-nums">{formatTemp(h.temp)}</span>
                      <span className="h-4 text-xs text-brand">{h.rain !== null && h.rain >= 20 ? `${h.rain}%` : ''}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {data.days.length > 0 && (
            <section aria-labelledby="days-title" className="mt-6">
              <h2 id="days-title" className="mb-2 text-lg font-bold">
                На неделю
              </h2>
              <Card padding="none">
                <ul className="divide-y divide-border/60">
                  {data.days.map((d, i) => {
                    const c = conditionOf(d.code);
                    return (
                      <li key={d.date} className="flex min-h-[60px] items-center gap-3 px-4 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{weekday(d.date, i)}</span>
                          <span className="block truncate text-sm text-muted">
                            {shortDate(d.date)} · {c.label}
                          </span>
                        </span>
                        {d.rain !== null && d.rain >= 20 && <span className="text-xs font-semibold text-brand">{d.rain}%</span>}
                        <WeatherIcon kind={c.kind} size={36} />
                        <span className="w-[88px] text-right font-bold tabular-nums">
                          {formatTemp(d.max)} <span className="font-medium text-muted">{formatTemp(d.min)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          )}

          <p className="mt-4 text-center text-xs text-muted">
            Обновлено {new Date(data.fetchedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · данные{' '}
            <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline">
              Open-Meteo
            </a>
          </p>
        </>
      )}

      {cities.length > 1 && (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={() => remove(city)} className="min-h-[44px] rounded-2xl px-4 text-sm font-semibold text-danger hover:bg-danger/10">
            Убрать «{city.name}» из списка
          </button>
        </div>
      )}

      <CitySearch
        open={adding}
        cities={cities}
        onAdd={(c) => void add(c)}
        onClose={() => {
          setAdding(false);
          setLocateError(null);
        }}
        onLocate={() => void findMe()}
        locating={locating}
        locateError={locateError}
      />
    </>
  );
}
