// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { MSG_NAVIGATE, MSG_SUBSCRIPTION_CHANGED, safeAppPath } from './navigate';
import { BAD_PATHS, GOOD_PATHS } from './__fixtures__/paths';

/* ---------------------------------------------------------------------------------------------
 * public/push-handler.js проверяется ТАК ЖЕ, как он живёт в браузере: файл целиком загружается в изолированный контекст (Node vm)
 * с поддельными self / registration / clients. Настоящий приём push в Chromium: e2e/flows/21-reminders.spec.ts.
 * ------------------------------------------------------------------------------------------- */

const SOURCE = readFileSync(new URL('../../public/push-handler.js', import.meta.url), 'utf8');
const SCOPE = 'https://finora.example/app/';
const FALLBACK = 'Sumoima: есть напоминание';

interface Win {
  url: string;
  focused?: boolean;
  visibilityState?: string;
  navigate: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}
const win = (url: string, o: Partial<Win> = {}): Win => ({
  url,
  navigate: vi.fn(async (u: string) => ({ url: u })),
  focus: vi.fn(async () => undefined),
  postMessage: vi.fn(),
  ...o,
});

function load(windows: Win[] = [], extra: { matchAll?: () => Promise<unknown>; openWindow?: (u: string) => Promise<unknown>; showNotification?: (t: string, o: unknown) => Promise<void> } = {}) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      handlers[type] = fn;
    },
    registration: {
      scope: SCOPE,
      showNotification: vi.fn((title: string, options: Record<string, unknown>) => {
        if (extra.showNotification) return extra.showNotification(title, options);
        shown.push({ title, options });
        return Promise.resolve();
      }),
    },
    clients: {
      matchAll: vi.fn(extra.matchAll ?? (async () => windows)),
      openWindow: vi.fn(extra.openWindow ?? (async (url: string) => ({ url }))),
    },
    location: { href: `${SCOPE}sw.js` },
  };
  vm.runInNewContext(SOURCE, { self });
  const waits: Promise<unknown>[] = [];
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    const e = { ...event, waitUntil: (p: Promise<unknown>) => void waits.push(p) };
    handlers[type]!(e);
    await Promise.all(waits.splice(0));
  };
  const push = (data: string | null | (() => string)) =>
    dispatch('push', { data: data === null ? null : { text: typeof data === 'function' ? data : () => data } });
  const click = (notificationData: unknown) => {
    const notification = { close: vi.fn(), data: notificationData };
    return dispatch('notificationclick', { notification }).then(() => notification);
  };
  return { handlers, shown, self, push, click, dispatch };
}

