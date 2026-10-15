import { Component, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useOptionalStore, type Store } from '@/db';
import { version } from '../../../package.json';
import { RELEASES, type Release } from './releases';
import { releasesToShow } from './whatsNew';
import { readSeenVersion, writeSeenVersion } from './whatsNewStorage';
import { WhatsNewSheet } from './WhatsNewSheet';

/** Пауза после запуска: сначала приложение, потом новости (не мешаем замку, настройке и первой загрузке). */
const SHOW_DELAY_MS = 800;
/** Пока открыто другое окно или человек вносит операцию, проверяем снова. */
const RETRY_MS = 1000;
/** Адреса окон внутри приложения: поверх них новости не показываем. */
const SHEET_PATH = /^\/(add|edit)(\/|$)/;
const otherModalOpen = (): boolean => document.querySelector('[aria-modal="true"]') !== null;

/** Если окно «Что нового» вдруг упадёт, приложение не должно падать вместе с ним. */
class Silent extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error): void {
    console.error('Окно «Что нового» остановлено из-за ошибки:', error);
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function Gate({ store }: { store: Store }) {
  const { pathname } = useLocation();
  const [pending, setPending] = useState<Release[] | null>(null);
  const [visible, setVisible] = useState(false);

  // Один раз при запуске: что показывать. Нечего показывать — просто запоминаем текущую версию.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const seen = readSeenVersion(store.userId);
      // Отметки нет: человек, у которого уже есть операции, обновился с версии без этого окна; у нового операций ещё нет
      const existing = seen !== null || (await store.db.transactions.count()) > 0;
      const list = releasesToShow(RELEASES, version, seen, existing);
      if (!alive) return;
      if (list.length > 0) setPending(list);
      else if (seen !== version) writeSeenVersion(store.userId, version);
    })().catch((e: unknown) => console.error('Не удалось проверить, что показать в «Что нового»:', e));
    return () => {
      alive = false;
    };
  }, [store]);

  // Показываем с паузой и только когда ничего другого поверх приложения нет.
  useEffect(() => {
    if (pending === null || visible) return undefined;
    const timer = window.setInterval(() => {
      if (!otherModalOpen() && !SHEET_PATH.test(pathname)) setVisible(true);
    }, RETRY_MS);
    const first = window.setTimeout(() => {
      if (!otherModalOpen() && !SHEET_PATH.test(pathname)) setVisible(true);
    }, SHOW_DELAY_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [pending, visible, pathname]);

  if (pending === null || !visible) return null;
  return (
    <WhatsNewSheet
      releases={pending}
      onClose={() => {
        writeSeenVersion(store.userId, version);
        setPending(null);
        setVisible(false);
      }}
    />
  );
}

/**
 * Невидимый компонент: после обновления приложения один раз показывает окно «Что нового» (src/features/whatsnew/releases.ts).
 * Без хранилища (экран входа) не делает ничего.
 */
export function WhatsNew() {
  const store = useOptionalStore();
  if (!store) return null;
  return (
    <Silent key={store.userId}>
      <Gate store={store} />
    </Silent>
  );
}
