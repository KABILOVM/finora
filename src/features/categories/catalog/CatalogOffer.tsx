import { useLiveQuery } from 'dexie-react-hooks';
import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useCategories, useOptionalStore, type Store } from '@/db';
import { hasWork, planCatalog } from './catalogPlan';
import { markCatalogOffered, wasCatalogOffered } from './catalogOfferStorage';

const CatalogSheet = lazy(() => import('./CatalogSheet'));

/** Пауза после запуска: сначала приложение (и окно «Что нового», если оно есть), потом предложение. */
const SHOW_DELAY_MS = 1500;
const RETRY_MS = 1000;
const otherModalOpen = (): boolean => document.querySelector('[aria-modal="true"]') !== null;

/** Если окно вдруг упадёт, приложение не должно падать вместе с ним. */
class Silent extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error): void {
    console.error('Предложение готовых категорий остановлено из-за ошибки:', error);
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function Gate({ store }: { store: Store }) {
  const { pathname } = useLocation();
  const all = useCategories(undefined, { includeArchived: true });
  const [offered, setOffered] = useState(() => wasCatalogOffered(store.userId));
  const [visible, setVisible] = useState(false);
  // Предложение — для действующего человека: у него уже есть операции и ему ещё не предлагали. У нового операций нет, его ведёт мастер.
  const used = useLiveQuery(async () => (await store.db.transactions.count()) > 0, [store]);
  const eligible = !offered && used === true;

  const worth = useMemo(() => {
    if (all === undefined) return false;
    return planCatalog(all.map((c) => ({ id: c.id, name: c.name, kind: c.kind, parentId: c.parentId, archived: c.archivedAt !== null, color: c.color }))).groups.some(hasWork);
  }, [all]);

  const ready = eligible && worth && pathname === '/';
  useEffect(() => {
    if (!ready || visible) return undefined;
    const tryShow = () => {
      if (!otherModalOpen()) setVisible(true);
    };
    const timer = window.setInterval(tryShow, RETRY_MS);
    const first = window.setTimeout(tryShow, SHOW_DELAY_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [ready, visible]);

  if (!visible) return null;
  const close = () => {
    markCatalogOffered(store.userId);
    setVisible(false);
    setOffered(true);
  };
  return (
    <Suspense fallback={null}>
      <CatalogSheet mode="welcome" onClose={close} />
    </Suspense>
  );
}

/**
 * Невидимый компонент: один раз предлагает действующему человеку готовые категории с подкатегориями одним окном (что завести, что нет).
 * Без хранилища (экран входа) не делает ничего. Всегда доступно и позже: «Настройки» → «Категории» → «Готовые категории».
 */
export function CatalogOffer() {
  const store = useOptionalStore();
  if (!store) return null;
  return (
    <Silent key={store.userId}>
      <Gate store={store} />
    </Silent>
  );
}
