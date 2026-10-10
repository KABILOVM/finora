import type { IsoDateTime } from '@/domain/types';

/**
 * Монотонные часы устройства. Метка каждой правки СТРОГО больше предыдущей, даже если:
 *  - две правки в одну миллисекунду;
 *  - человек или система перевели часы назад;
 *  - приложение перезапустили (последняя метка сохраняется через save/load).
 * Без этого «последняя правка побеждает» могла бы отдать победу старой правке.
 */

export interface ClockOptions {
  /** Id устройства (для справки/диагностики; на порядок меток не влияет). */
  deviceId: string;
  /** Источник времени в миллисекундах; по умолчанию Date.now. */
  now?: () => number;
  /** Читает сохранённую последнюю метку (синхронно). null — ещё не было. */
  load: () => string | null | undefined;
  /**
   * Сохраняет последнюю метку. Вызывается при каждом tick/observe, пока метка растёт.
   * Ошибки сохранения не должны ломать запись данных — они глотаются.
   */
  save: (stamp: IsoDateTime) => unknown;
}

export interface Clock {
  readonly deviceId: string;
  /** Новая метка, строго большая всех выданных и «увиденных» ранее. */
  tick(): IsoDateTime;
  /**
   * Учесть метку, пришедшую извне (с сервера, из резервной копии, из другой вкладки):
   * следующие tick() будут больше неё. Метки из далёкого будущего (дальше MAX_OBSERVE_AHEAD_MS от наших часов)
   * и мусор отвергаются — часы нельзя «отравить». Возвращает false, если метку отвергли.
   * Предел шире серверных «now + 5 мин»: сервер зажимает метки по СВОИМ часам, а наши могут отставать —
   * иначе правка после просмотра чужой версии получила бы метку старше неё и тихо проиграла.
   * own=true — метка выдана этим же устройством (другая вкладка): ей верим без проверки на будущее.
   */
  observe(stamp: string, own?: boolean): boolean;
}

/** Насколько вперёд от «сейчас» сервер принимает метку без зажима (см. private.sync_guard в supabase/schema.sql). */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Насколько вперёд от НАШИХ часов мы ещё учитываем чужую метку: 5 минут сервера + запас на то, что наши часы
 * отстают от серверных (ручная установка времени, севшая батарейка). Дальше — мусор или «отравление».
 */
export const MAX_OBSERVE_AHEAD_MS = 30 * 60 * 1000;

const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function stampToMs(stamp: unknown): number | null {
  if (typeof stamp !== 'string' || !STAMP_RE.test(stamp)) return null;
  const ms = Date.parse(stamp);
  return Number.isNaN(ms) ? null : ms;
}

export function createClock(opts: ClockOptions): Clock {
  const now = opts.now ?? Date.now;
  let lastMs = -Infinity;
  try {
    const saved = stampToMs(opts.load());
    if (saved !== null) lastMs = saved;
  } catch {
    // нет сохранённой метки — начинаем с текущего времени
  }

  const persist = () => {
    try {
      const r = opts.save(new Date(lastMs).toISOString());
      if (r && typeof (r as PromiseLike<unknown>).then === 'function') {
        (r as PromiseLike<unknown>).then(undefined, () => undefined);
      }
    } catch {
      // сохранение метки не должно ломать запись
    }
  };

  const wall = (): number => {
    const t = now();
    return Number.isFinite(t) ? Math.floor(t) : 0;
  };

  return {
    deviceId: opts.deviceId,
    tick() {
      lastMs = Math.max(wall(), lastMs + 1);
      persist();
      return new Date(lastMs).toISOString();
    },
    observe(stamp, own = false) {
      const ms = stampToMs(stamp);
      if (ms === null || (!own && ms > wall() + MAX_OBSERVE_AHEAD_MS)) return false;
      if (ms > lastMs) {
        lastMs = ms;
        persist();
      }
      return true;
    },
  };
}
