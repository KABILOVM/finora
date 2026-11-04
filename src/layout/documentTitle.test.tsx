import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MORE_PATH, MORE_TITLE, SECTIONS } from '@/app/sections';
import { render, screen, user } from '@/components/testUtils';
import { APP_TITLE, titleFor, useDocumentTitle } from './documentTitle';

afterEach(() => {
  document.title = '';
});

describe('заголовок вкладки по адресу', () => {
  it('общий заголовок совпадает с <title> в index.html', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(APP_TITLE);
  });

  it('у каждого раздела из реестра — своё название; «Главная» и «Ещё»', () => {
    for (const s of SECTIONS) {
      expect(titleFor(s.path), s.path).toBe(s.path === '/' ? APP_TITLE : `${s.title} — Sumoima`);
    }
    expect(titleFor(MORE_PATH)).toBe(`${MORE_TITLE} — Sumoima`);
  });

  it('вложенные страницы берут название раздела, регистр и «/» на конце не мешают', () => {
    expect(titleFor('/wallets/abc-123')).toBe('Кошельки — Sumoima');
    expect(titleFor('/debts/people/Иван')).toBe('Долги — Sumoima');
    expect(titleFor('/transactions/check')).toBe('Операции — Sumoima');
    expect(titleFor('/Budgets/')).toBe('Бюджеты — Sumoima');
  });

  it.each([undefined, null, 42, {}, ['/wallets']])('не строка (%j) — общий заголовок, без падения', (value) => {
    expect(titleFor(value)).toBe(APP_TITLE);
  });

  it.each(['/', '', '/нет-такой', '/walletsX', '/login'])('незнакомый адрес %j — общий заголовок', (path) => {
    expect(titleFor(path)).toBe(APP_TITLE);
  });
});

describe('useDocumentTitle', () => {
  function Probe() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    useDocumentTitle(pathname);
    return (
      <>
        <button onClick={() => navigate('/budgets')}>к бюджетам</button>
        <button onClick={() => navigate('/')}>домой</button>
      </>
    );
  }

  it('меняется вместе с адресом, а при уходе с экрана возвращает общий', async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/wallets']}>
        <Probe />
      </MemoryRouter>,
    );
    expect(document.title).toBe('Кошельки — Sumoima');
    await user.click(screen.getByRole('button', { name: 'к бюджетам' }));
    expect(document.title).toBe('Бюджеты — Sumoima');
    await user.click(screen.getByRole('button', { name: 'домой' }));
    expect(document.title).toBe(APP_TITLE);
    await user.click(screen.getByRole('button', { name: 'к бюджетам' }));
    unmount();
    expect(document.title).toBe(APP_TITLE);
  });
});
