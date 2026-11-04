import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PUBLIC = resolve(__dirname, '../../../public');
const html = readFileSync(resolve(PUBLIC, '404.html'), 'utf8');
/** Разметка без комментариев: их текст не должен влиять на проверки. */
const markup = html.replace(/<!--[\s\S]*?-->/g, '');

describe('public/404.html: страница «не найдено» для адресов вне приложения', () => {
  it('русская, закрыта от индексации, с понятным заголовком и ссылкой на приложение', () => {
    expect(markup).toContain('<html lang="ru">');
    expect(markup).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(markup).toContain('<title>Страница не найдена — Sumoima</title>');
    expect(markup).toMatch(/<h1>Страница не найдена<\/h1>/);
    expect(markup).toMatch(/<a class="button" href="\/">/);
  });

  it('строгая политика: ни скриптов, ни встроенных стилей, ни внешних адресов', () => {
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(markup)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toMatch(/unsafe-|\*|https?:|data:/);
    expect(markup).not.toMatch(/<script|<style|\sstyle=|\son[a-z]+=/i);
  });

  it('все файлы подключены абсолютными путями и лежат в public/ (страница открывается по любому адресу)', () => {
    const refs = [...markup.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('/'), `${ref}: путь должен начинаться с «/»`).toBe(true);
      if (ref !== '/') expect(existsSync(resolve(PUBLIC, ref.slice(1))), `${ref} есть в public/`).toBe(true);
    }
  });

  it('стили не тянут ничего снаружи (внешние шрифты и картинки политика всё равно запретит)', () => {
    const css = readFileSync(resolve(PUBLIC, '404.css'), 'utf8');
    expect(css).not.toMatch(/@import|url\(/);
  });
});
