import { useEffect, useRef } from 'react';
import { startSeason } from './engine';
import type { SeasonKind } from './season';

/**
 * Два слоя сезонных эффектов: неподвижный во весь экран, где летят частицы, и пустой слой в координатах страницы, куда engine.ts
 * кладёт то, что лежит на блоках. Оба наполняет engine.ts; здесь только запуск и остановка вместе с компонентом.
 */
export default function SeasonLayers({ season }: { season: SeasonKind }) {
  const sky = useRef<HTMLDivElement | null>(null);
  const ground = useRef<HTMLDivElement | null>(null);
  useEffect(() => (sky.current && ground.current ? startSeason(sky.current, ground.current, season) : undefined), [season]);
  return (
    <>
      <div ref={sky} className="season-sky" />
      <div ref={ground} className="season-ground" />
    </>
  );
}
