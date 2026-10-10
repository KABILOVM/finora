import { useState } from 'react';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';
import { Icon } from './Icon';

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

/** Подсказка «как установить» для Safari на iPhone. Закрывается и больше не показывается. */
export function InstallHint({ className }: { className?: string }) {
  const [visible, setVisible] = useState(() => isIosSafari() && !isStandalone() && !readDismissed());
  if (!visible) return null;
  return (
    <div
      role="note"
      className={cn('flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card', className)}
    >
      <Icon name="download" size={24} className="mt-0.5 shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Установите Finora как приложение</p>
        <p className="text-muted">Нажмите «Поделиться» → «На экран Домой».</p>
      </div>
      <IconButton
        icon="close"
        label="Закрыть подсказку"
        className="-mr-2 -mt-2"
        onClick={() => {
          writeDismissed();
          setVisible(false);
        }}
      />
    </div>
  );
}
