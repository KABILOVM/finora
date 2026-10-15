/** Как отправить напоминание о долге: системное «Поделиться», Telegram, WhatsApp или копирование. Сами ничего не отправляем: человек нажимает сам. */

export const whatsappUrl = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`;
/** У t.me/share/url параметр url обязателен, поэтому передаём пробел: в сообщение попадает только text. */
export const telegramUrl = (text: string): string => `https://t.me/share/url?url=%20&text=${encodeURIComponent(text)}`;

export const canNativeShare = (): boolean => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export type ShareResult = 'shared' | 'cancelled' | 'failed';

/** Системное окно «Поделиться». «cancelled» — человек закрыл окно сам (это не ошибка). */
export async function nativeShare(text: string): Promise<ShareResult> {
  if (!canNativeShare()) return 'failed';
  try {
    await navigator.share({ text });
    return 'shared';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
