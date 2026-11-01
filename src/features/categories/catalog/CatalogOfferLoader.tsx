import { lazy, Suspense } from 'react';
import { useOptionalStore } from '@/db';
import { wasCatalogOffered } from './catalogOfferStorage';

// Само предложение (проверка данных, план, окно) нужно один раз на человека: в основной файл оно не входит и грузится, только когда ещё не предлагали
const CatalogOffer = lazy(() => import('./CatalogOffer'));

/**
 * Место предложения готовых категорий в приложении (src/App.tsx). Пока человеку не предлагали (и не отмечали «новый»), подгружает
 * CatalogOffer; потом на каждом запуске это одна проверка отметки в хранилище и больше ничего.
 */
export function CatalogOfferLoader() {
  const store = useOptionalStore();
  if (!store || wasCatalogOffered(store.userId)) return null;
  return (
    <Suspense fallback={null}>
      <CatalogOffer />
    </Suspense>
  );
}
