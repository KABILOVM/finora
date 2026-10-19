/**
 * Окна и кнопка «Назад». Пока открыто окно (Sheet), жест «Назад» на телефоне и кнопка браузера должны закрыть окно, а не
 * увести со страницы (и не потерять набранное). Для этого на всю стопку окон заводится ОДНА запись в истории браузера
 * («якорь»): «Назад» убирает её, мы закрываем верхнее окно и, если окна остались, ставим якорь заново. Когда окна закрыли
 * иначе (×, Esc, «Сохранить»), якорь снимается одним history.back().
 *
 * Якорь — копия состояния роутера (idx и key те же) с пометкой FLAG: роутер, увидев «Назад» на такую запись, остаётся на той
 * же странице. Окна, которые сами живут в адресе (/add, /edit/:id), якорь не заводят (history: false): их «Назад» — это
 * переход по адресу, и закрывает их сам роутер.
 *
 * Выключатель: MODAL_HISTORY = false возвращает прежнее поведение (окна историю не трогают).
 */
export const MODAL_HISTORY = true;

const FLAG = '__sumoimaModal';
/** Номер нашего текущего якоря: запись с пометкой другого номера (осталась от перезагрузки, снятого якоря) — не наша. */
let anchorId = '';
let seq = 0;

interface User {
  /** Закрыть окно по «Назад» (то же, что ×: окно с несохранённым вводом спросит подтверждение). */
  close: () => void;
}

const users: User[] = [];
/** Наша запись сейчас лежит в истории поверх страницы. */
let anchored = false;
/** Сколько своих history.back() ещё не дошло до popstate: их popstate — не «Назад» от человека. */
let unwinding = 0;
let listening = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let unwindTimer: ReturnType<typeof setTimeout> | null = null;
/** Что сделать, когда наш back() дойдёт (dropModalAnchor). */
let afterUnwind: (() => void) | null = null;
/**
 * Пока код уходит по истории сам (navigate после dropModalAnchor), новый якорь не ставим: окно, которое роутер ещё не убрал,
 * поставило бы запись поперёк этого перехода. Снимается popstate перехода или через HOLD_MS.
 */
let holding = false;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
const HOLD_MS = 600;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const onAnchor = (): boolean => anchorId !== '' && isObject(window.history.state) && window.history.state[FLAG] === anchorId;

/** Привести историю в соответствие с окнами: есть окна — есть якорь, нет окон — якоря нет. */
function sync(): void {
  if (unwinding > 0 || holding) return; // дождёмся popstate от своего back() и от перехода кода: до них положение в истории не определено
  if (users.length > 0 && !anchored) {
    const state = window.history.state;
    anchorId = `${Date.now()}-${++seq}`;
    window.history.pushState({ ...(isObject(state) ? state : {}), [FLAG]: anchorId }, '');
    anchored = true;
  } else if (users.length === 0 && anchored) {
    anchored = false;
    // Якорь мог уйти из-под нас: окно закрыли переходом (navigate), и роутер записал свою запись поверх или вместо якоря.
    // Тогда back() увёл бы человека со страницы, куда он только что перешёл; оставляем запись как есть.
    if (!onAnchor()) return;
    unwind();
  }
}

/** Снять якорь: один свой history.back(). Его popstate — не «Назад» от человека (см. onPopState). */
function unwind(): void {
  unwinding++;
  window.history.back();
  if (unwindTimer !== null) clearTimeout(unwindTimer);
  // popstate не пришёл (браузер отменил переход): не ждём вечно
  unwindTimer = setTimeout(() => {
    unwindTimer = null;
    if (unwinding > 0) {
      unwinding = 0;
      finishUnwind();
    }
  }, 1500);
}

function finishUnwind(): void {
  const then = afterUnwind;
  afterUnwind = null;
  if (!then) {
    syncSoon(); // окна, открытые за это время, ждали своей записи; React к этому моменту уже убрал закрытые
    return;
  }
  hold();
  then();
}

function hold(): void {
  holding = true;
  if (holdTimer !== null) clearTimeout(holdTimer);
  holdTimer = setTimeout(release, HOLD_MS);
}

function release(): void {
  holding = false;
  if (holdTimer !== null) clearTimeout(holdTimer);
  holdTimer = null;
  syncSoon();
}

/** Не сразу: закрытие окна и открытие другого в одном обновлении (StrictMode, смена шага) не должны ходить по истории туда-сюда. */
function syncSoon(): void {
  if (syncTimer !== null) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    sync();
  }, 0);
}

function onPopState(): void {
  if (unwinding > 0) {
    unwinding--;
    if (unwinding === 0) {
      if (unwindTimer !== null) clearTimeout(unwindTimer);
      unwindTimer = null;
      finishUnwind();
    }
    return;
  }
  if (holding) release(); // дошёл переход, ради которого держали паузу
  // «Назад» от человека: наша запись ушла. Если мы оказались ЕЁ копией (вперёд/назад по чужим записям), окно не трогаем.
  if (!anchored || onAnchor()) return;
  anchored = false;
  users[users.length - 1]?.close();
  syncSoon(); // окно осталось (спросило подтверждение, идёт сохранение) — якорь нужен снова; закрылось — ничего не делаем
}

/** Окно открылось. Возвращает функцию «окно закрылось». */
export function enterModalHistory(close: () => void): () => void {
  if (!MODAL_HISTORY || typeof window === 'undefined') return () => undefined;
  if (!listening) {
    window.addEventListener('popstate', onPopState);
    listening = true;
  }
  const user: User = { close };
  users.push(user);
  sync();
  return () => {
    const i = users.indexOf(user);
    if (i >= 0) users.splice(i, 1);
    syncSoon();
  };
}

/**
 * Перед переходом по истории из кода (закрытие окна-адреса: navigate(-1)) убрать якорь окон, иначе шаг назад съест якорь, а не
 * запись окна. Когда якорь снят (или уже снимается), вызовет `then`; true — вызов отложен до этого момента, false — якоря нет
 * и вызывать `then` нужно самому сразу.
 */
export function dropModalAnchor(then: () => void): boolean {
  if (unwinding > 0) {
    afterUnwind = then;
    return true;
  }
  if (!anchored || !onAnchor()) return false;
  anchored = false;
  afterUnwind = then;
  unwind();
  return true;
}

/** dropModalAnchor, а если якоря нет — сразу `then`. Для переходов из кода, которые могут случиться при открытом окне. */
export function runWithoutModalAnchor(then: () => void): void {
  if (!dropModalAnchor(then)) then();
}

/** Для тестов: забыть всё, что накопили предыдущие тесты. */
export function resetModalHistoryForTests(): void {
  users.length = 0;
  anchored = false;
  anchorId = '';
  unwinding = 0;
  afterUnwind = null;
  holding = false;
  if (holdTimer !== null) clearTimeout(holdTimer);
  holdTimer = null;
  if (syncTimer !== null) clearTimeout(syncTimer);
  if (unwindTimer !== null) clearTimeout(unwindTimer);
  syncTimer = null;
  unwindTimer = null;
  if (listening) window.removeEventListener('popstate', onPopState);
  listening = false;
}
