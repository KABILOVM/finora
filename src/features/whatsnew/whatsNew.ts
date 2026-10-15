import type { Release } from './releases';

/** Сколько версий показываем за раз, если человек пропустил несколько обновлений. */
export const MAX_RELEASES_SHOWN = 3;

/**
 * Что показать в окне «Что нового» (чистая функция). releases — от новых к старым; current — версия приложения;
 * lastSeen — версия, для которой окно уже показывали (null — ещё не показывали ни разу); existingUser — человек уже пользовался
 * приложением (есть операции): у него отсутствие отметки означает «обновился с версии, где окна не было», у нового — «только установил».
 *  — версия не менялась, у текущей версии нет записи или версия ниже просмотренной → ничего;
 *  — отметки нет: существующему показываем запись текущей версии, новому — ничего (ему не про что «нового»);
 *  — прошлая версия неизвестна списку (очень старая) → только запись текущей;
 *  — иначе записи всех версий между просмотренной и текущей, не больше MAX_RELEASES_SHOWN, новые первыми.
 */
export function releasesToShow(releases: readonly Release[], current: string, lastSeen: string | null, existingUser: boolean): Release[] {
  if (lastSeen === current) return [];
  const now = releases.findIndex((r) => r.version === current);
  if (now === -1) return [];
  if (lastSeen === null) return existingUser ? [releases[now]!] : [];
  const seen = releases.findIndex((r) => r.version === lastSeen);
  if (seen === -1) return [releases[now]!];
  if (seen < now) return []; // просмотренная версия новее текущей: откат, показывать нечего
  return releases.slice(now, seen).slice(0, MAX_RELEASES_SHOWN);
}
