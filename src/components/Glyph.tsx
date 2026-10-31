import type { CSSProperties } from 'react';
import { bankById } from '@/features/wallets/banks';
import { useExtraIconMarkup } from './glyphExtras';
import { DuoMarkup, Icon } from './Icon';
import { resolveGlyph } from './glyphs';
import { serviceById, serviceImageUrl, useServiceLogo } from './services';

export interface GlyphProps {
  /** Значение поля icon категории или кошелька: «i:cup», «b:alif», «s:netflix» или эмодзи. */
  value: string;
  /** Цвет категории или кошелька (#rrggbb): плитка подкрашивается им. Без цвета — нейтральная. */
  color?: string;
  /** Размер плитки в px. */
  size?: number;
  className?: string;
}

/** Плитка со значком: иконка на подкрашенном фоне, знак банка на градиенте, логотип сервиса на его цвете или (для незнакомого эмодзи) сам эмодзи. */
const HEX = /^#[0-9a-f]{6}$/i;

/** Оформление плитки значка: цвет на 18% прозрачности; сам значок — тот же цвет, смешанный с цветом текста (темнее на светлой теме, светлее на тёмной). */
function tileTint(color: string | undefined): { className: string; style: CSSProperties } {
  if (!color) return { className: 'bg-surface-2 text-muted', style: {} };
  return {
    className: '',
    style: { backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`, color: `color-mix(in srgb, ${color} 72%, rgb(var(--text)))` },
  };
}

/** Дополнительный значок: плитка как у обычных, разметка приходит из ленивого файла (пока он грузится, видна пустая плитка). */
function ExtraGlyph({ name, color, base, inner, className }: { name: string; color: string | undefined; base: CSSProperties; inner: number; className?: string }) {
  const markup = useExtraIconMarkup(name);
  const tint = tileTint(color);
  return (
    <span aria-hidden="true" className={`inline-flex items-center justify-center ${tint.className} ${className ?? ''}`} style={{ ...base, ...tint.style }}>
      {markup !== null && <DuoMarkup cacheKey={name} markup={markup} size={inner} />}
    </span>
  );
}

/** Логотип сервиса на плитке его фирменного цвета (цвет категории не нужен). Пока файл логотипов грузится, видна пустая плитка. */
function ServiceGlyph({ id, base, inner, className }: { id: string; base: CSSProperties; inner: number; className?: string }) {
  const service = serviceById(id);
  const logo = useServiceLogo(id);
  if (!service) return null;
  const image = serviceImageUrl(service);
  if (image) {
    // Значок приложения (таджикские банки и сервисы): сама картинка заполняет плитку
    return (
      <span
        aria-hidden="true"
        className={`inline-flex items-center justify-center overflow-hidden ${className ?? ''}`}
        style={{ ...base, backgroundColor: service.color, boxShadow: '0 0 0 1px rgb(128 128 128 / 0.25)' }}
      >
        <img src={image} alt="" width={base.width} height={base.height} draggable={false} className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center ${className ?? ''}`}
      style={{
        ...base,
        backgroundColor: service.color,
        color: service.dark ? '#111827' : '#ffffff',
        // тонкая светлая кайма: чёрные плитки (Apple, X, TikTok) не сливаются с тёмной темой
        boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.14)',
      }}
    >
      {logo && (
        <svg width={inner} height={inner} viewBox={logo[0]} fill="currentColor" focusable="false" aria-hidden="true">
          <path d={logo[1]} />
        </svg>
      )}
    </span>
  );
}

export function Glyph({ value, color: rawColor, size = 40, className }: GlyphProps) {
  const g = resolveGlyph(value);
  const color = rawColor && HEX.test(rawColor) ? rawColor : undefined;
  const radius = Math.round(size * 0.32);
  const base = { width: size, height: size, borderRadius: radius, flexShrink: 0 } as const;
  const inner = Math.round(size * 0.56);

  if (g.kind === 'bank') {
    const bank = bankById(g.id);
    if (bank) {
      return (
        <span
          aria-hidden="true"
          className={`inline-flex items-center justify-center text-white ${className ?? ''}`}
          style={{ ...base, background: `linear-gradient(225deg, ${bank.from}, ${bank.to})` }}
        >
          <Icon name={`bank-${bank.id}` as 'bank-alif'} size={inner} />
        </span>
      );
    }
  }

  if (g.kind === 'service') {
    return <ServiceGlyph id={g.id} base={base} inner={Math.round(size * 0.6)} className={className} />;
  }

  if (g.kind === 'extra') {
    return <ExtraGlyph name={g.name} color={color} base={base} inner={inner} className={className} />;
  }

  if (g.kind === 'icon') {
    const tint = tileTint(color);
    return (
      <span
        aria-hidden="true"
        className={`inline-flex items-center justify-center ${tint.className} ${className ?? ''}`}
        style={{ ...base, ...tint.style }}
      >
        <Icon name={g.name} size={inner} />
      </span>
    );
  }

  // Эмодзи без подходящей иконки (или неизвестный банк): показываем как есть.
  const text = g.kind === 'text' ? g.text : value;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center bg-surface-2 ${className ?? ''}`}
      style={{ ...base, fontSize: Math.round(size * 0.5), lineHeight: 1 }}
    >
      {text}
    </span>
  );
}
