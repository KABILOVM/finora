import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthProvider';
import { LOCAL_USER_ID } from '@/auth/config';
import { fakeOtpClient } from '@/auth/otpTestkit';
import { ALICE } from '@/app/testkit';
import { act, findByRole, render, screen, user, waitFor } from '@/components/testUtils';
import { installFakeWebAuthn, type FakeWebAuthn } from '@/lock/fakeWebAuthn';
import { lockKey, readLock, writeLock } from '@/lock/lockStore';
import { createLockCredential } from '@/lock/webauthn';
import { AppLockSection } from './AppLockSection';

let fake: FakeWebAuthn;
beforeEach(() => {
  localStorage.clear();
  fake = installFakeWebAuthn();
});
afterEach(() => {
  fake.restore();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount(ui: ReactNode = <AppLockSection />, client = null as ReturnType<typeof fakeOtpClient>['client'] | null) {
  return render(<AuthProvider client={client}>{ui}</AuthProvider>);
}

const sw = () => screen.getByRole('switch', { name: 'Открывать по Face ID / отпечатку' });
const ready = async () => {
  await waitFor(() => expect(sw()).not.toBeDisabled());
};
const writeFor = async (userId: string, graceSeconds: 0 | 60 | 300 = 60) => {
  const r = await createLockCredential({ id: userId });
  if (!r.ok) throw new Error('не создался ключ');
  writeLock(userId, { credentialId: r.credentialId, enabledAt: '2026-10-11T08:00:00.000Z', graceSeconds });
  return r.credentialId;
};

describe('раздел «Блокировка приложения»', () => {
  it('сначала «Проверяем…» (переключатель недоступен), потом «Выключен»; строка состояния на месте всё время (высота не прыгает)', async () => {
    mount();
    const status = screen.getByText('Проверяем…');
    expect(sw()).toBeDisabled();
    expect(status.className).toContain('min-h-');
    await ready();
    expect(status.textContent).toMatch(/^Выключен/);
    expect(status.isConnected).toBe(true); // тот же элемент, не пересоздан
    expect(sw()).toHaveAttribute('aria-checked', 'false');
  });

  it('честная рамка простыми словами: «замок на экран», не шифрует данные, не заменяет вход по почте', async () => {
    mount();
    await ready();
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/замок на экран/);
    expect(text).toMatch(/кто-то взял ваш уже разблокированный телефон/);
    expect(text).toMatch(/не шифрует/);
    expect(text).toMatch(/вход по почте не заменяет/);
  });

  it('не добавляет на страницу лишних role="status" (по ним ищут отчёты других разделов настроек)', async () => {
    mount();
    await ready();
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(0);
  });

  it('включение: сначала создаётся ключ (системный запрос), потом сохраняется настройка; по умолчанию «через 1 минуту»', async () => {
    mount();
    await ready();
    await user.click(sw());
    await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'true'));
    expect(fake.createCalls).toHaveLength(1);
    const state = readLock(LOCAL_USER_ID);
    expect(state.kind).toBe('on');
    if (state.kind === 'on') {
      expect(state.setting.graceSeconds).toBe(60);
      expect(state.setting.credentialId.length).toBeGreaterThan(10);
    }
    expect(screen.getByText('Замок включён.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Через 1 мин' })).toHaveAttribute('aria-checked', 'true');
  });

  it('отказ при включении: «Не подтверждено», замок не включён, ничего не сохранено', async () => {
    fake.mode = 'decline';
    mount();
    await ready();
    await user.click(sw());
    expect((await findByRole('alert')).textContent).toBe('Не подтверждено. Замок не включён.');
    expect(sw()).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem(lockKey(LOCAL_USER_ID))).toBeNull();
    expect(sw()).not.toBeDisabled(); // можно попробовать снова
  });

  it('ключ создан, а записать настройку не удалось — замок НЕ считается включённым, человеку сказано', async () => {
    mount();
    await ready();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    await user.click(sw());
    expect((await findByRole('alert')).textContent).toMatch(/Замок не включён/);
    expect(sw()).toHaveAttribute('aria-checked', 'false');
  });

  it('двойное нажатие на переключатель — один системный запрос', async () => {
    mount();
    await ready();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const create = navigator.credentials.create.bind(navigator.credentials);
    vi.spyOn(navigator.credentials, 'create').mockImplementation(async (o) => {
      await gate;
      return create(o);
    });
    await user.click(sw());
    await user.click(sw());
    release();
    await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'true'));
    expect(fake.createCalls).toHaveLength(1);
  });

  it('выключение: СНАЧАЛА подтверждение, и только потом запись снимается', async () => {
    await writeFor(LOCAL_USER_ID);
    mount();
    await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'true'));
    await ready();
    let release: () => void = () => undefined;
    fake.hold = new Promise<void>((r) => (release = r));
    await user.click(sw());
    await waitFor(() => expect(fake.getCalls).toHaveLength(1));
    expect(readLock(LOCAL_USER_ID).kind).toBe('on'); // пока человек не подтвердил — замок на месте
    expect(sw()).toBeDisabled();
    release();
    await waitFor(() => expect(readLock(LOCAL_USER_ID).kind).toBe('off'));
    expect(screen.getByText('Замок выключен.')).toBeInTheDocument();
    expect(sw()).toHaveAttribute('aria-checked', 'false');
  });

  it('выключение без подтверждения невозможно: отказ / чужой ответ — замок остаётся включённым', async () => {
    await writeFor(LOCAL_USER_ID);
    mount();
    await ready();
    for (const mode of ['decline', 'abort', 'wrong-credential', 'no-uv-flag'] as const) {
      fake.mode = mode;
      await user.click(sw());
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(readLock(LOCAL_USER_ID).kind, mode).toBe('on');
      expect(sw()).toHaveAttribute('aria-checked', 'true');
    }
    expect(screen.getByRole('alert').textContent).toMatch(/Замок остался включённым|Не получилось/);
  });

  it('выбор «Закрывать»: сразу / через 1 минуту / через 5 минут сохраняется', async () => {
    await writeFor(LOCAL_USER_ID, 60);
    mount();
    await ready();
    const grace = () => (readLock(LOCAL_USER_ID) as { setting: { graceSeconds: number } }).setting.graceSeconds;
    await user.click(screen.getByRole('radio', { name: 'Сразу' }));
    expect(grace()).toBe(0);
    expect(screen.getByRole('radio', { name: 'Сразу' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: 'Через 5 мин' }));
    expect(grace()).toBe(300);
    await user.click(screen.getByRole('radio', { name: 'Через 1 мин' }));
    expect(grace()).toBe(60);
    expect(fake.getCalls).toHaveLength(0); // смена времени подтверждения не требует
  });

  it('пока замок выключен, выбора времени нет', async () => {
    mount();
    await ready();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('настройка у каждого пользователя своя: замок другого человека здесь не виден', async () => {
    await writeFor(ALICE.id);
    mount();
    await ready();
    expect(sw()).toHaveAttribute('aria-checked', 'false');
  });

  it('в облачном режиме настройка привязана к вошедшему пользователю', async () => {
    await writeFor(ALICE.id);
    mount(<AppLockSection />, fakeOtpClient({ session: ALICE }).client);
    await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'true'));
    expect(document.body.textContent).toMatch(/Выйти и войти заново/);
  });

  it('локальный режим: объясняет запасной выход «Снять замок» и честно говорит о его пределах', async () => {
    mount();
    await ready();
    expect(document.body.textContent).toMatch(/Не получается\? Снять замок/);
    expect(document.body.textContent).toMatch(/не от того, кто решил взломать/);
  });
});

