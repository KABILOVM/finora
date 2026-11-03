import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, user } from '@/components/testUtils';
import { PrivacySheet } from './PrivacySheet';
import { NO_CONTACT_TEXT, POLICY_DATE, PRIVACY_BLOCKS, TERMS_BLOCKS } from './privacyText';

const dialog = () => screen.getByRole('dialog', { name: 'Конфиденциальность и условия' });
const ALL_TEXT = [...PRIVACY_BLOCKS, ...TERMS_BLOCKS].flatMap((b) => [b.title, ...(b.paragraphs ?? []), ...(b.items ?? []).flatMap((i) => [i.lead, i.text])]).join('\n');

describe('окно «Конфиденциальность и условия»', () => {
  it('показывает все разделы, дату редакции и закрывается кнопкой «Понятно»', async () => {
    const onClose = vi.fn();
    render(<PrivacySheet onClose={onClose} contact={null} />);
    const d = dialog();
    for (const b of [...PRIVACY_BLOCKS, ...TERMS_BLOCKS]) {
      expect(d.textContent, b.id).toContain(b.title);
    }
    expect(d.textContent).toContain('Связаться');
    expect(d.textContent).toContain('Редакция от');
    expect(d.textContent).toMatch(new RegExp(`Редакция от \\d{1,2} \\S+ ${POLICY_DATE.slice(0, 4)}`));
    await user.click(screen.getByRole('button', { name: 'Понятно' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('контакт задан: ссылка mailto; без контакта — совет обратиться к тому, кто дал доступ', () => {
    const { unmount } = render(<PrivacySheet onClose={() => {}} contact={{ href: 'mailto:owner@example.com', label: 'owner@example.com' }} />);
    const link = screen.getByRole('link', { name: 'owner@example.com' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('mailto:owner@example.com');
    expect(link.getAttribute('target')).toBeNull();
    unmount();
    render(<PrivacySheet onClose={() => {}} contact={null} />);
    expect(dialog().textContent).toContain(NO_CONTACT_TEXT);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('ссылка-контакт на сайт открывается в новой вкладке без передачи окна', () => {
    render(<PrivacySheet onClose={() => {}} contact={{ href: 'https://t.me/owner', label: 't.me/owner' }} />);
    const link = screen.getByRole('link', { name: 't.me/owner' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('текст говорит главное: ИИ (Gemini), облако (Supabase), как скачать и как удалить', () => {
    for (const word of ['Gemini', 'Supabase', 'Резервная копия', 'Удалить аккаунт', 'cookie']) expect(ALL_TEXT, word).toContain(word);
  });
});

describe('политика не отстаёт от кода', () => {
  /** Внешние адреса из политики безопасности страницы (connect-src) — единственное, куда приложение может отправить запрос. */
  const connectHosts = (): string[] => {
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)![1]!;
    const connect = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('connect-src'))!;
    return connect.split(/\s+/).filter((s) => s.startsWith('https://')).map((s) => s.slice('https://'.length));
  };

  /** Что в политике написано про каждый внешний адрес. Добавили адрес в CSP — опишите его здесь и в privacyText.ts. */
  const DESCRIBED_AS: Record<string, string> = {
    'www.nbt.tj': 'nbt.tj',
    'cdn.jsdelivr.net': 'jsDelivr',
    'latest.currency-api.pages.dev': 'currency-api',
    'api.open-meteo.com': 'Open-Meteo',
    'geocoding-api.open-meteo.com': 'Open-Meteo',
  };

  it('каждый внешний адрес из CSP назван в политике', () => {
    const hosts = connectHosts();
    expect(hosts.length).toBeGreaterThan(0);
    expect(hosts.filter((h) => !(h in DESCRIBED_AS)), 'новый внешний адрес в CSP: опишите его в privacyText.ts и в DESCRIBED_AS').toEqual([]);
    for (const h of hosts) expect(ALL_TEXT, h).toContain(DESCRIBED_AS[h]!);
  });
});
