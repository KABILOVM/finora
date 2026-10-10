export const MIN_PASSWORD_LENGTH = 8;

/** Проверка нового пароля при смене. Возвращает текст ошибки по-русски или null, если всё хорошо. */
export function checkNewPassword(password: string, repeat: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`;
  if (password.trim() === '') return 'Пароль не может состоять из одних пробелов';
  if (password !== repeat) return 'Пароли не совпадают';
  return null;
}
