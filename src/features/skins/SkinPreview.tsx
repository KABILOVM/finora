import type { CSSProperties } from 'react';
import { PALETTE_KEYS, triple, type Palette } from '@/lib/paletteBase';
import { cn } from '@/lib/cn';
import type { SkinTraits } from '@/skinCore';

export interface SkinPreviewProps {
  /** Чья палитра: готовый образ (его блок в index.css), «custom» (палитра передана в `palette`) или null — «Классика» с акцентом `accent`. */
  scope: string | null;
  /** Акцент для «Классики» и «Классики (прежней)»: готовый (его блок в index.css) или «custom» с палитрой в `palette`. */
  accent?: string;
  /** Готовая палитра: у своего образа и у «своего цвета». */
  palette?: Palette | null;
  traits: SkinTraits;
  /** Картинка в углу карточки «Всего»: значок образа или его рисунок. */
  art?: string | undefined;
  /** Рисунок во всю высоту карточки (окно предпросмотра), а не значок в углу. */
  artFull?: boolean;
  /** Размер «экрана» задаётся размером шрифта: все размеры внутри — в em. */
  size?: number;
  className?: string;
}

/**
 * Маленький «экран телефона» в цветах и с чертами образа: карточка «Всего», две строки списка и нижнее меню. Чисто украшение
 * (aria-hidden): что это за образ, говорят подпись и название рядом. Цвета приходят из палитры образа через data-skin-scope
 * (src/styles/look.css), поэтому на одной странице можно показать сразу все образы.
 */
export function SkinPreview({ scope, accent, palette, traits, art, artFull = false, size = 10, className }: SkinPreviewProps) {
  const vars: Record<string, string | number> = { '--pv-size': `${size}px` };
  // своя палитра: у своего образа — в --cs-*, у «своего цвета» — прямо в --ac-*
  if (palette) for (const key of PALETTE_KEYS) vars[`--${scope === 'custom' ? 'cs' : 'ac'}-${key}`] = triple(palette[key]);
  return (
    <div
      aria-hidden="true"
      className={cn('pv', className)}
      data-skin-scope={scope ?? ''}
      data-accent={scope === null && accent !== 'custom' ? (accent ?? 'violet') : undefined}
      data-pv-shape={traits.shape}
      data-pv-material={traits.material}
      data-pv-nav={traits.nav}
      data-pv-hero={traits.hero}
      style={vars as CSSProperties}
    >
      <div className="pv-hero">
        {art !== undefined &&
          (artFull ? (
            <img src={art} alt="" className="pv-art" decoding="async" />
          ) : (
            <img src={art} alt="" loading="lazy" decoding="async" className="absolute right-[0.55em] top-[0.55em] h-[2.7em] w-[2.7em] rounded-[0.6em] border border-white/40 object-cover" />
          ))}
        <span className="pv-amount" />
        <span className="pv-chips">
          <i />
          <i />
        </span>
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="pv-card">
          <b />
          <span>
            <i />
            <i />
          </span>
          <em />
        </div>
      ))}
      <div className="pv-nav">
        <i />
        <i />
        <b />
        <i />
        <i />
      </div>
    </div>
  );
}
