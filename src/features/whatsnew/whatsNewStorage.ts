/** Для какой версии окно «Что нового» уже показывали: на этом устройстве и для этого человека (localStorage). */
const key = (userId: string): string => `finora:whatsnew:${userId}`;
/** Если localStorage недоступен (читать или писать нельзя): помним до перезагрузки страницы, иначе окно показывалось бы при каждом входе. */
const memory = new Map<string, string>();

export function readSeenVersion(userId: string): string | null {
  try {
    const v = window.localStorage.getItem(key(userId));
    return v === null || v === '' ? null : v;
  } catch {
    return memory.get(userId) ?? null;
  }
}

export function writeSeenVersion(userId: string, version: string): void {
  memory.set(userId, version);
  try {
    window.localStorage.setItem(key(userId), version);
  } catch {
    // хранилище недоступно (приватный режим, переполнено): действует значение в памяти
  }
}
