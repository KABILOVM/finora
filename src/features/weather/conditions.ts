/** Вид значка погоды. */
export type SkyKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

export interface Condition {
  label: string;
  kind: SkyKind;
}

/** Коды погоды WMO, которыми отвечает Open-Meteo. */
export function conditionOf(code: number): Condition {
  if (code === 0) return { label: 'Ясно', kind: 'clear' };
  if (code === 1) return { label: 'Малооблачно', kind: 'clear' };
  if (code === 2) return { label: 'Переменная облачность', kind: 'partly' };
  if (code === 3) return { label: 'Пасмурно', kind: 'cloudy' };
  if (code === 45 || code === 48) return { label: 'Туман', kind: 'fog' };
  if (code >= 51 && code <= 55) return { label: 'Морось', kind: 'drizzle' };
  if (code === 56 || code === 57) return { label: 'Ледяная морось', kind: 'drizzle' };
  if (code === 61) return { label: 'Небольшой дождь', kind: 'rain' };
  if (code === 63) return { label: 'Дождь', kind: 'rain' };
  if (code === 65) return { label: 'Сильный дождь', kind: 'rain' };
  if (code === 66 || code === 67) return { label: 'Ледяной дождь', kind: 'rain' };
  if (code === 71) return { label: 'Небольшой снег', kind: 'snow' };
  if (code === 73) return { label: 'Снег', kind: 'snow' };
  if (code === 75) return { label: 'Сильный снег', kind: 'snow' };
  if (code === 77) return { label: 'Снежная крупа', kind: 'snow' };
  if (code >= 80 && code <= 82) return { label: 'Ливень', kind: 'rain' };
  if (code === 85 || code === 86) return { label: 'Снегопад', kind: 'snow' };
  if (code === 95) return { label: 'Гроза', kind: 'storm' };
  if (code === 96 || code === 99) return { label: 'Гроза с градом', kind: 'storm' };
  return { label: 'Нет данных', kind: 'cloudy' };
}

/** Фон главной карточки: день/ночь и погода. Белый текст на всех фонах читается (тёмные оттенки). */
export function skyGradient(kind: SkyKind, isDay: boolean): string {
  if (!isDay) return kind === 'clear' || kind === 'partly' ? 'from-indigo-800 to-slate-950' : 'from-slate-700 to-slate-950';
  switch (kind) {
    case 'clear':
      return 'from-sky-600 to-blue-800';
    case 'partly':
      return 'from-sky-700 to-slate-700';
    case 'cloudy':
    case 'fog':
      return 'from-slate-500 to-slate-700';
    case 'drizzle':
    case 'rain':
      return 'from-slate-600 to-blue-900';
    case 'snow':
      return 'from-sky-700 to-slate-700';
    case 'storm':
      return 'from-slate-700 to-purple-950';
  }
}

/** Температура со знаком: «+23°», «−5°», «0°». */
export function formatTemp(t: number): string {
  const r = Math.round(t);
  if (r === 0 || Object.is(r, -0)) return '0°';
  return `${r > 0 ? '+' : '−'}${Math.abs(r)}°`;
}
