import { lazy, Suspense, useSyncExternalStore } from 'react';
import type { SkinScene } from '@/skinCore';
import { useFxPref, useScene } from '@/theme';

// Холст с частицами нужен не каждому образу и не каждому человеку (эффекты можно выключить): его код грузится отдельным файлом
const SceneCanvas = lazy(() => import('./SceneCanvas'));

/** Фоны, которые целиком нарисованы в CSS (src/styles/look.css): для них холст не нужен. */
const CSS_SCENES: readonly string[] = ['none', 'aurora', 'grid', 'lights'];

const QUERY = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (cb: () => void): (() => void) => {
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
  mq?.addEventListener?.('change', cb);
  return () => mq?.removeEventListener?.('change', cb);
};
const readMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;

/**
 * Живой фон образа позади содержимого: какой именно — черта образа data-scene (src/skinCore.ts). Не рисуется, если человек выключил
 * эффекты (Настройки → Оформление) или у устройства включено «уменьшить движение». Слой не принимает касаний и скрыт от скринридера.
 */
export function SceneHost() {
  const scene = useScene();
  const [fx] = useFxPref();
  const reduced = useSyncExternalStore(subscribeMotion, readMotion, () => false);
  if (!fx || reduced || scene === 'none' || scene === 'aurora') return null;
  return (
    <div aria-hidden="true" className="scene fx-loop" data-scene-layer={scene}>
      {!CSS_SCENES.includes(scene) && (
        <Suspense fallback={null}>
          <SceneCanvas scene={scene as SkinScene} />
        </Suspense>
      )}
    </div>
  );
}
