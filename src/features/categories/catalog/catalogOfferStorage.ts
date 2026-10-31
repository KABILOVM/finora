/**
 * Предлагали ли человеку готовые категории: на этом устройстве и для этого человека (localStorage). Предложение показывается один раз
 * после обновления; новому человеку оно не нужно (его ведёт мастер первой настройки), поэтому мастер тоже ставит отметку.
 */
const key = (userId: string): string => `finora:catalog-offer:v1:${userId}`;
/** Если localStorage недоступен: помним до перезагрузки страницы, иначе окно показывалось бы при каждом входе. */
const memory = new Set<string>();

export function wasCatalogOffered(userId: string): boolean {
  if (memory.has(userId)) return true;
  try {
    return window.localStorage.getItem(key(userId)) !== null;
  } catch {
    return false;
  }
}

export function markCatalogOffered(userId: string): void {
  memory.add(userId);
  try {
    window.localStorage.setItem(key(userId), '1');
  } catch {
    // хранилище недоступно (приватный режим, переполнено): действует отметка в памяти
  }
}

/** Только для тестов. */
export function __resetCatalogOfferMemory(): void {
  memory.clear();
}
