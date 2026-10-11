import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALICE, makeTestDeps, renderAppRoot } from '@/app/testkit';
import { fakeOtpClient } from '@/auth/otpTestkit';
import { CODE_SENT_TEXT, CODE_WRONG_TEXT, RATE_LIMIT_TEXT } from '@/auth/emailCode';
import { NO_CONNECTION_TEXT } from '@/auth/authErrors';
import { act, findByRole, screen, user, waitFor } from '@/components/testUtils';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.restoreAllMocks();
});

async function openLogin() {
  const fake = fakeOtpClient({ session: null });
  const view = renderAppRoot(<div>ПРИЛОЖЕНИЕ</div>, { client: fake.client, deps: makeTestDeps().deps });
  await findByRole('heading', { name: 'Вход', level: 1 });
  return { fake, unmount: view.unmount };
}

/** Поле почты (type=email) не поддерживает выделение, поэтому user.clear на нём не работает: ставим значение как браузер. */
function setValue(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const email = () => screen.getByRole('textbox', { name: 'Почта' }) as HTMLInputElement;
const codeField = () => screen.getByRole('textbox', { name: 'Код из письма' }) as HTMLInputElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

async function chooseCode() {
  await user.click(screen.getByRole('radio', { name: 'Код на почту' }));
}

/** Дойти до ввода кода: выбрать способ, ввести почту, нажать «Прислать код». */
async function toCodeStep(address = ALICE.email) {
  await chooseCode();
  await user.type(email(), address);
  await user.click(button('Прислать код'));
  await findByRole('textbox', { name: 'Код из письма' });
}

describe('переключатель способа входа', () => {
  it('«Пароль» выбран по умолчанию; «Код на почту» показывает форму кода; почта при переключении не теряется', async () => {
    await openLogin();
    const group = screen.getByRole('radiogroup', { name: 'Способ входа' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Пароль' })).toHaveAttribute('aria-checked', 'true');
    expect(document.querySelector('input[type="password"]')).not.toBeNull();

    await user.type(email(), 'abc@example.com');
    await chooseCode();
    expect(screen.getByRole('radio', { name: 'Код на почту' })).toHaveAttribute('aria-checked', 'true');
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(email().value).toBe('abc@example.com');
    expect(button('Прислать код')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Пароль' }));
    expect(email().value).toBe('abc@example.com');
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('на экране нет ссылок, регистрация доступна кнопкой (только по паролю: кодом новых людей не создаём)', async () => {
    await openLogin();
    await chooseCode();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' })).toBeInTheDocument();
  });
});

describe('парольная форма понятна менеджерам паролей и iCloud-связке', () => {
  it('autocomplete, name, id, enterKeyHint, method на месте', async () => {
    await openLogin();
    const mail = email();
    const pass = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(mail).toHaveAttribute('autocomplete', 'username');
    expect(mail).toHaveAttribute('name', 'username');
    expect(mail).toHaveAttribute('id', 'login-email');
    expect(mail).toHaveAttribute('type', 'email');
    expect(mail).toHaveAttribute('enterkeyhint', 'next');
    expect(mail).toHaveAttribute('autocapitalize', 'none');
    expect(pass).toHaveAttribute('autocomplete', 'current-password');
    expect(pass).toHaveAttribute('name', 'password');
    expect(pass).toHaveAttribute('id', 'login-password');
    expect(pass).toHaveAttribute('enterkeyhint', 'go');
    const form = pass.closest('form')!;
    expect(form).toContainElement(mail);
    expect(form.getAttribute('method')).toBe('post'); // пароль не окажется в адресе, даже если форму отправит сам браузер
    // подписи связаны с полями
    expect(document.querySelector('label[for="login-email"]')).not.toBeNull();
    expect(document.querySelector('label[for="login-password"]')).not.toBeNull();
  });
});

describe('вход по коду: шаг 1, почта', () => {
  it('просит код без создания пользователя и переходит к вводу кода с нейтральным текстом и подсказкой про «Спам»', async () => {
    const { fake } = await openLogin();
    await toCodeStep('Alice@Example.com');
    expect(fake.otp.requests).toEqual([{ email: ALICE.email, shouldCreateUser: false }]);
    expect(screen.getByText(CODE_SENT_TEXT)).toBeInTheDocument();
    expect(screen.getByText(/Код действует недолго\. Письмо не пришло\? Проверьте «Спам»\./)).toBeInTheDocument();
    expect(screen.getByText(`Почта: ${ALICE.email}`)).toBeInTheDocument();
  });

  it('на шаге 1 есть пояснение: код придёт на почту и действует недолго', async () => {
    await openLogin();
    await chooseCode();
    expect(screen.getByText(/пришлём на вашу почту код из цифр\. Он действует недолго/)).toBeInTheDocument();
    expect(email()).toHaveAttribute('autocomplete', 'email');
  });

  it('неизвестная почта: экран ТОТ ЖЕ, что и для известной (кроме самого адреса), но код не выдан', async () => {
    const a = await openLogin();
    await toCodeStep(ALICE.email);
    const knownText = (document.body.textContent ?? '').replaceAll(ALICE.email, '<почта>');
    expect(a.fake.otp.codes.has(ALICE.email)).toBe(true);
    a.unmount();

    const b = await openLogin();
    await toCodeStep('nobody@example.org');
    const unknownText = (document.body.textContent ?? '').replaceAll('nobody@example.org', '<почта>');
    expect(unknownText).toBe(knownText);
    expect(b.fake.otp.codes.size).toBe(0);
    expect(screen.getByText(CODE_SENT_TEXT)).toBeInTheDocument();
  });

  it('неверная форма почты — сообщение, сервер не беспокоим', async () => {
    const { fake } = await openLogin();
    await chooseCode();
    await user.type(email(), 'не почта');
    await user.click(button('Прислать код'));
    expect((await findByRole('alert')).textContent).toMatch(/Введите почту/);
    expect(fake.otp.requests).toEqual([]);
  });

  it.each([
    ['rate', RATE_LIMIT_TEXT],
    ['offline', NO_CONNECTION_TEXT],
    ['server', 'Сервер сейчас недоступен. Попробуйте позже.'],
  ] as const)('честная ошибка (%s): остаёмся на шаге с почтой, кнопка снова доступна', async (mode, text) => {
    const { fake } = await openLogin();
    fake.otp.mode = mode;
    await chooseCode();
    await user.type(email(), ALICE.email);
    await user.click(button('Прислать код'));
    expect((await findByRole('alert')).textContent).toBe(text);
    expect(screen.queryByRole('textbox', { name: 'Код из письма' })).toBeNull();
    expect(button('Прислать код')).not.toBeDisabled();
    expect(email().value).toBe(ALICE.email);
  });

  it('двойное нажатие «Прислать код» — один запрос', async () => {
    const { fake } = await openLogin();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const real = fake.client.auth.signInWithOtp.bind(fake.client.auth);
    vi.spyOn(fake.client.auth, 'signInWithOtp').mockImplementation(async (c) => {
      await gate;
      return real(c);
    });
    await chooseCode();
    await user.type(email(), ALICE.email);
    await user.click(button('Прислать код'));
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Прислать код' }));
    release();
    await findByRole('textbox', { name: 'Код из письма' });
    expect(fake.otp.requests).toHaveLength(1);
  });

  it('без сети: подсказка «Нет сети» видна и в режиме кода', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await openLogin();
    await chooseCode();
    expect(screen.getByText('Нет сети. Для входа нужен интернет.')).toBeInTheDocument();
  });
});

describe('вход по коду: шаг 2, код из письма', () => {
  it('поле кода: одноразовый код, цифровая клавиатура, без подбора символов', async () => {
    await openLogin();
    await toCodeStep();
    const f = codeField();
    expect(f).toHaveAttribute('autocomplete', 'one-time-code');
    expect(f).toHaveAttribute('inputmode', 'numeric');
    expect(f).toHaveAttribute('pattern', '[0-9]*');
    expect(f).toHaveAttribute('name', 'code');
    expect(f).toHaveAttribute('enterkeyhint', 'go');
    expect(f.type).toBe('text'); // не number: иначе пропадают ведущие нули
    expect(document.activeElement).toBe(f); // фокус сразу в поле кода
  });

  it('вставка с пробелами и дефисами очищается; буквы не попадают; длиннее предела обрезается', async () => {
    await openLogin();
    await toCodeStep();
    await user.click(codeField());
    await user.paste('123 456');
    expect(codeField().value).toBe('123456');
    await user.clear(codeField());
    await user.paste('654-321');
    expect(codeField().value).toBe('654321');
    await user.clear(codeField());
    await user.type(codeField(), '12a3b4');
    expect(codeField().value).toBe('1234');
    await user.clear(codeField());
    await user.paste('Ваш код: 246 810. Действует час.');
    expect(codeField().value).toBe('246810');
    await user.clear(codeField());
    await user.paste('1234567890123');
    expect(codeField().value).toBe('1234567890');
  });

  it('пока не набрана минимальная длина, «Войти» недоступна и ничего не отправляется (даже по Enter); при полном наборе сам не отправляет', async () => {
    const { fake } = await openLogin();
    await toCodeStep();
    expect(button('Войти')).toBeDisabled();
    await user.type(codeField(), '12345');
    expect(button('Войти')).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(fake.otp.verifies).toEqual([]);
    await user.type(codeField(), '6');
    expect(button('Войти')).not.toBeDisabled();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(fake.otp.verifies).toEqual([]); // сам не отправляется: длина кода у проекта может быть и больше 6
  });

  it('верный код → вошёл, виден экран приложения; запрос проверки ушёл ровно один', async () => {
    const { fake } = await openLogin();
    await toCodeStep();
    const code = fake.otp.codes.get(ALICE.email)!;
    await user.type(codeField(), code);
    await user.click(button('Войти'));
    await waitFor(() => expect(screen.getByText('ПРИЛОЖЕНИЕ')).toBeInTheDocument());
    expect(fake.otp.verifies).toEqual([{ email: ALICE.email, token: code, type: 'email' }]);
  });

  it('двойное нажатие «Войти» и Enter — одна проверка', async () => {
    const { fake } = await openLogin();
    await toCodeStep();
    const code = fake.otp.codes.get(ALICE.email)!;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const real = fake.client.auth.verifyOtp.bind(fake.client.auth);
    vi.spyOn(fake.client.auth, 'verifyOtp').mockImplementation(async (p) => {
      await gate;
      return real(p);
    });
    await user.type(codeField(), code);
    await user.click(button('Войти'));
    await user.keyboard('{Enter}');
    release();
    await waitFor(() => expect(screen.getByText('ПРИЛОЖЕНИЕ')).toBeInTheDocument());
    expect(fake.otp.verifies).toHaveLength(1);
  });

  it('неверный код: понятная ошибка, цифры остаются в поле, кнопка снова доступна', async () => {
    const { fake } = await openLogin();
    await toCodeStep();
    await user.type(codeField(), '000000');
    await user.click(button('Войти'));
    expect((await findByRole('alert')).textContent).toBe(CODE_WRONG_TEXT);
    expect(codeField().value).toBe('000000');
    expect(button('Войти')).not.toBeDisabled();
    expect(fake.otp.verifies).toHaveLength(1);
    // исправили цифры — ошибка исчезает, верный код пускает
    await user.clear(codeField());
    expect(screen.queryByRole('alert')).toBeNull();
    await user.type(codeField(), fake.otp.codes.get(ALICE.email)!);
    await user.click(button('Войти'));
    await waitFor(() => expect(screen.getByText('ПРИЛОЖЕНИЕ')).toBeInTheDocument());
  });

  it.each([
    ['rate', RATE_LIMIT_TEXT],
    ['offline', NO_CONNECTION_TEXT],
  ] as const)('ошибка проверки (%s) показывается честно', async (mode, text) => {
    const { fake } = await openLogin();
    await toCodeStep();
    fake.otp.mode = mode;
    await user.type(codeField(), fake.otp.codes.get(ALICE.email)!);
    await user.click(button('Войти'));
    expect((await findByRole('alert')).textContent).toBe(text);
  });

  it('«Изменить почту» возвращает на шаг 1: почта на месте, код очищен; можно запросить для другой', async () => {
    const { fake } = await openLogin();
    await toCodeStep();
    await user.type(codeField(), '123');
    await user.click(button('Изменить почту'));
    expect(screen.queryByRole('textbox', { name: 'Код из письма' })).toBeNull();
    expect(email().value).toBe(ALICE.email);
    setValue(email(), 'bob@example.com');
    await user.click(button('Прислать код'));
    await findByRole('textbox', { name: 'Код из письма' });
    expect(codeField().value).toBe('');
    expect(fake.otp.requests.map((r) => r.email)).toEqual([ALICE.email, 'bob@example.com']);
  });

  it('переключение на «Пароль» и обратно не теряет шаг ввода кода', async () => {
    await openLogin();
    await toCodeStep();
    await user.type(codeField(), '1234');
    await user.click(screen.getByRole('radio', { name: 'Пароль' }));
    await chooseCode();
    expect(codeField().value).toBe('1234');
  });
});

describe('«Прислать код ещё раз»: отсчёт 60 секунд', () => {
  const FAKE = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;
  const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  const live = () => document.querySelector<HTMLElement>('p.sr-only[role="status"]')?.textContent ?? '';

  it('кнопка недоступна до конца отсчёта, потом работает и запускает отсчёт заново; повторный запрос уходит один раз', async () => {
    const { fake } = await openLogin();
    vi.useFakeTimers({ toFake: [...FAKE] });
    await chooseCode();
    await user.type(email(), ALICE.email);
    await user.click(button('Прислать код'));
    await tick(0);
    await tick(10);
    expect(button('Прислать код ещё раз')).toBeDisabled();
    expect(screen.getByText(/через \d+ с/)).toBeInTheDocument();

    await tick(58_000);
    expect(button('Прислать код ещё раз')).toBeDisabled();
    await tick(1_900); // прошло ≈59,9 с
    expect(button('Прислать код ещё раз')).toBeDisabled();
    await tick(200); // прошло ≈60,1 с
    expect(button('Прислать код ещё раз')).not.toBeDisabled();
    expect(screen.queryByText(/через \d+ с/)).toBeNull();

    await user.click(button('Прислать код ещё раз'));
    await tick(10);
    expect(fake.otp.requests).toHaveLength(2);
    expect(button('Прислать код ещё раз')).toBeDisabled();
    expect(fake.otp.codes.get(ALICE.email)).toBeTruthy();
  });

  it('скринридеру отсчёт озвучивается не каждую секунду: всего несколько разных сообщений за минуту', async () => {
    await openLogin();
    vi.useFakeTimers({ toFake: [...FAKE] });
    await chooseCode();
    await user.type(email(), ALICE.email);
    await user.click(button('Прислать код'));
    await tick(0);
    const seen = new Set<string>();
    let changes = 0;
    let last = live();
    seen.add(last);
    for (let i = 0; i < 65; i++) {
      await tick(1000);
      const now = live();
      if (now !== last) changes++;
      last = now;
      seen.add(now);
    }
    expect(seen.size).toBeLessThanOrEqual(4);
    expect(changes).toBeLessThanOrEqual(3);
    expect(last).toBe('Можно отправить код ещё раз.');
    // видимая секундная подпись скрыта от скринридера
    await user.click(button('Прислать код ещё раз'));
    await tick(1500);
    const visible = screen.getByText(/через \d+ с/);
    expect(visible.getAttribute('aria-hidden')).toBe('true');
  });

  it('ошибка повторного запроса показывается, отсчёт всё равно запускается заново (сервер не долбим)', async () => {
    const { fake } = await openLogin();
    vi.useFakeTimers({ toFake: [...FAKE] });
    await chooseCode();
    await user.type(email(), ALICE.email);
    await user.click(button('Прислать код'));
    await tick(61_000);
    fake.otp.mode = 'rate';
    await user.click(button('Прислать код ещё раз'));
    await tick(10);
    expect(screen.getByRole('alert').textContent).toBe(RATE_LIMIT_TEXT);
    expect(button('Прислать код ещё раз')).toBeDisabled();
  });
});
