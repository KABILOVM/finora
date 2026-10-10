import { isUuid } from '@/db';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Копия сделана в ДРУГОМ аккаунте? Блок настроек в копии подписан id владельца (id настроек = id пользователя),
 * и importBackup отвергает копию с чужим id. Так бывает и у своих же данных: аккаунт удалили и создали заново,
 * или данные вносили без облака (на устройстве один «локальный» пользователь), а потом подключили облако.
 * Если id не похож на UUID — это не «чужой аккаунт», а испорченный файл: решает сама проверка при загрузке.
 */
export function isForeignBackup(data: unknown, userId: string): boolean {
  if (!isRecord(data) || !isRecord(data['settings'])) return false;
  const id = data['settings']['id'];
  return isUuid(id) && id.toLowerCase() !== userId.toLowerCase();
}

/**
 * Копия без блока настроек: единственный способ по договору загрузить её в другой аккаунт (importBackup принимает такой файл).
 * Кошельки, категории и операции остаются как есть и проверяются целиком. Основная валюта и кошелёк по умолчанию
 * остаются теми, что в текущем аккаунте.
 */
export function withoutSettings(data: unknown): unknown {
  return isRecord(data) ? { ...data, settings: null } : data;
}