describe('public/push-handler.js: событие push', () => {
  it('обычное сообщение: заголовок, текст, tag, значки, язык, адрес в data', async () => {
    const h = load();
    await h.push(JSON.stringify({ title: 'Платежи сегодня', body: 'Подходит срок: 2 платежа', tag: 'payment-2026-10-11', url: '/recurring' }));
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]!.title).toBe('Платежи сегодня');
    expect(h.shown[0]!.options).toEqual({
      body: 'Подходит срок: 2 платежа',
      tag: 'payment-2026-10-11',
      icon: 'pwa-192.png',
      badge: 'pwa-192.png',
      lang: 'ru',
      data: { url: '/recurring' },
    });
  });

  it('подписывается на три события и больше ни на что; сам не подписывается на push', () => {
    const h = load();
    expect(Object.keys(h.handlers).sort()).toEqual(['notificationclick', 'push', 'pushsubscriptionchange']);
    expect(SOURCE).not.toMatch(/pushManager|\.subscribe\(/);
  });

  it('не JSON, пусто, нет данных, не объект — уведомление всё равно показывается, с запасным текстом', async () => {
    const cases: Array<string | null | (() => string)> = [
      'просто текст',
      '',
      '   ',
      '{оборванный json',
      '[1,2,3]',
      '"строка"',
      '42',
      'null',
      'true',
      '{}',
      '{"title": "", "body": "   "}',
      null,
      () => {
        throw new Error('данные нечитаемы');
      },
      'x'.repeat(9000),
    ];
    for (const c of cases) {
      const h = load();
      await h.push(c);
      expect(h.shown, String(c).slice(0, 30)).toHaveLength(1);
      expect(h.shown[0]!.title).toBe(FALLBACK);
      expect(h.shown[0]!.options.data).toEqual({ url: '/' });
      expect(h.shown[0]!.options.tag).toBe('finora-reminder');
    }
  });

  it('неверные типы полей заменяются; есть только текст — заголовок «Sumoima»', async () => {
    const h = load();
    await h.push(JSON.stringify({ title: 123, body: ['a'], tag: { x: 1 }, url: 5 }));
    expect(h.shown[0]!.title).toBe(FALLBACK);
    const h2 = load();
    await h2.push(JSON.stringify({ title: { a: 1 }, body: 'Есть платёж', tag: 7, url: null }));
    expect(h2.shown[0]!.title).toBe('Sumoima');
    expect(h2.shown[0]!.options).toMatchObject({ body: 'Есть платёж', tag: 'finora-reminder', data: { url: '/' } });
  });

  it('лишние поля не попадают в уведомление (нет картинок, кнопок, вибрации и т. п.)', async () => {
    const h = load();
    await h.push(JSON.stringify({ title: 'T', body: 'B', actions: [{ action: 'x', title: 'Купить' }], image: 'https://evil/x.png', icon: 'https://evil/i.png', requireInteraction: true, vibrate: [200], silent: false, renotify: true, data: { url: 'https://evil' } }));
    expect(Object.keys(h.shown[0]!.options).sort()).toEqual(['badge', 'body', 'data', 'icon', 'lang', 'tag']);
    expect(h.shown[0]!.options.icon).toBe('pwa-192.png');
    expect(h.shown[0]!.options.data).toEqual({ url: '/' });
  });

  it('очень длинные строки режутся; управляющие символы убираются; пара-эмодзи не рвётся', async () => {
    const h = load();
    await h.push(JSON.stringify({ title: 'Т'.repeat(5000), body: 'Б'.repeat(5000), tag: 'g'.repeat(1000), url: '/' + 'a'.repeat(5000) }));
    const n = h.shown[0]!;
    expect(n.title.length).toBeLessThanOrEqual(100);
    expect(String(n.options.body).length).toBeLessThanOrEqual(300);
    expect(String(n.options.tag).length).toBeLessThanOrEqual(64);
    expect(n.options.data).toEqual({ url: '/' });

    const h2 = load();
    await h2.push(JSON.stringify({ title: 'a\u0000b\u0007c\nd', body: 'строка1\nстрока2\u0000\u001b', tag: 't\nag' }));
    expect(h2.shown[0]!.title).toBe('a b c d');
    expect(h2.shown[0]!.options.body).toBe('строка1\nстрока2');
    expect(h2.shown[0]!.options.tag).toBe('t ag');

    const h3 = load();
    await h3.push(JSON.stringify({ title: 'a'.repeat(99) + '😀😀😀' }));
    const t = h3.shown[0]!.title;
    expect(t.length).toBeLessThanOrEqual(100);
    const lastCode = t.charCodeAt(t.length - 1);
    expect(lastCode >= 0xd800 && lastCode <= 0xdbff, 'в конце не должно остаться половины пары').toBe(false);
  });

  it('те же правила пути, что в src/push/navigate.ts: хорошие проходят, вредные превращаются в «/»', async () => {
    for (const p of [...GOOD_PATHS, ...BAD_PATHS.filter((x): x is string => typeof x === 'string')]) {
      const h = load();
      await h.push(JSON.stringify({ title: 'T', url: p }));
      expect((h.shown[0]!.options.data as { url: string }).url, JSON.stringify(p)).toBe(safeAppPath(p));
    }
    // и не-строки, которые умеет нести JSON
    for (const p of [null, 1, true, {}, [], ['/x']]) {
      const h = load();
      await h.push(JSON.stringify({ title: 'T', url: p }));
      expect((h.shown[0]!.options.data as { url: string }).url).toBe('/');
    }
  });

  it('если showNotification с параметрами отказал — показывается хотя бы голый заголовок (уведомление обязательно)', async () => {
    const seen: Array<[string, unknown]> = [];
    let first = true;
    const h = load([], {
      showNotification: async (title, options) => {
        seen.push([title, options]);
        if (first) {
          first = false;
          throw new Error('отказ');
        }
      },
    });
    await h.push(JSON.stringify({ title: 'Платёж', body: 'x' }));
    expect(seen).toHaveLength(2);
    expect(seen[1]![0]).toBe(FALLBACK);
  });

  it('showNotification бросает сразу (не промис) — всё равно запасное уведомление', async () => {
    let calls = 0;
    const h = load([], {
      showNotification: (() => {
        calls++;
        if (calls === 1) throw new Error('синхронный отказ');
        return Promise.resolve();
      }) as never,
    });
    await h.push(JSON.stringify({ title: 'Платёж' }));
    expect(calls).toBe(2);
  });
});

