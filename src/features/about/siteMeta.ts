/**
 * Превью ссылки (Open Graph) для мессенджеров и соцсетей. Заголовок, описание и название лежат в index.html как есть, а то, что
 * зависит от адреса сайта (og:url, og:image: им нужен АБСОЛЮТНЫЙ адрес), подставляет при сборке метка `<!--@@SITE_META@@-->`.
 * Адрес берётся из VITE_SITE_URL (например, https://sumoima.vercel.app). Нет переменной или адрес не https — картинки и адреса в
 * превью нет, остаётся только заголовок и описание (на Vercel адрес заранее неизвестен, угадывать его нельзя).
 * Файл без импортов с алиасами `@/`: его читает vite.config.ts.
 */

export const SITE_META_MARK = '@@SITE_META@@';

/** Картинка превью: public/og-image.jpg, 1200×630 (делает `npm run gen:og`). */
export const OG_IMAGE_FILE = 'og-image.jpg';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_IMAGE_ALT = 'Sumoima — личный учёт денег. Работает без интернета';

export interface SiteEnvLike {
  VITE_SITE_URL?: unknown;
}

/**
 * Адрес сайта с «/» на конце, без параметров и якоря: `https://host/` или `https://host/папка/`. null — адреса нет или он не подходит
 * (не https, с логином и паролем, странное имя хоста): в мета-теги такой адрес не пускаем.
 */
export function readSiteUrl(env: SiteEnvLike): string | null {
  const raw = typeof env.VITE_SITE_URL === 'string' ? env.VITE_SITE_URL.trim() : '';
  if (raw === '') return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return null;
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(u.hostname) || !/^\d{0,5}$/.test(u.port)) return null;
    return `${u.origin}${u.pathname.replace(/\/*$/, '/')}`;
  } catch {
    return null;
  }
}

/** Значение для атрибута в двойных кавычках. */
const attr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Теги, которые зависят от адреса сайта. */
export function siteMetaTags(env: SiteEnvLike): string {
  const site = readSiteUrl(env);
  if (site === null) return '<meta name="twitter:card" content="summary" />';
  return [
    `<meta property="og:url" content="${attr(site)}" />`,
    `<meta property="og:image" content="${attr(site + OG_IMAGE_FILE)}" />`,
    '<meta property="og:image:type" content="image/jpeg" />',
    `<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />`,
    `<meta property="og:image:alt" content="${attr(OG_IMAGE_ALT)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
  ].join('\n    ');
}

/** Подставляет теги вместо метки в index.html. Бросает ошибку, если метки нет (иначе превью молча осталось бы без картинки). */
export function applySiteMeta(html: string, env: SiteEnvLike): string {
  const mark = `<!--${SITE_META_MARK}-->`;
  if (!html.includes(mark)) throw new Error(`index.html: нет метки ${mark}`);
  return html.replace(mark, () => siteMetaTags(env));
}
