import type { Forecast } from './api';
import { conditionOf, type SkyKind } from './conditions';

/** Совет по погоде для «Главной»: значок, как у погоды, и короткая фраза. */
export interface WeatherAdvice {
  icon: SkyKind;
  text: string;
}

/** Сколько ближайших часов (считая текущий) смотрим вперёд. */
export const ADVICE_HOURS = 6;
/** Прогноз старше этого уже не повод что-то советовать: он мог успеть измениться. */
export const ADVICE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
/** Не выше этой температуры (°C) под дождём советуем одеться потеплее. */
export const COLD_C = 10;

const HOUR_MS = 60 * 60 * 1000;

type Wet = 'rain' | 'snow';

/** Осадки по значку погоды; ясно, облачно и туман — не повод что-то советовать. */
function wetOf(kind: SkyKind): Wet | null {
  if (kind === 'rain' || kind === 'drizzle' || kind === 'storm') return 'rain';
  if (kind === 'snow') return 'snow';
  return null;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Что посоветовать по прогнозу: при дожде — взять зонт, при снеге — одеться потеплее, а под холодным дождём — и то и другое.
 * Смотрит текущий и ближайшие 5 часов, сдвигая прогноз на время, прошедшее с загрузки (прогнозу из памяти может быть и час):
 * прошедшие часы не учитываются. Нет осадков, прогноз старше трёх часов или часов в нём не осталось — `null`.
 */
export function weatherAdvice(forecast: Forecast, now: Date = new Date()): WeatherAdvice | null {
  const age = now.getTime() - Date.parse(forecast.fetchedAt);
  if (!Number.isFinite(age) || age > ADVICE_MAX_AGE_MS) return null;

  // hours[0] — час, в который прогноз загружен; «сейчас» — тот слот, куда мы к этому моменту дошли
  const minutes = Number(forecast.current.time.slice(14, 16));
  const into = Number.isFinite(minutes) ? minutes : 0;
  const first = Math.floor((into * 60_000 + Math.max(0, age)) / HOUR_MS);

  const slots: { time: string; code: number; temp: number; now: boolean }[] = [];
  for (let i = first; i < first + ADVICE_HOURS; i += 1) {
    if (i === 0) {
      // самый свежий слот точнее всего описывает «текущая погода»
      slots.push({ time: forecast.hours[0]?.time ?? forecast.current.time.slice(11, 16), code: forecast.current.code, temp: forecast.current.temp, now: true });
    } else {
      const h = forecast.hours[i];
      if (h) slots.push({ time: h.time, code: h.code, temp: h.temp, now: i === first });
    }
  }

  const wet = slots.filter((s) => wetOf(conditionOf(s.code).kind) !== null);
  const head = wet[0];
  if (!head) return null;

  const kinds = new Set(wet.map((s) => wetOf(conditionOf(s.code).kind)));
  const cold = Math.min(...wet.map((s) => s.temp)) <= COLD_C;
  const todo = [kinds.has('rain') && 'возьмите зонт', (kinds.has('snow') || cold) && 'оденьтесь потеплее'].filter((x): x is string => x !== false);

  const c = conditionOf(head.code);
  const when = head.now ? `Сейчас ${lower(c.label)}` : `К ${head.time} ожидается ${lower(c.label)}`;
  return { icon: c.kind, text: `${when} — ${todo.join(' и ')}` };
}
