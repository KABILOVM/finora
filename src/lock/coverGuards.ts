/**
 * Защиты заслонки от того, что остаётся ПОД ней. Приложение под закрытой заслонкой не размонтируется (синхронизация идёт),
 * поэтому открытое окно с набранной суммой там ещё живо и слушает клавиатуру и кнопку «назад». Заслонка обязана перехватить
 * это раньше окна, иначе окно закроется «вслепую», а несохранённый ввод пропадёт:
 *  - Esc и Tab ловит общий обработчик окон (слушает весь document) раньше заслонки: Esc закрыл бы окно, а Tab «проглотила бы»
 *    его ловушка фокуса (она пытается сфокусировать элемент в недоступном окне, браузер этого не делает, а Tab уже отменён);
 *  - «назад» (жест Android, кнопка браузера) меняет адрес, и окно по адресу (/add, /edit/…) закрывается;
 *  - окно, появившееся под заслонкой (по ссылке), может забрать фокус до того, как оно станет недоступным.
 * Ничего здесь не читает и не пишет данные приложения.
 */

// Только то, до чего доходит Tab: элементы с tabindex="-1" не считаются (иначе «последним» окажется то, на что Tab не попадает).
const FOCUSABLE = ['button:not([disabled])', 'a[href]', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]']
  .map((s) => `${s}:not([tabindex="-1"])`)
  .join(', ');

/** Элементы заслонки, до которых доходит Tab, в порядке на странице. */
export function coverFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('hidden'));
}

/**
 * Куда уйдёт фокус по Tab (backwards — по Shift+Tab), не выходя за заслонку: по кругу. Если фокус сейчас не на её кнопках
 * (на самой заслонке, на странице, потерян) — на первую (назад — на последнюю). null — фокусировать нечего.
 */
export function nextFocusTarget(items: readonly HTMLElement[], active: Element | null, backwards: boolean): HTMLElement | null {
  const last = items.length - 1;
  if (last < 0) return null;
  const at = active === null ? -1 : items.indexOf(active as HTMLElement);
  if (at < 0) return items[backwards ? last : 0] ?? null;
  const next = backwards ? at - 1 : at + 1;
  return items[next < 0 ? last : next > last ? 0 : next] ?? null;
}

interface NavigateEventLike extends Event {
  navigationType?: string;
  userInitiated?: boolean;
  destination?: { sameDocument?: boolean };
}
interface NavigationLike {
  addEventListener(type: 'navigate', listener: (e: NavigateEventLike) => void): void;
  removeEventListener(type: 'navigate', listener: (e: NavigateEventLike) => void): void;
}

/**
 * Пока заслонка стоит, «назад»/«вперёд» от самого человека (жест, кнопка браузера) ничего не меняют: окно под заслонкой остаётся
 * как было. Переходы, которые делает само приложение (history.go из кода, ссылки), не трогаем: окно после сохранения закрывается
 * как обычно. Нужен Navigation API (Chromium, в том числе Chrome на Android); где его нет (например, часть версий Safari),
 * защиты нет — как и раньше. Если браузер не разрешает отменить переход (страница без нажатий), тоже ничего не делаем.
 * Возвращает функцию, которая снимает защиту.
 */
export function blockUserHistoryTraversal(): () => void {
  const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
  if (!nav || typeof nav.addEventListener !== 'function') return () => undefined;
  const onNavigate = (e: NavigateEventLike) => {
    if (e.navigationType !== 'traverse' || e.userInitiated !== true || !e.cancelable) return;
    // уход со страницы (на другой сайт) не держим: заслонка защищает то, что на этой странице
    if (e.destination?.sameDocument !== true) return;
    e.preventDefault();
  };
  nav.addEventListener('navigate', onNavigate);
  return () => nav.removeEventListener('navigate', onNavigate);
}

export interface CoverGuardHandlers {
  /** Нажали Esc: заслонку он не снимает никогда; может только закрыть вопрос «Выйти?». */
  onEscape(): void;
  /** Вернуть фокус на кнопку заслонки (фокус ушёл на окно под ней или потерялся). */
  focusPrimary(): void;
}

/**
 * Включает защиты заслонки `root` (клавиатура, фокус, «назад»). Возвращает функцию, которая всё снимает.
 * Слушатель клавиатуры стоит на window в фазе перехвата: он первый на пути события, раньше любого обработчика на document.
 */
export function installCoverGuards(root: HTMLElement, handlers: CoverGuardHandlers): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation(); // окно под заслонкой Esc не получает
      handlers.onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    e.stopImmediatePropagation(); // ловушка фокуса окна под заслонкой Tab не получает
    if (e.ctrlKey || e.altKey || e.metaKey) return; // сочетания браузера (вкладки) — не наше дело
    e.preventDefault();
    const target = nextFocusTarget(coverFocusables(root), document.activeElement, e.shiftKey) ?? root;
    target.focus({ preventScroll: true });
  };

  const onFocusIn = (e: FocusEvent) => {
    if (!(e.target instanceof Node) || !root.contains(e.target)) handlers.focusPrimary();
  };

  // Окно, ставшее недоступным вместе с фокусом, оставляет фокус «ни на чём» (body): забираем обратно, как только это произошло.
  const onFocusOut = (e: FocusEvent) => {
    if (e.relatedTarget !== null) return; // фокус перешёл на другой элемент — его поймает focusin
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!root.contains(document.activeElement)) handlers.focusPrimary();
    }, 0);
  };

  window.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  const unblockHistory = blockUserHistoryTraversal();

  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    unblockHistory();
    if (timer !== null) clearTimeout(timer);
  };
}
