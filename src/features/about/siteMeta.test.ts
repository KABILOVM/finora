import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySiteMeta, OG_IMAGE_FILE, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, readSiteUrl, SITE_META_MARK, siteMetaTags } from './siteMeta';

const ROOT = resolve(__dirname, '../../..');
const indexHtml = (): string => readFileSync(resolve(ROOT, 'index.html'), 'utf8');

describe('адрес сайта для превью ссылки (VITE_SITE_URL)', () => {
  it('нормализуется: https, «/» на конце, без параметров и якоря', () => {
    expect(readSiteUrl({ VITE_SITE_URL: 'https://sumoima.vercel.app' })).toBe('https://sumoima.vercel.app/');
    expect(readSiteUrl({ VITE_SITE_URL: ' https://example.com/app/?x=1#y ' })).toBe('https://example.com/app/');
    expect(readSiteUrl({ VITE_SITE_URL: 'https://example.com:8443/' })).toBe('https://example.com:8443/');
  });

  it.each([
    ['пусто', ''],
    ['нет', undefined],
    ['http', 'http://example.com'],
    ['не адрес', 'sumoima'],
    ['с паролем', 'https://u:p@example.com'],
    ['javascript:', 'javascript:alert(1)'],
    ['хост со странными символами', 'https://exa"mple.com'],
  ])('не подходит: %s', (_name, value) => {
    expect(readSiteUrl({ VITE_SITE_URL: value })).toBeNull();
  });
});

describe('теги превью, зависящие от адреса сайта', () => {
  it('с адресом: og:url, og:image (абсолютный), размеры и большая карточка', () => {
    const tags = siteMetaTags({ VITE_SITE_URL: 'https://example.com/app' });
    expect(tags).toContain('<meta property="og:url" content="https://example.com/app/" />');
    expect(tags).toContain(`<meta property="og:image" content="https://example.com/app/${OG_IMAGE_FILE}" />`);
    expect(tags).toContain(`content="${OG_IMAGE_WIDTH}"`);
    expect(tags).toContain(`content="${OG_IMAGE_HEIGHT}"`);
    expect(tags).toContain('summary_large_image');
  });

  it('без адреса: картинки и адреса нет, карточка обычная', () => {
    const tags = siteMetaTags({});
    expect(tags).not.toMatch(/og:image|og:url/);
    expect(tags).toContain('content="summary"');
  });

  it('адрес с & и кавычкой не ломает атрибут', () => {
    const tags = siteMetaTags({ VITE_SITE_URL: 'https://example.com/a&b' });
    expect(tags).toContain('https://example.com/a&amp;b/');
    expect(tags).not.toContain('a&b');
  });
});

describe('index.html: превью ссылки и закрытие от поиска', () => {
  it('метка на месте и заменяется; без метки подстановка падает с понятной ошибкой', () => {
    const html = indexHtml();
    expect(html).toContain(`<!--${SITE_META_MARK}-->`);
    const built = applySiteMeta(html, { VITE_SITE_URL: 'https://example.com' });
    expect(built).not.toContain('@@SITE_META@@');
    expect(built).toContain('property="og:image" content="https://example.com/og-image.jpg"');
    expect(() => applySiteMeta('<html></html>', {})).toThrow(/нет метки/);
  });

  it('есть заголовок и описание превью, тег noindex', () => {
    const html = indexHtml();
    for (const p of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:locale']) expect(html, p).toContain(`property="${p}"`);
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  });

  it('файлы на месте: картинка превью 1200×630 JPEG и небольшая, robots.txt не запрещает обход (иначе пропадёт превью)', () => {
    const img = resolve(ROOT, 'public', OG_IMAGE_FILE);
    const bytes = readFileSync(img);
    expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(statSync(img).size).toBeLessThan(300_000);
    // размеры из заголовка SOF0/SOF2
    let i = 2;
    let size: [number, number] | null = null;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) break;
      const marker = bytes[i + 1]!;
      const len = bytes.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        size = [bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5)];
        break;
      }
      i += 2 + len;
    }
    expect(size).toEqual([OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT]);
    const robots = readFileSync(resolve(ROOT, 'public/robots.txt'), 'utf8');
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).not.toMatch(/^\s*Disallow:\s*\/\s*$/m);
  });
});
