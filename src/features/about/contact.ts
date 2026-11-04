/**
 * Контакт владельца для связи (вопросы по данным, просьба удалить аккаунт, сообщить об ошибке). Задаётся при сборке переменной
 * VITE_CONTACT: почта (`name@example.com`) или ссылка https (`https://t.me/name`). Адрес публичный: он показывается в окне
 * «Конфиденциальность и условия», в том числе на экране входа. Нет переменной или в ней что-то непонятное — контакта нет,
 * окно честно отсылает к тому, кто дал доступ к приложению (подставлять чужую почту «на всякий случай» нельзя).
 */

export interface Contact {
  /** Куда ведёт ссылка: `mailto:…` или https-адрес. */
  href: string;
  /** Что видно человеку: почта или адрес без `https://`. */
  label: string;
}

export interface ContactEnvLike {
  VITE_CONTACT?: unknown;
}

/** Почта без «?», «&», «#», «%» и пробелов: из неё нельзя дописать лишние поля в ссылку mailto (тему, копию). */
const EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Разбирает значение VITE_CONTACT. null — контакта нет (пусто или не похоже ни на почту, ни на https-ссылку). */
export function readContact(env: ContactEnvLike): Contact | null {
  const raw = typeof env.VITE_CONTACT === 'string' ? env.VITE_CONTACT.trim() : '';
  if (raw === '' || raw.length > 200) return null;
  if (EMAIL.test(raw)) return { href: `mailto:${raw}`, label: raw };
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return null;
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
    return { href: u.href, label: `${u.host}${path}` };
  } catch {
    return null;
  }
}

/** Контакт из сборки (import.meta.env). */
export function getContact(): Contact | null {
  return readContact(import.meta.env as ContactEnvLike);
}
