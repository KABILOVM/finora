/** Открывает раздел «Напоминания» внутри настоящего AppRoot с поддельным входом, поддельным облаком и поддельным браузером. Только для тестов. */
import { expect, vi } from 'vitest';
import { fakeAuthClient, makeTestDeps, renderAppRoot, type FakeAccount } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { RemindersSection } from '@/features/settings/RemindersSection';
import { USER, VAPID_PUBLIC, fakeCloud, installFakeBrowser, type FakeBrowser, type FakeBrowserOptions, type FakeCloud } from './pushKit';

export const ME: FakeAccount = { id: USER, email: 'me@example.com', password: 'pw-12345678' };

export interface OpenOptions {
  cloud?: FakeCloud;
  /** false — браузер не подменять (jsdom «как есть», без push). */
  browser?: FakeBrowserOptions | false;
  /** Значение VITE_VAPID_PUBLIC_KEY ('' — владелец не настроил). */
  vapid?: string;
  /** true — локальный режим: клиента облака нет. */
  local?: boolean;
}

export interface Opened {
  cloud: FakeCloud;
  browser: FakeBrowser | null;
}

export async function openReminders(o: OpenOptions = {}): Promise<Opened> {
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', o.vapid ?? VAPID_PUBLIC);
  const browser = o.browser === false ? null : installFakeBrowser(o.browser ?? { permission: 'default' });
  const cloud = o.cloud ?? fakeCloud();
  const td = makeTestDeps();
  if (o.local) {
    renderAppRoot(<RemindersSection />, { client: null, deps: td.deps, path: '/settings' });
  } else {
    const fake = fakeAuthClient({ accounts: [ME], session: ME });
    Object.assign(fake.client, { from: cloud.client.from, functions: cloud.client.functions });
    renderAppRoot(<RemindersSection />, { client: fake.client, deps: td.deps, path: '/settings' });
  }
  await findByRole('heading', { name: 'Напоминания', level: 2 });
  return { cloud, browser };
}

export const btn = (name: string | RegExp) => screen.getByRole('button', { name });
export const maybeBtn = (name: string | RegExp) => screen.queryByRole('button', { name });
export const text = (t: string | RegExp) => screen.queryByText(t);
export const hourSelect = () => screen.getByRole('combobox', { name: 'В какое время напоминать (ваше местное время)' }) as HTMLSelectElement;
export const toggle = (name: string) => screen.getByRole('switch', { name });

/** Дождаться, пока на экране появится текст. */
export const seeText = (t: string | RegExp, timeoutMs = 5000) => waitFor(() => expect(screen.getByText(t)).toBeTruthy(), timeoutMs);

export async function click(name: string | RegExp) {
  await user.click(btn(name));
}

/** Всё видимое на странице одним текстом (для проверки, что личное не просочилось на экран). */
export const pageText = (): string => document.body.textContent ?? '';
