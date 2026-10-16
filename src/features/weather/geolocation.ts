import { cityId, type City } from './api';

/** Подпись места, найденного по геолокации: обратного геокодера у нас нет, поэтому города не называем — это «вы здесь». */
export const HERE_NAME = 'Моё местоположение';

/**
 * Координаты округляются до 0,01° (около 1 км): для погоды этого достаточно, а в память и в синхронизацию не попадает точный адрес.
 * Ноль со знаком не оставляем (−0 → 0), чтобы идентификатор места не раздваивался.
 */
export function roundCoord(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

/** Место «я здесь» из координат устройства. null — координаты не настоящие (NaN, вне диапазона). */
export function cityFromCoords(lat: number, lon: number): City | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const la = roundCoord(lat);
  const lo = roundCoord(lon);
  return { id: cityId(la, lo), name: HERE_NAME, region: '', lat: la, lon: lo, here: true };
}

export class LocateError extends Error {}

const TIMEOUT_MS = 10_000;
/** Подойдёт и недавнее положение: погоде не нужна точность до метра. */
const MAX_AGE_MS = 10 * 60 * 1000;

function reason(error: GeolocationPositionError): string {
  if (error.code === 1) return 'Доступ к местоположению не разрешён. Разрешите его в настройках браузера или выберите город вручную';
  if (error.code === 3) return 'Местоположение определялось слишком долго. Попробуйте ещё раз или выберите город вручную';
  return 'Не удалось определить местоположение. Попробуйте ещё раз или выберите город вручную';
}

/**
 * Спрашивает у устройства, где оно. Вызывать ТОЛЬКО по нажатию человека (иначе браузер вправе не показать запрос, а нам не нужно
 * следить без спроса). Ошибки — понятным русским текстом в LocateError.
 */
export function locate(geo: Pick<Geolocation, 'getCurrentPosition'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.geolocation): Promise<City> {
  return new Promise((resolve, reject) => {
    if (!geo) {
      reject(new LocateError('Это устройство не умеет определять местоположение. Выберите город вручную'));
      return;
    }
    geo.getCurrentPosition(
      (pos) => {
        const city = cityFromCoords(pos.coords.latitude, pos.coords.longitude);
        if (city) resolve(city);
        else reject(new LocateError('Устройство вернуло непонятное местоположение. Выберите город вручную'));
      },
      (err) => reject(new LocateError(reason(err))),
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    );
  });
}
