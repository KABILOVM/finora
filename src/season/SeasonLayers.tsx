import { useEffect, useRef } from 'react';
import { startSeason } from './engine';
import { SEASON_PRESETS } from './presets';
import type { SeasonKind } from './season';

/**
 * Слои сезонных эффектов: неподвижный во весь экран, где летят частицы, пустой слой в координатах страницы, куда engine.ts кладёт
 * то, что лежит на блоках, и «настроение» поверх страницы — жара летом, пелена в дождь, порывы в метель (оформление — в look.css,
 * «Сезонные эффекты»; движение целиком CSS). Частицы и лежащее наполняет engine.ts; здесь только запуск и остановка вместе с
 * компонентом.
 */
export default function SeasonLayers({ season }: { season: SeasonKind }) {
  const sky = useRef<HTMLDivElement | null>(null);
  const ground = useRef<HTMLDivElement | null>(null);
  useEffect(() => (sky.current && ground.current ? startSeason(sky.current, ground.current, season) : undefined), [season]);
  const mood = SEASON_PRESETS[season].mood;
  return (
    <>
      {mood === 'heat' && (
        <div className="season-heat">
          <div className="season-heat-sun" />
          <div className="season-heat-ground" />
          <div className="season-heat-wave" />
          <div className="season-heat-wave" />
        </div>
      )}
      {mood === 'mist' && <div className="season-mist" />}
      {mood === 'blow' && (
        <div className="season-blow">
          <div className="season-gust" />
          <div className="season-gust" />
          <div className="season-gust" />
        </div>
      )}
      <div ref={sky} className="season-sky" />
      <div ref={ground} className="season-ground" />
    </>
  );
}
