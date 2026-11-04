import { useEffect } from 'react';
import { MORE_PATH, MORE_TITLE, SECTIONS } from '@/app/sections';
import { isInSection } from './nav';

/**
 * Заголовок вкладки по разделам: «Кошельки — Sumoima», на «Главной» и на незнакомом адресе — общий. Скринридер читает заголовок
 * страницы первым, в истории и списке вкладок по нему различают разделы (в приложении без этого везде одно «Sumoima»).
 * Название раздела — одно на всё приложение (реестр src/app/sections.ts), здесь его только берут.
 */

/** Общий заголовок: ровно тот, что в index.html (проверяет documentTitle.test.tsx). */
export const APP_TITLE = 'Sumoima — учёт денег';
const APP_NAME = 'Sumoima';

/**
 * Заголовок страницы по адресу. Вложенные страницы (/wallets/<id>, /debts/people/…) берут название своего раздела.
 * Адрес приходит и из состояния истории браузера, которое могло испортиться (старая версия приложения, дубль вкладки):
 * не строка — не повод падать, берём общий заголовок.
 */
export function titleFor(pathname: unknown): string {
  if (typeof pathname !== 'string') return APP_TITLE;
  if (isInSection(pathname, MORE_PATH)) return `${MORE_TITLE} — ${APP_NAME}`;
  const section = SECTIONS.find((s) => s.path !== '/' && isInSection(pathname, s.path));
  return section ? `${section.title} — ${APP_NAME}` : APP_TITLE;
}

/**
 * Ставит заголовок вкладки под адрес страницы. Вызывать с адресом ПОД шитом (/add и /edit/… заголовок не меняют).
 * Когда приложение уходит с экрана (выход из аккаунта), возвращает общий заголовок для экрана входа.
 */
export function useDocumentTitle(pathname: unknown): void {
  const title = titleFor(pathname);
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(
    () => () => {
      document.title = APP_TITLE;
    },
    [],
  );
}
