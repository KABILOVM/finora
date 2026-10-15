import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, user, waitFor } from '@/components/testUtils';
import { pick } from '@/app/testkit';
import { AUTH_SECRET, ENDPOINT, P256DH, fakeCloud, type FakeBrowser, type FakeCloud } from '@/push/__fixtures__/pushKit';
import { btn, hourSelect, maybeBtn, openReminders, pageText, seeText, text, toggle } from '@/push/__fixtures__/openReminders';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

let browser: FakeBrowser | null = null;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('finora:deviceId', 'device-this-0001');
});
afterEach(() => {
  browser?.restore();
  browser = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Напоминания уже включены на этом устройстве. */
async function openEnabled(settings: Record<string, unknown> = {}): Promise<FakeCloud> {
  const cloud = fakeCloud({
    settings: { enabled: true, ...settings },
    subscriptions: [{ endpoint: ENDPOINT, device_id: 'device-this-0001', p256dh: P256DH, auth_secret: AUTH_SECRET }],
  });
  const o = await openReminders({ cloud, browser: { permission: 'granted', subscribed: true } });
  browser = o.browser;
  await seeText('Напоминания включены на этом устройстве.');
  return cloud;
}

const upserts = (c: FakeCloud) => c.calls.filter((x) => x.table === 'reminder_settings' && x.op === 'upsert');

describe('Напоминания: настройки', () => {
  it('пока напоминания выключены, настроек нет — только объяснение и кнопка', async () => {
    const o = await openReminders({ browser: { permission: 'default' } });
    browser = o.browser;
    await seeText('Напоминания выключены.');
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(maybeBtn('Проверить уведомление')).toBeNull();
  });

  it('когда включены: час (00:00–23:00, по умолчанию 09:00), пять переключателей с честными пояснениями, часовой пояс, «Проверить»', async () => {
    await openEnabled();
    const options = Array.from(hourSelect().options).map((o) => o.textContent);
    expect(options).toHaveLength(24);
    expect(options[0]).toBe('00:00');
    expect(options[23]).toBe('23:00');
    expect(hourSelect().value).toBe('9');
    expect(toggle('Платежи по расписанию').getAttribute('aria-checked')).toBe('true');
    expect(toggle('Долги и сроки возврата').getAttribute('aria-checked')).toBe('true');
    expect(toggle('Каждый вечер напомнить внести траты, если за день ничего не внесено').getAttribute('aria-checked')).toBe('false');
    expect(toggle('Лимиты бюджета').getAttribute('aria-checked')).toBe('false'); // новый вид напоминаний по умолчанию выключен
    expect(text(/дошли до 70% или 90% лимита или превысили его\. Суммы в уведомление не попадают/)).toBeTruthy();
    expect(toggle('Показывать названия в уведомлении').getAttribute('aria-checked')).toBe('false');
    // один час на всё: так и написано
    expect(text(/Придёт в то же время, что выбрано выше/)).toBeTruthy();
    // про заблокированный экран и суммы
    expect(text(/увидят на заблокированном экране/)).toBeTruthy();
    expect(text(/Суммы не пишутся никогда/)).toBeTruthy();
    expect(text(/Часовой пояс берётся с устройства: Asia\/Dushanbe\./)).toBeTruthy();
    expect(btn('Проверить уведомление')).toBeEnabled();
    expect(btn('Выключить на этом устройстве')).toBeEnabled();
  });

  it('смена часа: уходит только hour_local; на экране новое значение; настройки берутся из ответа сервера', async () => {
    const cloud = await openEnabled({ remind_daily: true, show_details: true });
    pick(hourSelect(), '21');
    await waitFor(() => expect(cloud.tables.reminder_settings[0]!.hour_local).toBe(21));
    await waitFor(() => expect(hourSelect().value).toBe('21'));
    const call = upserts(cloud).at(-1)!;
    expect(Object.keys(call.payload!).sort()).toEqual(['hour_local', 'updated_at']);
    expect(call.payload).not.toHaveProperty('user_id');
    expect(call.options).toEqual({ onConflict: 'user_id' });
    // остальное не затёрто
    expect(cloud.tables.reminder_settings[0]).toMatchObject({ remind_daily: true, show_details: true, enabled: true });
  });

  it('каждый переключатель правит свою колонку и ничего больше', async () => {
    const cloud = await openEnabled();
    const cases: Array<[string, string, boolean]> = [
      ['Платежи по расписанию', 'remind_payments', false],
      ['Долги и сроки возврата', 'remind_debts', false],
      ['Каждый вечер напомнить внести траты, если за день ничего не внесено', 'remind_daily', true],
      ['Лимиты бюджета', 'remind_budgets', true],
      ['Показывать названия в уведомлении', 'show_details', true],
    ];
    for (const [label, column, expected] of cases) {
      await user.click(toggle(label));
      await waitFor(() => expect(cloud.tables.reminder_settings[0]![column]).toBe(expected));
      await waitFor(() => expect(toggle(label).getAttribute('aria-checked')).toBe(String(expected)));
      await waitFor(() => expect(toggle(label)).toBeEnabled()); // сохранение закончено, можно нажимать следующий
      const call = upserts(cloud).at(-1)!;
      expect(Object.keys(call.payload!).sort()).toEqual([column, 'updated_at']);
    }
  });

  it('пока идёт сохранение, элементы заблокированы (двойной тап не задвоит); показывается ожидаемое значение', async () => {
    const cloud = await openEnabled();
    const release = cloud.hold();
    const sw = toggle('Показывать названия в уведомлении');
    await act(async () => {
      sw.click();
      sw.click();
    });
    expect(toggle('Показывать названия в уведомлении').getAttribute('aria-checked')).toBe('true'); // ожидаемое значение
    expect(toggle('Показывать названия в уведомлении')).toBeDisabled();
    expect(hourSelect()).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(upserts(cloud)).toHaveLength(1));
    await waitFor(() => expect(toggle('Показывать названия в уведомлении')).toBeEnabled());
    expect(cloud.tables.reminder_settings[0]!.show_details).toBe(true);
  });

  it('не сохранилось (нет сети): понятное сообщение, значение возвращается к тому, что на сервере', async () => {
    const cloud = await openEnabled({ hour_local: 7 });
    expect(hourSelect().value).toBe('7');
    cloud.offline = true;
    pick(hourSelect(), '22');
    await seeText(/Не сохранилось\. Нет связи с сервером/);
    expect(hourSelect().value).toBe('7');
    expect(cloud.tables.reminder_settings[0]!.hour_local).toBe(7);
    // сеть вернулась — то же действие проходит, и сообщение уходит
    cloud.offline = false;
    pick(hourSelect(), '22');
    await waitFor(() => expect(hourSelect().value).toBe('22'));
    expect(text(/Не сохранилось/)).toBeNull();
  });
});

describe('Напоминания: «Проверить уведомление»', () => {
  it('отправляет функции {action:"test"} и пишет словами: «Отправили — ждите несколько секунд»', async () => {
    const cloud = await openEnabled();
    await user.click(btn('Проверить уведомление'));
    await seeText('Отправили — ждите несколько секунд.');
    expect(cloud.invokes).toEqual([{ name: 'send-reminders', options: { body: { action: 'test' } } }]);
  });

  it('без нажатия функция не вызывается; двойное нажатие — один вызов', async () => {
    const cloud = await openEnabled();
    expect(cloud.invokes).toEqual([]);
    cloud.fn.mode = 'hang';
    const b = btn('Проверить уведомление');
    await act(async () => {
      b.click();
      b.click();
    });
    expect(cloud.invokes).toHaveLength(1);
    expect(btn('Проверить уведомление')).toBeDisabled();
  });

  it('причины отказа человеческими словами', async () => {
    const cloud = await openEnabled();
    const cases: Array<[typeof cloud.fn.mode, RegExp]> = [
      ['none', /не нашёл ни одного устройства/],
      ['http-404', /функция send-reminders не развёрнута/],
      ['http-500', /не настроены ключи/],
      ['http-401', /Войдите заново/],
      ['network', /Нет связи/],
      ['not-ok', /не смог отправить/],
    ];
    for (const [mode, expected] of cases) {
      cloud.fn.mode = mode;
      await user.click(btn('Проверить уведомление'));
      await seeText(expected);
      await waitFor(() => expect(btn('Проверить уведомление')).toBeEnabled());
      expect(text('Отправили — ждите несколько секунд.')).toBeNull();
    }
    expect(pageText()).not.toMatch(/FunctionsHttpError|non-2xx|Edge Function/);
  });

  it('успех после ошибки: старое сообщение заменяется новым', async () => {
    const cloud = await openEnabled();
    cloud.fn.mode = 'http-404';
    await user.click(btn('Проверить уведомление'));
    await seeText(/не развёрнута/);
    cloud.fn.mode = 'ok';
    await user.click(btn('Проверить уведомление'));
    await seeText('Отправили — ждите несколько секунд.');
    expect(text(/не развёрнута/)).toBeNull();
  });
});