describe('public/push-handler.js: нажатие на уведомление', () => {
  it('окон приложения нет — открывает новое: адрес приложения + «#» + путь', async () => {
    const h = load([]);
    const n = await h.click({ url: '/debts/abc' });
    expect(n.close).toHaveBeenCalledTimes(1);
    expect(h.self.clients.openWindow).toHaveBeenCalledTimes(1);
    expect(h.self.clients.openWindow).toHaveBeenCalledWith(`${SCOPE}#/debts/abc`);
  });

  it('окно приложения открыто — переходим в нём и выводим вперёд, новое не открываем', async () => {
    const w = win(`${SCOPE}#/transactions`);
    const h = load([w]);
    await h.click({ url: '/recurring' });
    expect(w.navigate).toHaveBeenCalledWith(`${SCOPE}#/recurring`);
    expect(w.focus).toHaveBeenCalledTimes(1);
    expect(h.self.clients.openWindow).not.toHaveBeenCalled();
    expect(w.postMessage).not.toHaveBeenCalled();
  });

  it('несколько окон: берём то, на которое смотрят; чужие вкладки (другой адрес) не трогаем', async () => {
    const foreign = win('https://finora.example/other/#/x', { focused: true });
    const hidden = win(`${SCOPE}#/a`, { visibilityState: 'hidden' });
    const focused = win(`${SCOPE}#/b`, { focused: true });
    const h = load([foreign, hidden, focused]);
    await h.click({ url: '/' });
    expect(focused.navigate).toHaveBeenCalledTimes(1);
    expect(hidden.navigate).not.toHaveBeenCalled();
    expect(foreign.navigate).not.toHaveBeenCalled();
    expect(foreign.focus).not.toHaveBeenCalled();
  });

  it('открыта только чужая вкладка — приложение открывается новым окном', async () => {
    const h = load([win('https://evil.example/#/x'), win('https://finora.example/app-other/')]);
    await h.click({ url: '/' });
    expect(h.self.clients.openWindow).toHaveBeenCalledWith(`${SCOPE}#/`);
  });

  it('вредный адрес в уведомлении превращается в «#/», наружу не уводит ни в окне, ни в новом', async () => {
    for (const evil of ['//evil.com', 'javascript:alert(1)', 'https://evil', '\\evil', '/ok\nbad', '/x#y', 5, null, undefined, { u: 1 }]) {
      const w = win(`${SCOPE}#/a`);
      const h1 = load([w]);
      await h1.click({ url: evil });
      expect(w.navigate, String(evil)).toHaveBeenCalledWith(`${SCOPE}#/`);
      const h2 = load([]);
      await h2.click({ url: evil });
      expect(h2.self.clients.openWindow, String(evil)).toHaveBeenCalledWith(`${SCOPE}#/`);
    }
    // и сама data может быть пустой или странной
    for (const data of [undefined, null, 'строка', 7]) {
      const h = load([]);
      await h.click(data);
      expect(h.self.clients.openWindow).toHaveBeenCalledWith(`${SCOPE}#/`);
    }
  });

  it('воркер не управляет окном (navigate отказал или вернул null) — окну отправляется сообщение «перейди сам» с проверенным путём', async () => {
    const rejecting = win(`${SCOPE}#/a`, { navigate: vi.fn(async () => Promise.reject(new TypeError('нельзя'))) });
    const h = load([rejecting]);
    await h.click({ url: '/debts/1' });
    expect(rejecting.postMessage).toHaveBeenCalledWith({ type: MSG_NAVIGATE, path: '/debts/1' });
    expect(rejecting.focus).toHaveBeenCalled();
    expect(h.self.clients.openWindow).not.toHaveBeenCalled();

    const nulling = win(`${SCOPE}#/a`, { navigate: vi.fn(async () => null) });
    const h2 = load([nulling]);
    await h2.click({ url: '//evil.com' });
    expect(nulling.postMessage).toHaveBeenCalledWith({ type: MSG_NAVIGATE, path: '/' });
  });

  it('ничего не падает: focus отказал, matchAll бросил, openWindow отказал', async () => {
    const w = win(`${SCOPE}#/a`, { focus: vi.fn(async () => Promise.reject(new Error('нельзя вывести вперёд'))) });
    await expect(load([w]).click({ url: '/' })).resolves.toBeTruthy();
    expect(w.navigate).toHaveBeenCalled();

    const broken = load([], { matchAll: () => Promise.reject(new Error('нет доступа')) });
    await broken.click({ url: '/recurring' });
    expect(broken.self.clients.openWindow).toHaveBeenCalledWith(`${SCOPE}#/recurring`);

    const noOpen = load([], { openWindow: () => Promise.reject(new Error('нужен жест')) });
    await expect(noOpen.click({ url: '/' })).resolves.toBeTruthy();
  });
});

