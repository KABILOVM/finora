import { Component, createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './Button';

/** Как часто искать новую версию в приложении, которое не закрывали (таймер; на телефоне он спит в фоне). */
const UPDATE_CHECK_EVERY_MS = 60 * 60 * 1000;
/** Возвраты в приложение (экран включили, сеть появилась) проверяют не чаще, чем раз в это время. */
const MIN_GAP_MS = 30_000;
/** Если после команды «обновиться» страница сама не перезагрузилась за это время, перезагружаем её вручную (см. update()). */
const RELOAD_FALLBACK_MS = 5000;
/** Сверка «код страницы — кэш воркера» ещё раз спустя это время: воркер чистит старый кэш не мгновенно. */
const SKEW_RECHECK_MS = 3000;
/** Пока в другой вкладке применили обновление, а здесь идёт ввод — раз в сколько мс смотрим, закончился ли он. */
const IDLE_POLL_MS = 1000;
/** Сколько раз за минуту страница сама перезагружается из-за расхождения версий; дальше — стоп, чтобы не зациклиться. */
const SKEW_RELOADS_PER_MINUTE = 2;
const SKEW_KEY = 'finora.update.skewReloads';

/** Спросить у браузера, нет ли новой версии sw.js. Браузер сам делает это только при загрузке страницы. */
async function checkForUpdate(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (navigator.onLine === false) return;
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  } catch {
    // Нет сети или воркер как раз ставится — проверим при следующем возврате в приложение.
  }
}

/**
 * Человек сейчас что-то вводит: открыто окно (шит, подтверждение) или курсор стоит в поле.
 * Перезагрузка в этот момент стёрла бы набранное, поэтому сама страница в таком состоянии не перезагружается.
 */
function userIsBusy(): boolean {
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

/**
 * Приложение показывает экран «всё сломалось» на весь экран (ErrorBoundary, ошибка хранилища): это role="alert"
 * прямо в корне страницы. Или упал один раздел, а меню осталось (layout/SectionBoundary, метка data-section-error):
 * на месте страницы тоже терять нечего. Вложенные role="alert" (ошибки полей, уведомления) сюда не попадают.
 */
function fatalScreenShown(): boolean {
  return document.querySelector('#root > [role="alert"], [data-section-error]') !== null;
}

/**
 * Страница собрана из одной версии, а управляет ею уже воркер другой: файла самой страницы нет ни в одном кэше.
 * Так бывает, если воркер поменялся ровно в момент загрузки страницы (событие смены мы бы пропустили). Дальше такая
 * страница рано или поздно не найдёт нужный кусок кода, поэтому её надо перезагрузить.
 */
async function pageCodeIsStale(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined' || !navigator.serviceWorker?.controller) return false;
    return (await caches.match(import.meta.url, { ignoreSearch: true })) === undefined;
  } catch {
    return false; // кэш недоступен (приватный режим) — судить не по чему
  }
}

/** Не даёт зациклиться: не больше SKEW_RELOADS_PER_MINUTE перезагрузок за минуту в этой вкладке. */
function skewReloadAllowed(): boolean {
  try {
    const now = Date.now();
    const recent = (JSON.parse(sessionStorage.getItem(SKEW_KEY) ?? '[]') as number[]).filter((t) => now - t < 60_000);
    if (recent.length >= SKEW_RELOADS_PER_MINUTE) return false;
    sessionStorage.setItem(SKEW_KEY, JSON.stringify([...recent, now]));
    return true;
  } catch {
    return false; // не можем посчитать — лучше не перезагружать
  }
}

/**
 * Оболочка подсказки об обновлении. Стоит ВНЕ ErrorBoundary приложения (см. main.tsx): если выпущенная версия
 * падает при отрисовке, подсказка и регистрация воркера живут дальше и исправленная версия всё равно приходит.
 * Копия <UpdatePrompt /> внутри App при этом молчит — подсказка одна.
 */
const HostContext = createContext(false);

