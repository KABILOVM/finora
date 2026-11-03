import { describe, expect, it } from 'vitest';
import { readContact } from './contact';

describe('контакт владельца (VITE_CONTACT)', () => {
  it('почта становится ссылкой mailto', () => {
    expect(readContact({ VITE_CONTACT: ' owner@example.com ' })).toEqual({ href: 'mailto:owner@example.com', label: 'owner@example.com' });
    expect(readContact({ VITE_CONTACT: 'first.last+app@mail.example.tj' })?.href).toBe('mailto:first.last+app@mail.example.tj');
  });

  it('https-ссылка (Telegram и т. п.) показывается без https://', () => {
    expect(readContact({ VITE_CONTACT: 'https://t.me/sumoima_owner' })).toEqual({ href: 'https://t.me/sumoima_owner', label: 't.me/sumoima_owner' });
    expect(readContact({ VITE_CONTACT: 'https://example.com/' })).toEqual({ href: 'https://example.com/', label: 'example.com' });
  });

  it.each([
    ['пусто', ''],
    ['пробелы', '   '],
    ['не строка', 42],
    ['нет переменной', undefined],
    ['http без шифрования', 'http://example.com'],
    ['javascript:', 'javascript:alert(1)'],
    ['mailto: уже с приставкой', 'mailto:a@b.co'],
    ['почта с лишними полями (тема, копия)', 'a@b.co?bcc=evil@x.co'],
    ['почта с пробелом', 'a b@c.com'],
    ['ссылка с паролем', 'https://user:pass@example.com'],
    ['просто слово', 'напишите мне'],
    ['слишком длинное', `https://example.com/${'a'.repeat(300)}`],
  ])('нет контакта: %s', (_name, value) => {
    expect(readContact({ VITE_CONTACT: value })).toBeNull();
  });
});
