import { useState } from 'react';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';

export const INSTALL_HINT_KEY = 'finora.installHint.dismissed';

/** Safari на iPhone/iPad (не Chrome/Firefox/Edge на iOS и не встроенные браузеры приложений). */
export function isIosSafari(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): boolean {
  const ua = nav.userAgent;
  // iPadOS 13+ притворяется Mac, но у него есть сенсорный экран.
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  if (!ios) return false;
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|FBAN|FBAV|Instagram|Line\/|YaBrowser/.test(ua);
  return /Safari\//.test(ua) && !otherBrowser;
}

/** Запущено как установленное приложение (с экрана «Домой»). */
export function isStandalone(): boolean {
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_HINT_KEY) === '1';
  } catch {
    return false; // хранилище недоступно (приватный режим) — просто покажем подсказку
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(INSTALL_HINT_KEY, '1');
  } catch {
    /* не страшно: подсказка скроется до перезагрузки */
  }
}

/**
 * Подсказка «как установить» для Safari на iPhone: ОДНА строка и крестик (не занимает пол-экрана).
 * Сама решает, показываться ли (только iPhone/iPad Safari, не из «Домой», не закрытая раньше);
 * на какой странице её показывать, решает вызывающий — сейчас только «Главная».
 */
export function InstallHint({ className }: { className?: string }) {
  const [visible, setVisible] = useState(() => isIosSafari() && !isStandalone() && !readDismissed());
  if (!visible) return null;
  return (
    <div
      role="note"
      className={cn(
        'flex min-h-[44px] items-center gap-1 rounded-xl border border-border bg-surface pl-3 text-[13px] leading-tight shadow-card',
        className,
      )}
    >
      <p className="min-w-0 flex-1 py-1.5">
        <span className="font-semibold text-brand">Установка:</span> Поделиться → На экран Домой
      </p>
      <IconButton
        icon="close"
        label="Закрыть подсказку"
        iconSize={18}
        onClick={() => {
          writeDismissed();
          setVisible(false);
        }}
      />
    </div>
  );
}
