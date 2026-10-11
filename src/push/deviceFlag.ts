/**
 * Отметка «на ЭТОМ устройстве человек выключил напоминания». Настройка enabled в базе общая на аккаунт, а выключить можно
 * на одном устройстве: без отметки сторож (PushKeeper) через несколько минут сам подписал бы устройство обратно,
 * потому что на других устройствах напоминания остаются включёнными. Отметка своя у каждого пользователя на этом устройстве
 * и снимается кнопкой «Включить». Хранилище недоступно (приватный режим) — отметки нет, сторож ведёт себя как обычно.
 */

const keyOf = (userId: string): string => `finora:push:off:${userId}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function isDeviceOptedOut(userId: string): boolean {
  try {
    return storage()?.getItem(keyOf(userId)) === '1';
  } catch {
    return false;
  }
}

export function setDeviceOptedOut(userId: string, off: boolean): void {
  try {
    const s = storage();
    if (!s) return;
    if (off) s.setItem(keyOf(userId), '1');
    else s.removeItem(keyOf(userId));
  } catch {
    /* не страшно: сторож просто не узнает про отказ */
  }
}