describe('public/push-handler.js: pushsubscriptionchange и состав файла', () => {
  it('браузер сменил подписку: сообщаем окнам приложения (только своим), сами не подписываемся', async () => {
    const mine = win(`${SCOPE}#/a`);
    const foreign = win('https://evil.example/');
    const h = load([mine, foreign]);
    await h.dispatch('pushsubscriptionchange', {});
    expect(mine.postMessage).toHaveBeenCalledWith({ type: MSG_SUBSCRIPTION_CHANGED });
    expect(foreign.postMessage).not.toHaveBeenCalled();
    expect(h.self.registration.showNotification).not.toHaveBeenCalled();
  });

  it('matchAll отказал — тихо, без падения', async () => {
    const h = load([], { matchAll: () => Promise.reject(new Error('x')) });
    await expect(h.dispatch('pushsubscriptionchange', {})).resolves.toBeUndefined();
  });

  it('файл без зависимостей и без нового синтаксиса (ES5): ни стрелок, ни let/const, ни async/await, ни import/export, ни шаблонных строк', () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/=>/);
    expect(code).not.toMatch(/\b(let|const|async|await|class|import|export|require)\b/);
    expect(code).not.toMatch(/`/);
    expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|localStorage|indexedDB|eval\s*\(|new Function/);
    // и он по-настоящему исполняется как обычный скрипт
    expect(() => new vm.Script(SOURCE)).not.toThrow();
  });

  it('иконки, на которые он ссылается, существуют', () => {
    expect(SOURCE).toContain("'pwa-192.png'");
    expect(() => readFileSync(new URL('../../public/pwa-192.png', import.meta.url))).not.toThrow();
  });
});
