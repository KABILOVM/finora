import { useEffect, useRef } from 'react';
import { startSeason } from './engine';
import { SEASON_PRESETS } from './presets';
import type { SeasonKind } from './season';

/**
 * Слои сезонных эффектов: неподвижный во весь экран, где летят частицы, пустой слой в координатах страницы, куда engine.ts кладёт
 * то, что лежит на блоках, и — летом — жара: тёплое свечение солнца и поднимающееся марево (оформление — в look.css, «Сезонные
 * эффекты»; движение целиком CSS). Частицы и лежащее наполняет engine.ts; здесь только запуск и остановка вместе с компонентом.
 */
export default function SeasonLayers({ season }: { season: SeasonKind }) {
  const sky = useRef<HTMLDivElement | null>(null);
  const ground = useRef<HTMLDivElement | null>(null);
  useEffect(() => (sky.current && ground.current ? startSeason(sky.current, ground.current, season) : undefined), [season]);
  return (
    <>
      {SEASON_PRESETS[season].haze && (
        <div className="season-heat">
          <div className="season-heat-sun" />
          <div className="season-heat-ground" />
          <div className="season-heat-wave" />
          <div className="season-heat-wave" />
        </div>
      )}
      <div ref={sky} className="season-sky" />
      <div ref={ground} className="season-ground" />
    </>
  );
}
