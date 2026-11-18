import { lazy, Suspense } from 'react';
import { useActiveSeason, useReducedMotion } from '@/season/useActiveSeason';
import type { SkinScene } from '@/skinCore';
import { useFxPref, useScene } from '@/theme';

// Холст с частицами нужен не каждому образу и не каждому человеку (эффекты можно выключить): его код грузится отдельным файлом
const SceneCanvas = lazy(() => import('./SceneCanvas'));

/** Фоны, которые целиком нарисованы в CSS (src/styles/look.css): для них холст не нужен. */
const CSS_SCENES: readonly string[] = ['none', 'aurora', 'grid', 'lights'];

/**
 * Живой фон образа позади содержимого: какой именно — черта образа data-scene (src/skinCore.ts). Не рисуется, если человек выключил
 * эффекты (Настройки → Оформление) или у устройства включено «уменьшить движение». Слой не принимает касаний и скрыт от скринридера.
 * Пока показан сезонный эффект (src/season), частицы образа не рисуются: летает что-то одно, иначе телефону вдвое тяжелее.
 */
export function SceneHost() {
  const scene = useScene();
  const [fx] = useFxPref();
  const reduced = useReducedMotion();
  const season = useActiveSeason();
  if (!fx || reduced || scene === 'none' || scene === 'aurora') return null;
  const particles = !CSS_SCENES.includes(scene);
  if (particles && season !== null) return null;
  return (
    <div aria-hidden="true" className="scene fx-loop" data-scene-layer={scene}>
      {particles && (
        <Suspense fallback={null}>
          <SceneCanvas scene={scene as SkinScene} />
        </Suspense>
      )}
    </div>
  );
}
