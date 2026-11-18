import { lazy, Suspense } from 'react';
import { useActiveSeason } from './useActiveSeason';

// Рисование сезона (частицы, сугробы, иней) нужно не каждому и не всегда: его код грузится отдельным файлом
const SeasonLayers = lazy(() => import('./SeasonLayers'));

/**
 * Сезонные эффекты поверх содержимого страницы: зимой снег, весной лепестки, летом жара и пух, осенью листья. Частицы ложатся на блоки и
 * стряхиваются нажатием (src/season/engine.ts). Слоя нет, если человек выключил эффекты или сезон (Настройки → Оформление) либо у
 * устройства включено «уменьшить движение». Слой не принимает касаний, скрыт от скринридера и лежит под шапкой, меню и окнами.
 */
export function SeasonHost() {
  const season = useActiveSeason();
  if (season === null) return null;
  return (
    <div aria-hidden="true" className="season" data-season-layer={season}>
      <Suspense fallback={null}>
        <SeasonLayers season={season} />
      </Suspense>
    </div>
  );
}
