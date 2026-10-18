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
  it('поля подписаны, у почты подходящая клавиатура, есть переход к регистрации', async () => {
    await openLogin();
    const email = screen.getByRole('textbox', { name: 'Почта' }) as HTMLInputElement;
    expect(email.type).toBe('email');
    expect(email.autocomplete).toBe('username');
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.autocomplete).toBe('current-password');
    expect(screen.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' })).toBeInTheDocument();
  });

  describe('регистрация', () => {
    const NEW = { email: 'new@example.com', password: 'new-password-1' };
    const fill = async (email: string, password: string, repeat: string | null = password) => {
      await user.type(screen.getByRole('textbox', { name: 'Почта' }), email);
      const fields = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
      await user.type(fields[0] as HTMLInputElement, password);
      if (repeat !== null) await user.type(fields[1] as HTMLInputElement, repeat);
    };

    it('режим переключается туда и обратно, у пароля автозаполнение «новый пароль»', async () => {
      await openLogin();
      await user.click(screen.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }));
      expect(screen.getByRole('heading', { name: 'Регистрация', level: 1 })).toBeInTheDocument();
      expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.autocomplete).toBe('new-password');
      await user.click(screen.getByRole('button', { name: 'Уже есть аккаунт? Войти' }));
      expect(screen.getByRole('heading', { name: 'Вход', level: 1 })).toBeInTheDocument();
    });

    it('новая почта и пароль: аккаунт создан, человек сразу внутри', async () => {
      const { fake } = await openLogin();
      await user.click(screen.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }));
      await fill(NEW.email, NEW.password);
      await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
      await waitFor(() => expect(screen.getByText('ПРИЛОЖЕНИЕ')).toBeInTheDocument());
      expect(fake.calls.signUp).toBe(1);
    });

    it('второе поле «Повторите пароль» есть только при регистрации; пароли не совпали — ошибка, на сервер ничего не уходит', async () => {
      const { fake } = await openLogin();
      expect(document.getElementById('login-password-repeat')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }));
      expect(document.getElementById('login-password-repeat')).not.toBeNull();
      await fill(NEW.email, NEW.password, `${NEW.password}x`);
      await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
      expect(await findByRole('alert')).toHaveTextContent('Пароли не совпадают');
      expect(fake.calls.signUp).toBe(0);
    });

    it('«глазок» внутри поля показывает и скрывает сразу оба пароля; кнопка одна', async () => {
      await openLogin();
      await user.click(screen.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }));
      expect(screen.getAllByRole('button', { name: 'Показать пароль' })).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: 'Показать пароль' }));
      expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
      expect(document.getElementById('login-password')).toHaveAttribute('type', 'text');
      expect(document.getElementById('login-password-repeat')).toHaveAttribute('type', 'text');
      await user.click(screen.getByRole('button', { name: 'Скрыть пароль' }));
      expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2);
    });

    it('короткий пароль: понятная ошибка, на сервер ничего не уходит', async () => {
      const { fake } = await openLogin();
      await user.click(screen.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }));
      await fill(NEW.email, 'abc');
      await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
      expect(await findByRole('alert')).toHaveTextContent('не короче 8 символов');
      expect(fake.calls.signUp).toBe(0);
    });

    it('почта уже занята: «Эта почта уже зарегистрирована. Войдите.»', async () => {
      await openLogin();
      await user.click(screen.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }));
      await fill(ALICE.email, 'another-password');
      await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
      expect(await findByRole('alert')).toHaveTextContent('Эта почта уже зарегистрирована. Войдите.');
    });

    it('включено подтверждение почты: сказано проверить письмо, внутрь не пускает', async () => {
      await openLogin({ session: null, signup: 'confirm' });
      await user.click(screen.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }));
      await fill(NEW.email, NEW.password);
      await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
      expect(await findByRole('status')).toHaveTextContent('Подтвердите почту');
      expect(screen.queryByText('ПРИЛОЖЕНИЕ')).toBeNull();
    });

    it('владелец отключил регистрацию: понятное сообщение', async () => {
      await openLogin({ session: null, signup: 'disabled' });
      await user.click(screen.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }));
      await fill(NEW.email, NEW.password);
      await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
      expect(await findByRole('alert')).toHaveTextContent('Регистрация отключена');
    });
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
