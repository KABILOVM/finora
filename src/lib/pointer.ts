/**
 * Телефон и клавиатура. На телефоне экранная клавиатура занимает полэкрана, поэтому она должна открываться только тогда, когда человек сам
 * нажал на поле: окно или экран, который открылся с готовым курсором в поле «Название», выглядит сломанным (всё закрыто клавиатурой).
 * На компьютере физическая клавиатура ничего не закрывает — курсор в первом поле удобен, там его ставим сразу.
 */

/** Основной указатель — палец (телефон, планшет). */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** Можно ли самим ставить курсор в текстовое поле (при открытии окна, экрана, шага): на телефоне — нет, поле открывается нажатием. */
export const canAutoFocusText = (): boolean => !isCoarsePointer();

// поля, в которые вводят текст (у остальных — флажки, ползунки, выбор даты — клавиатуры нет)
const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'number', 'password']);

/** Откроет ли фокус на этом элементе экранную клавиатуру: текстовое поле, не «только чтение» и не с inputmode="none" (там своя цифровая клавиатура). */
export function opensKeyboard(el: Element | null): boolean {
  if (el === null) return false;
  if (el.getAttribute('inputmode') === 'none') return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) return !el.readOnly && TEXT_TYPES.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable === true;
}
