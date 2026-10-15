import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { LocationProbe, opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import SettingsPage from '@/features/settings/SettingsPage';
import { version } from '../../../package.json';
import { RELEASES } from './releases';
import { readSeenVersion, writeSeenVersion } from './whatsNewStorage';
import { WhatsNew } from './WhatsNew';
import { WhatsNewSheet } from './WhatsNewSheet';

beforeEach(() => {
  pinToday();
  window.localStorage.clear();
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const dlg = () => screen.queryByRole('dialog', { name: 'Что нового' });
const cashOf = async (s: Store) => (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
const withTx = async (s: Store) => void (await s.transactions.create({ kind: 'expense', walletId: await cashOf(s), amountMinor: 1000, occurredOn: '2026-10-14' }));

async function open(setup?: (s: Store) => Promise<unknown>, path = '/') {
  const td = opsDeps([table()], { setup: setup ? async (s) => void (await setup(s)) : undefined });
  await showApp(
    <>
      <WhatsNew />
      <Routes>
        <Route path="/" element={<h1>Главная</h1>} />
        <Route path="/add" element={<h1>Добавить</h1>} />
        <Route path="*" element={<p>Другая</p>} />
      </Routes>
      <LocationProbe />
    </>,
    td,
    path,
  );
  return td;
}
const userIdOf = (td: Awaited<ReturnType<typeof open>>) => storeOf(td).userId;

describe('окно «Что нового» после обновления', () => {
  it('у человека, который уже пользуется приложением, и без отметки: показывается один раз, закрытие запоминает версию', async () => {
    const td = await open(withTx);
    const sheet = await waitFor(() => screen.getByRole('dialog', { name: 'Что нового' }));
    for (const it of RELEASES[0]!.items) expect(sheet.textContent).toContain(it.text);
    // версия одна — заголовка «Версия …» нет
    expect(sheet.querySelector('h3')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Понятно' }));
    await waitFor(() => expect(dlg()).toBeNull());
    expect(readSeenVersion(userIdOf(td))).toBe(version);
    expect(window.localStorage.getItem(`finora:whatsnew:${userIdOf(td)}`)).toBe(version);
  });

  it('новый человек (операций нет): окна нет, версия запоминается молча', async () => {
    const td = await open();
    await waitFor(() => expect(readSeenVersion(userIdOf(td))).toBe(version));
    await new Promise((r) => setTimeout(r, 1200));
    expect(dlg()).toBeNull();
  });

  it('уже просмотрено для этой версии — не показывается', async () => {
    const td = await open(async (s) => {
      await withTx(s);
      writeSeenVersion(s.userId, version);
    });
    await new Promise((r) => setTimeout(r, 1300));
    expect(dlg()).toBeNull();
    expect(readSeenVersion(userIdOf(td))).toBe(version);
  });

  it('обновились с прежней версии (отметка «0.1.0»): показывается запись новой версии', async () => {
    let seen = false;
    const td = opsDeps([table()], {
      setup: async (s) => {
        await withTx(s);
        writeSeenVersion(s.userId, '0.1.0');
        seen = true;
      },
    });
    await showApp(<WhatsNew />, td, '/');
    await waitFor(() => expect(seen).toBe(true));
    await waitFor(() => screen.getByRole('dialog', { name: 'Что нового' }));
  });

  it('на адресе /add (внесение операции) окно не появляется', async () => {
    await open(withTx, '/add');
    await new Promise((r) => setTimeout(r, 1300));
    expect(dlg()).toBeNull();
  });

  it('поверх другого окна не показывается: ждёт, пока оно закроется', async () => {
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'dialog');
    document.body.appendChild(modal);
    await open(withTx);
    await new Promise((r) => setTimeout(r, 1300));
    expect(dlg()).toBeNull();
    modal.remove();
    await waitFor(() => screen.getByRole('dialog', { name: 'Что нового' }));
  });

  it('localStorage недоступен: окно показывается и закрывается без ошибок; в этом сеансе повторно не лезет', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('нет доступа');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('нет доступа');
    });
    const td = await open(withTx);
    await waitFor(() => screen.getByRole('dialog', { name: 'Что нового' }));
    await user.click(screen.getByRole('button', { name: 'Понятно' }));
    await waitFor(() => expect(dlg()).toBeNull());
    expect(readSeenVersion(userIdOf(td))).toBe(version); // из памяти
  });
});

describe('WhatsNewSheet', () => {
  it('несколько версий — с заголовками «Версия … · дата», новые первыми', async () => {
    const releases = [
      { version: '0.3.0', date: '2026-11-01', items: [{ icon: '🆕', text: 'третье' }] },
      { version: '0.2.0', date: '2026-10-15', items: [{ icon: '✨', text: 'второе' }] },
    ];
    await showApp(<WhatsNewSheet releases={releases} onClose={() => undefined} />, opsDeps([table()]), '/');
    const sheet = await findByRole('dialog', { name: 'Что нового' });
    expect(Array.from(sheet.querySelectorAll('h3')).map((h) => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Версия 0.3.0 · 1 ноября', 'Версия 0.2.0 · 15 октября']);
    expect(sheet.textContent?.indexOf('третье')).toBeLessThan(sheet.textContent?.indexOf('второе') ?? 0);
  });
});

describe('настройки: «Что нового»', () => {
  it('строка открывает окно с записью текущей версии, в любой момент', async () => {
    await showApp(<SettingsPage />, opsDeps([table()]), '/settings');
    await findByRole('heading', { name: 'Настройки', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Что нового' }));
    const sheet = await findByRole('dialog', { name: 'Что нового' });
    expect(sheet.textContent).toContain(RELEASES[0]!.items[0]!.text);
    await user.click(screen.getByRole('button', { name: 'Понятно' }));
    await waitFor(() => expect(dlg()).toBeNull());
  });
});
