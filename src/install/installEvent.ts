import { rememberInstalled } from './frequency';

/** Событие Chrome/Edge/Samsung Internet: нужно успеть поймать его рано и вызвать prompt() из нажатия. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let started = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Слушатели ставятся один раз при старте страницы (main.tsx), до появления окна. */
export function startInstallCapture(win: Window = window): void {
  if (started) return;
  started = true;
  win.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // свою мини-панель браузер не рисует — предложим сами, в удобный момент
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  win.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    rememberInstalled();
    notify();
  });
}

export const getDeferredPrompt = (): BeforeInstallPromptEvent | null => deferred;
export const wasInstalledThisSession = (): boolean => installed;

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Показать системное окно установки. Событие одноразовое — после вызова забываем его. */
export async function runNativePrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const ev = deferred;
  if (!ev) return 'unavailable';
  deferred = null;
  notify();
  try {
    await ev.prompt();
    return (await ev.userChoice).outcome;
  } catch {
    return 'dismissed';
  }
}

/** Только для тестов. */
export function __resetInstallCapture(): void {
  deferred = null;
  installed = false;
  listeners.clear();
  started = false;
}
/** Только для тестов: подложить событие. */
export function __setDeferred(ev: BeforeInstallPromptEvent | null): void {
  deferred = ev;
  notify();
}
