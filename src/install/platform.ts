import { isIosSafari } from '@/components/InstallHint';

/**
 * Как предлагать установку:
 *  - 'native'     — браузер сам умеет (событие beforeinstallprompt): кнопка «Установить»;
 *  - 'ios-safari' — iPhone/iPad Safari: три шага «Поделиться → На экран Домой → Добавить»;
 *  - 'ios-other'  — iPhone/iPad, но не Safari (Chrome, Firefox…): попросить открыть ссылку в Safari;
 *  - 'none'       — не предлагаем (уже установлено, ПК, неизвестный браузер).
 */
export type InstallMode = 'native' | 'ios-safari' | 'ios-other' | 'none';

export interface InstallEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** Запущено из установленного приложения (display-mode: standalone или navigator.standalone). */
  standalone: boolean;
  /** Браузер уже прислал beforeinstallprompt, и событие у нас сохранено. */
  hasNativePrompt: boolean;
}

/** iPhone / iPad / iPod (iPadOS 13+ называет себя Mac, но у него есть сенсорный экран). */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** Телефон или планшет: iOS либо Android/«Mobile» в User-Agent. ПК с тачскрином сюда не попадает. */
export function isMobileDevice(userAgent: string, maxTouchPoints: number): boolean {
  return isIosDevice(userAgent, maxTouchPoints) || /Android|Mobile|Tablet/i.test(userAgent);
}

export function detectInstallMode(env: InstallEnv): InstallMode {
  if (env.standalone) return 'none';
  if (!isMobileDevice(env.userAgent, env.maxTouchPoints)) return 'none';
  if (isIosDevice(env.userAgent, env.maxTouchPoints)) {
    return isIosSafari({ userAgent: env.userAgent, maxTouchPoints: env.maxTouchPoints }) ? 'ios-safari' : 'ios-other';
  }
  return env.hasNativePrompt ? 'native' : 'none';
}