describe('устройство не умеет', () => {
  const reasons: Array<[string, () => void, RegExp]> = [
    ['нет WebAuthn', () => fake.restore(), /Этот браузер не умеет/],
    ['нет Face ID / отпечатка / кода экрана', () => (fake.available = false), /Это устройство не умеет/],
    ['проверка упала', () => (fake.available = 'throws'), /Не удалось проверить/],
  ];
  it.each(reasons)('%s: причина простыми словами, переключатель недоступен, ничего не запрашивается', async (_name, arrange, text) => {
    arrange();
    mount();
    await waitFor(() => expect(screen.queryByText('Проверяем…')).toBeNull());
    expect(document.body.textContent).toMatch(text);
    expect(sw()).toBeDisabled();
    expect(fake.createCalls ?? []).toHaveLength(0);
  });

  it('iPhone в браузере: «Откройте приложение с экрана «Домой»»', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    fake.restore();
    mount();
    await waitFor(() => expect(screen.queryByText('Проверяем…')).toBeNull());
    expect(document.body.textContent).toMatch(/Откройте Sumoima с экрана «Домой»/);
    ua.mockRestore();
  });

  it('запрет настройкой сайта (Permissions-Policy): так и написано, а не «не подтверждено»', async () => {
    Object.defineProperty(document, 'featurePolicy', { value: { allowsFeature: () => false }, configurable: true });
    try {
      mount();
      await waitFor(() => expect(screen.queryByText('Проверяем…')).toBeNull());
      expect(document.body.textContent).toMatch(/отключён настройками сайта/);
      expect(sw()).toBeDisabled();
    } finally {
      delete (document as unknown as { featurePolicy?: unknown }).featurePolicy;
    }
  });

  it('iPhone во вкладке Safari, но замок поддерживается: включить можно, и сказано про отдельное хранилище', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    mount();
    await ready();
    expect(document.body.textContent).toMatch(/хранится отдельно в браузере и в приложении с экрана «Домой»/);
    ua.mockRestore();
  });

  it('замок включён, а устройство вдруг не умеет: причина видна, переключатель доступен для попытки, замок не ломается', async () => {
    await writeFor(LOCAL_USER_ID);
    fake.available = false;
    mount();
    await waitFor(() => expect(document.body.textContent).toMatch(/Это устройство не умеет/));
    expect(readLock(LOCAL_USER_ID).kind).toBe('on');
    fake.mode = 'decline';
    await user.click(sw());
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(readLock(LOCAL_USER_ID).kind).toBe('on');
  });
});