/** Если сама подсказка сломается, приложение это не заденет. */
class SilentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('Подсказка об обновлении сломалась:', error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function UpdatePromptHost({ children }: { children: ReactNode }) {
  return (
    <HostContext.Provider value>
      {children}
      <SilentBoundary>
        <UpdateBanner />
      </SilentBoundary>
    </HostContext.Provider>
  );
}

/**
 * Новая версия приложения скачана и ждёт. Применяется ТОЛЬКО после нажатия «Обновить»
 * (registerType: 'prompt' в vite.config.ts) — чтобы страница не перезагрузилась посреди ввода операции.
 * Исключения, когда ввода терять нечего или человек уже решил сам:
 *  — приложение показывает экран «Что-то пошло не так» (или «Раздел не загрузился»): исправленная версия ставится сама;
 *  — «Обновить» нажали в другой вкладке: эта вкладка перезагрузится, как только в ней закончится ввод.
 * Новую версию подсказка ищет и сама: раз в час и при каждом возврате в приложение.
 */
export function UpdatePrompt() {
  return useContext(HostContext) ? null : <UpdateBanner />;
}

function UpdateBanner() {
  const [waitingSeen, setWaitingSeen] = useState(false);
  const [stale, setStale] = useState(false);
  const [fatal, setFatal] = useState(false);
  const [busy, setBusy] = useState(false);
  const fallbackTimer = useRef<number>();
  const decided = useRef(false); // «Обновить» нажато здесь (или применено автоматически): перезагрузка нужна без оговорок
  const reloadDecision = useRef<() => void>(() => {});

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (e) => console.error('Не удалось зарегистрировать service worker:', e),
    onNeedRefresh: () => setWaitingSeen(true),
    // Новый воркер взял управление. Решаем сами, перезагружаться ли (по умолчанию перезагрузка шла всегда).
    onNeedReload: () => reloadDecision.current(),
  });
  const updateReady = needRefresh || waitingSeen;

  reloadDecision.current = () => {
    if (decided.current || fatalScreenShown() || !userIsBusy()) window.location.reload();
    else setStale(true);
  };

  // Поиск новой версии в долго открытой вкладке: по таймеру и при возврате в приложение.
  useEffect(() => {
    let last = -Infinity;
    const run = (always: boolean) => {
      const now = Date.now();
      if (!always && now - last < MIN_GAP_MS) return;
      last = now;
      void checkForUpdate();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') run(false);
    };
    const onBack = () => run(false);
    const timer = window.setInterval(() => run(true), UPDATE_CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, []);

  // Воркер сменился под открытой страницей (новая версия взяла управление). Обычно об этом сообщает workbox, но он
  // знает только про воркеры, которые «ждали» уже при открытии этой страницы; здесь слушаем сам браузер, чтобы
  // страница со старым кодом не осталась жить на новом воркере (в его кэше старых файлов уже нет).
  useEffect(() => {
    const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!container?.controller) return; // первая установка: версии менять не с чего
    const onChange = () => reloadDecision.current();
    container.addEventListener('controllerchange', onChange);
    return () => container.removeEventListener('controllerchange', onChange);
  }, []);

  // Страница и воркер могли разойтись по версиям ещё до того, как мы начали слушать (см. pageCodeIsStale).
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      void pageCodeIsStale().then((isStale) => {
        if (isStale && !cancelled && skewReloadAllowed()) reloadDecision.current();
      });
    check();
    const timer = window.setTimeout(check, SKEW_RECHECK_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Видим экран «всё сломалось»?
  useEffect(() => {
    const root = document.getElementById('root');
    const sync = () => setFatal(fatalScreenShown());
    sync();
    if (!root || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(sync);
    // subtree: карточка упавшего раздела появляется глубоко внутри каркаса, а не в самом корне
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const update = async () => {
    decided.current = true;
    setBusy(true);
    try {
      await updateServiceWorker(true);
      // Обычно страница перезагружается сама, как только новый воркер берёт управление (около секунды). Но бывает,
      // что браузер застревает на полпути (например, страница как раз запросила иконку, пока воркер менялся): команда
      // принята, а управление не передано. Повторные команды не помогают, обычная перезагрузка — добивает.
      fallbackTimer.current = window.setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS);
    } catch (e) {
      console.error('Не удалось обновить приложение:', e);
      decided.current = false;
      setBusy(false);
    }
  };

  // Приложение сломано, а исправление уже скачано (даже если нажали «Позже»): терять на этом экране нечего.
  useEffect(() => {
    if (updateReady && fatal && !decided.current && !userIsBusy()) void update();
  }, [updateReady, fatal]);

  useEffect(() => () => window.clearTimeout(fallbackTimer.current), []);

  // Обновление применили в другой вкладке, а здесь шёл ввод: перезагружаемся, как только он закончился.
  useEffect(() => {
    if (!stale) return;
    const timer = window.setInterval(() => {
      if (!userIsBusy()) window.location.reload();
    }, IDLE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [stale]);

  const boxClass =
    'fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[55] mx-auto flex max-w-md animate-pop-in items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-float';

  if (stale) {
    return (
      <div role="status" className={boxClass}>
        <div className="min-w-0 flex-1 pl-1">
          <p className="font-semibold">Приложение обновлено</p>
          <p className="text-sm text-muted">Закончите ввод — страница перезагрузится сама. Записи не потеряются.</p>
        </div>
        <Button onClick={() => window.location.reload()}>Перезагрузить</Button>
      </div>
    );
  }

  if (!needRefresh) return null;

  return (
    <div role="status" className={boxClass}>
      <div className="min-w-0 flex-1 pl-1">
        <p className="font-semibold">Доступна новая версия</p>
        <p className="text-sm text-muted">Приложение перезагрузится, записи не потеряются.</p>
      </div>
      <Button variant="ghost" onClick={() => setNeedRefresh(false)} disabled={busy}>
        Позже
      </Button>
      <Button onClick={update} loading={busy}>
        Обновить
      </Button>
    </div>
  );
}
