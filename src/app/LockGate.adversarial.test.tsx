/**
 * ЛОМАТЕЛЬ: замок приложения (LockGate / LockCover) в сборе с остальным приложением.
 * Каждый тест — попытка доказать поломку. Падающий тест = находка.
 */
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthProvider';
import { LOCAL_USER, LOCAL_USER_ID } from '@/auth/config';
import { fakeOtpClient } from '@/auth/otpTestkit';
import { Sheet } from '@/components/Sheet';
import { act, findByRole, render, screen, user, waitFor } from '@/components/testUtils';
import { installFakeWebAuthn, type FakeWebAuthn } from '@/lock/fakeWebAuthn';
import { lockKey, writeLock } from '@/lock/lockStore';
import { createLockCredential } from '@/lock/webauthn';
import { LockGate } from './LockGate';
import { ALICE, makeTestDeps, renderAppRoot } from './testkit';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

let fake: FakeWebAuthn;

beforeEach(() => {
  localStorage.clear();
  fake = installFakeWebAuthn();
});
afterEach(() => {
  fake.restore();
  localStorage.clear();
  vi.useRealTimers();
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
  vi.restoreAllMocks();
});

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function enableLock(graceSeconds: 0 | 60 | 300): Promise<void> {
  const r = await createLockCredential({ id: LOCAL_USER_ID });
  if (!r.ok) throw new Error('не создался ключ');
  writeLock(LOCAL_USER_ID, { credentialId: r.credentialId, enabledAt: '2026-10-11T08:00:00.000Z', graceSeconds });
}

/** Настоящее окно приложения «Новая операция» с набранной, но не сохранённой суммой — то, что реально открыто у человека. */
function DraftSheet({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <main>
        <button type="button">Кнопка приложения</button>
      </main>
      <Sheet
        open={open}
        title="Новая операция"
        onClose={() => {
          onClosed();
          setOpen(false);
        }}
      >
        <input aria-label="Сумма" defaultValue="1500" />
      </Sheet>
    </>
  );
}

/** Приложение уже открыто (замок «Сразу» открыт автозапросом), потом человек сворачивает его — заслонка закрывает экран. */
async function lockedOverOpenSheet() {
  await enableLock(0);
  const closed = vi.fn();
  render(
    <AuthProvider client={null}>
      <LockGate user={LOCAL_USER}>
        <DraftSheet onClosed={closed} />
      </LockGate>
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sumoima закрыта' })).toBeNull()); // автозапрос открыл
  expect(screen.getByRole('dialog', { name: 'Новая операция' })).toBeInTheDocument();
  fake.mode = 'decline'; // дальше открыть нечем
  setVisibility('hidden');
  expect(screen.getByRole('dialog', { name: 'Sumoima закрыта' })).toBeInTheDocument();
  setVisibility('visible');
  return closed;
}

describe('ATTACK: клавиатура на заслонке не должна управлять окнами под ней', () => {
  it('Esc на закрытой заслонке НЕ закрывает окно «Новая операция» под ней (набранное не пропадает)', async () => {
    const closed = await lockedOverOpenSheet();
    expect(screen.getByRole('dialog', { name: 'Sumoima закрыта' }).contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');

    expect(closed, 'окно под заслонкой получило Esc и закрылось: введённая сумма потеряна').not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Новая операция', hidden: true })).toBeInTheDocument();
    expect((document.querySelector('input[aria-label="Сумма"]') as HTMLInputElement).value).toBe('1500');
  });

  it('Tab на заслонке переходит между её кнопками, даже когда под ней открыто окно (фокус-ловушка окна не глотает Tab)', async () => {
    // jsdom не знает inert: настоящий браузер не даёт сфокусировать элемент внутри inert. Повторяем это, иначе фокус «утекал» бы под заслонку.
    const realFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (this.closest('[inert]')) return;
      realFocus.call(this, options);
    });
    await lockedOverOpenSheet();
    const open = screen.getByRole('button', { name: 'Открыть по Face ID / отпечатку' });
    const leave = screen.getByRole('button', { name: 'Не получается? Снять замок' });
    expect(document.activeElement).toBe(open);

    await user.keyboard('{Tab}');

    expect(document.activeElement, 'Tab с «Открыть» должен дойти до «Не получается?» — иначе с клавиатуры до запасного выхода не добраться').toBe(leave);
  });
});

describe('HELD (регрессия): повреждённая запись не открывает замок', () => {
  const GARBAGE: Array<[string, string]> = [
    ['пустая строка', ''],
    ['null', 'null'],
    ['массив', '[]'],
    ['строка', '"x"'],
    ['пустой объект', '{}'],
    ['пустой ключ', '{"credentialId":""}'],
    ['ключ с чужими символами', '{"credentialId":"@@@@"}'],
    ['ключ числом', '{"credentialId":123}'],
    ['обрезанный JSON', '{"credentialId":"AAAA"'],
    ['слишком длинный ключ', `{"credentialId":"${'A'.repeat(1500)}"}`],
    ['ключ с обрезанным base64', '{"credentialId":"AAAAA"}'],
  ];
  it.each(GARBAGE)('%s → закрыто, до приложения не добраться, открыть нечем', async (_name, raw) => {
    localStorage.setItem(lockKey(LOCAL_USER_ID), raw);
    render(
      <AuthProvider client={null}>
        <LockGate user={LOCAL_USER}>
          <main>
            <button type="button">Кнопка приложения</button>
          </main>
        </LockGate>
      </AuthProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Sumoima закрыта' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Кнопка приложения' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Открыть по Face ID / отпечатку' })).toBeNull();
    expect(fake.getCalls).toHaveLength(0); // система про такой ключ не спрашивалась
  });
});

describe('HELD (регрессия): сессию убрал сервер, замок остался — после нового входа заслонка на месте с первого кадра', () => {
  it('событийный выход → экран входа → вход по коду тем же человеком → заслонка', async () => {
    const otp = fakeOtpClient({ session: ALICE });
    const td = makeTestDeps();
    await enableLock(0);
    localStorage.setItem(lockKey(ALICE.id), localStorage.getItem(lockKey(LOCAL_USER_ID))!);
    localStorage.removeItem(lockKey(LOCAL_USER_ID));
    fake.mode = 'decline'; // открыть нечем: заслонка стоит
    renderAppRoot(<button type="button">Кнопка приложения</button>, { client: otp.client, deps: td.deps });
    await findByRole('dialog', { name: 'Sumoima закрыта' });

    // сессию убрал сервер, пока заслонка закрыта: сами мы не выходили
    act(() => otp.emit('SIGNED_OUT', null)); // сессию убрал сервер: сами мы не выходили
    await findByRole('heading', { name: 'Вход', level: 1 });
    expect(localStorage.getItem(lockKey(ALICE.id)), 'замок событийным выходом не снимается').not.toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Код на почту' }));
    await user.type(screen.getByRole('textbox', { name: 'Почта' }), ALICE.email);
    await user.click(screen.getByRole('button', { name: 'Прислать код' }));
    const codeField = await findByRole('textbox', { name: 'Код из письма' });
    await user.type(codeField, otp.otp.codes.get(ALICE.email)!);
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    await findByRole('dialog', { name: 'Sumoima закрыта' });
    expect(screen.queryByRole('button', { name: 'Кнопка приложения' })).toBeNull();
    expect(fake.getCalls.length, 'ключ спрашивали у системы, а не открыли молча').toBeGreaterThan(0);
  });
});
