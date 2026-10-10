import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALICE, fakeAuthClient, makeTestDeps, renderAppRoot } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.restoreAllMocks();
});

async function openLogin(opts: Parameters<typeof fakeAuthClient>[0] = { session: null }) {
  const fake = fakeAuthClient(opts);
  renderAppRoot(<div>ПРИЛОЖЕНИЕ</div>, { client: fake.client, deps: makeTestDeps().deps });
  await findByRole('heading', { name: 'Вход', level: 1 });
  return { fake };
}

describe('экран входа', () => {
  it('поля подписаны, у почты подходящая клавиатура, нет ссылки на регистрацию, есть пояснение про закрытый круг', async () => {
    await openLogin();
    const email = screen.getByRole('textbox', { name: 'Почта' }) as HTMLInputElement;
    expect(email.type).toBe('email');
    expect(email.autocomplete).toBe('username');
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.autocomplete).toBe('current-password');
    expect(screen.getByText(/Аккаунты создаёт владелец приложения/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('«Показать пароль» / «Скрыть пароль» переключает тип поля', async () => {
    await openLogin();
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Показать пароль' }));
    expect(document.querySelector('input[type="password"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Скрыть пароль' }));
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('двойное нажатие «Войти» отправляет вход один раз', async () => {
    const { fake } = await openLogin();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const real = fake.client.auth.signInWithPassword.bind(fake.client.auth);
    vi.spyOn(fake.client.auth, 'signInWithPassword').mockImplementation(async (c) => {
      await gate;
      return real(c);
    });
    await user.type(screen.getByRole('textbox', { name: 'Почта' }), ALICE.email);
    await user.type(document.querySelector('input[type="password"]') as HTMLInputElement, ALICE.password);
    const button = screen.getByRole('button', { name: 'Войти' });
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await user.keyboard('{Enter}');
    release();
    await waitFor(() => expect(screen.getByText('ПРИЛОЖЕНИЕ')).toBeInTheDocument());
    expect(fake.calls.signIn).toBe(1);
  });

  it('без сети под кнопкой подсказка «Нет сети»', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await openLogin();
    expect(screen.getByText('Нет сети. Для входа нужен интернет.')).toBeInTheDocument();
  });

  it('после неудачи кнопка снова доступна, пароль не стирается', async () => {
    await openLogin();
    await user.type(screen.getByRole('textbox', { name: 'Почта' }), ALICE.email);
    await user.type(document.querySelector('input[type="password"]') as HTMLInputElement, 'не тот');
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await findByRole('alert');
    expect(screen.getByRole('button', { name: 'Войти' })).not.toBeDisabled();
    expect((document.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('не тот');
  });
});
