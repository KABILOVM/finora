import { useId } from 'react';
import type { SkyKind } from './conditions';

export interface WeatherIconProps {
  kind: SkyKind;
  isDay?: boolean;
  size?: number;
  className?: string;
}

/** Цветные значки погоды (SVG, нарисованы для приложения; работают офлайн). */
export function WeatherIcon({ kind, isDay = true, size = 48, className }: WeatherIconProps) {
  const uid = useId().replace(/:/g, '');
  const sun = `url(#sun${uid})`;
  const cloud = `url(#cl${uid})`;
  const dark = `url(#dk${uid})`;
  const moon = `url(#mo${uid})`;

  const Sun = ({ x = 32, y = 32, r = 11, rays = true }: { x?: number; y?: number; r?: number; rays?: boolean }) => (
    <g>
      {rays && (
        <g stroke="#FDB813" strokeWidth="3" strokeLinecap="round">
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i * Math.PI) / 4;
            return <line key={i} x1={x + Math.cos(a) * (r + 5)} y1={y + Math.sin(a) * (r + 5)} x2={x + Math.cos(a) * (r + 10)} y2={y + Math.sin(a) * (r + 10)} />;
          })}
        </g>
      )}
      <circle cx={x} cy={y} r={r} fill={sun} />
    </g>
  );
  const Moon = () => <path d="M40 40a16 16 0 1 1-14-26 12 12 0 0 0 14 26z" fill={moon} />;
  const Cloud = ({ y = 0, fill = cloud }: { y?: number; fill?: string }) => (
    <path
      transform={`translate(0 ${y})`}
      d="M20 46h26a9 9 0 0 0 1.5-17.9A13 13 0 0 0 22.5 25 10.5 10.5 0 0 0 20 46z"
      fill={fill}
      stroke="#8FA1BC"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  );

  let body;
  switch (kind) {
    case 'clear':
      body = isDay ? <Sun /> : <Moon />;
      break;
    case 'partly':
      body = (
        <>
          {isDay ? <Sun x={24} y={24} r={9} /> : <g transform="translate(-6 -8) scale(.8)"><Moon /></g>}
          <Cloud y={4} />
        </>
      );
      break;
    case 'cloudy':
      body = (
        <>
          <g opacity=".75" transform="translate(-8 -6) scale(.85)"><Cloud fill={dark} /></g>
          <Cloud y={2} />
        </>
      );
      break;
    case 'fog':
      body = (
        <>
          <Cloud y={-4} />
          <g stroke="#B8C4D6" strokeWidth="3.5" strokeLinecap="round">
            <line x1="14" y1="46" x2="50" y2="46" />
            <line x1="20" y1="54" x2="44" y2="54" />
          </g>
        </>
      );
      break;
    case 'drizzle':
    case 'rain':
      body = (
        <>
          <Cloud y={-5} fill={dark} />
          <g stroke="#4DA3FF" strokeWidth="3.5" strokeLinecap="round">
            <line x1="24" y1="46" x2="21" y2="54" />
            <line x1="34" y1="46" x2="31" y2="56" />
            {kind === 'rain' && <line x1="44" y1="46" x2="41" y2="54" />}
          </g>
        </>
      );
      break;
    case 'snow':
      body = (
        <>
          <Cloud y={-5} />
          <g fill="#E8F3FF">
            <circle cx="24" cy="49" r="3" />
            <circle cx="34" cy="55" r="3" />
            <circle cx="44" cy="49" r="3" />
          </g>
        </>
      );
      break;
    case 'storm':
      body = (
        <>
          <Cloud y={-5} fill={dark} />
          <path d="M34 38 26 52h7l-3 10 11-16h-7l4-8z" fill="#FFD43B" />
        </>
      );
      break;
  }

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`sun${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFD43B" />
          <stop offset="1" stopColor="#FF9F1C" />
        </linearGradient>
        <linearGradient id={`cl${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#C3CFE0" />
        </linearGradient>
        <linearGradient id={`dk${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B4C0D3" />
          <stop offset="1" stopColor="#7C8BA3" />
        </linearGradient>
        <linearGradient id={`mo${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFF3C4" />
          <stop offset="1" stopColor="#E3C766" />
        </linearGradient>
      </defs>
      {body}
    </svg>
  );
}