describe('повреждённая запись', () => {
  it('раздел это показывает; «Сбросить замок» убирает запись, после этого замок можно включить заново', async () => {
    localStorage.setItem(lockKey(LOCAL_USER_ID), '{битый');
    mount();
    await waitFor(() => expect(document.body.textContent).toMatch(/запись о нём на этом устройстве повреждена/));
    expect(sw()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Сбросить замок' }));
    await waitFor(() => expect(localStorage.getItem(lockKey(LOCAL_USER_ID))).toBeNull());
    await waitFor(() => expect(sw()).not.toBeDisabled());
    await user.click(sw());
    await waitFor(() => expect(readLock(LOCAL_USER_ID).kind).toBe('on'));
  });
});

describe('уход из настроек во время системного запроса', () => {
  it('не падает и не шумит в консоли; подтверждённое выключение доводится до конца, неподтверждённое — нет', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await writeFor(LOCAL_USER_ID);
    const view = mount();
    await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'true'));
    await ready();
    let release: () => void = () => undefined;
    fake.hold = new Promise<void>((r) => (release = r));
    await user.click(sw());
    await waitFor(() => expect(fake.getCalls).toHaveLength(1));
    view.unmount();
    release(); // человек подтвердил уже после ухода со страницы
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(readLock(LOCAL_USER_ID).kind).toBe('off');
    expect(errors).not.toHaveBeenCalled();

    // а если не подтвердил — замок остаётся
    await writeFor(LOCAL_USER_ID);
    fake.mode = 'decline';
    const view2 = mount();
    await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'true'));
    await ready();
    let release2: () => void = () => undefined;
    fake.hold = new Promise<void>((r) => (release2 = r));
    await user.click(sw());
    await waitFor(() => expect(fake.getCalls.length).toBeGreaterThan(1));
    view2.unmount();
    release2();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(readLock(LOCAL_USER_ID).kind).toBe('on');
    expect(errors).not.toHaveBeenCalled();
  });
});
