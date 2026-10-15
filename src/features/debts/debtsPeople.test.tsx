import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { formatMinor } from '@/domain/money';
import { currentPath, LocationProbe, opsDeps, pinToday, showApp, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import DebtDetailPage from './DebtDetailPage';
import DebtsPage from './DebtsPage';
import PersonDebtsPage from './PersonDebtsPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
  delete (navigator as { share?: unknown }).share;
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const fmt = (minor: number, currency = 'TJS') => norm(formatMinor(minor, currency));
const text = (el: Element | null | undefined) => norm(el?.textContent);
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

type Setup = (s: Store) => Promise<unknown>;

/** Сумма в строке итогов человека по подписи: «Вам должны» → «500 с.» (в DOM подпись и сумма — соседние dt/dd). */
const totalRow = (cur: string, label: string): string => {
  const dt = Array.from(document.querySelectorAll(`[data-testid="person-total-${cur}"] dt`)).find((x) => text(x) === label);
  return text(dt?.nextElementSibling ?? null);
};

const lend = (s: Store, over: Partial<Parameters<Store['debts']['create']>[0]> = {}) =>
  s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', ...over });
const borrow = (s: Store, over: Partial<Parameters<Store['debts']['create']>[0]> = {}) => lend(s, { direction: 'borrowed', ...over });

function App() {
  return (
    <>
      <Routes>
        <Route path="/debts" element={<DebtsPage />} />
        <Route path="/debts/people/:key" element={<PersonDebtsPage />} />
        <Route path="/debts/:id" element={<DebtDetailPage />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <LocationProbe />
    </>
  );
}

async function open(setup: Setup | undefined, path: string, heading = 'Долги и кредиты') {
  const td = opsDeps([table()], { setup: setup ? async (s) => void (await setup(s)) : undefined });
  await showApp(<App />, td, path);
  await findByRole('heading', { name: heading, level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

describe('«Долги» → «Люди»', () => {
  it('одного человека из нескольких долгов — одна строка с итогом по валютам; регистр и «ё» не мешают', async () => {
    await open(
      async (s) => {
        await lend(s, { principalMinor: 50_000 });
        await lend(s, { counterparty: ' алишёр ', principalMinor: 20_000 });
        await borrow(s, { counterparty: 'Алишер', principalMinor: 10_000 });
        await lend(s, { counterparty: 'Зафар', principalMinor: 3_000, currency: 'USD' });
      },
      '/debts?dir=people',
    );
    const rows = Array.from(document.querySelectorAll('ul[aria-label="Люди"] > li')).map((li) => text(li));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Алишер');
    expect(rows[0]).toContain('3 долга');
    expect(rows[0]).toContain(`Взаимные долги: итого вам должны ${fmt(60_000)}`);
    expect(rows[1]).toContain('Зафар');
    expect(rows[1]).toContain(`Вам должны ${fmt(3_000, 'USD')}`);
  });

  it('переключатель: «Люди» открывает список, «Мне должны» возвращает обычный', async () => {
    await open(lend, '/debts');
    expect(screen.queryByRole('list', { name: 'Люди' })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Люди' }));
    expect(screen.getByRole('list', { name: 'Люди' })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Мне должны' }));
    expect(screen.queryByRole('list', { name: 'Люди' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Мне должны' })).toBeTruthy();
  });

  it('нет открытых долгов — понятное пустое состояние', async () => {
    await open(undefined, '/debts?dir=people');
    expect(screen.getByRole('heading', { name: 'Открытых долгов нет' })).toBeTruthy();
  });

  it('человек с просроченным долгом помечен', async () => {
    await open((s) => lend(s, { dueOn: '2026-10-01' }), '/debts?dir=people');
    expect(text(document.querySelector('ul[aria-label="Люди"]'))).toContain('Просрочено: 1');
  });

  it('новый долг на этой вкладке по умолчанию — «Я дал в долг»', async () => {
    await open(undefined, '/debts?dir=people');
    await user.click(screen.getByRole('button', { name: 'Новый долг' }));
    const dlg = await findByRole('dialog', { name: 'Новый долг' });
    expect(dlg.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain('Я дал в долг');
  });

  it('строка человека ведёт на его страницу', async () => {
    await open(lend, '/debts?dir=people');
    await user.click(screen.getByRole('link', { name: /Алишер/ }));
    await findByRole('heading', { name: 'Алишер', level: 1 });
    expect(currentPath()).toBe(`/debts/people/${encodeURIComponent('алишер')}`);
  });
});

describe('страница человека', () => {
  const path = (name: string) => `/debts/people/${encodeURIComponent(name)}`;

  it('сколько он должен мне, сколько я ему и итог; долги по направлениям', async () => {
    await open(
      async (s) => {
        await lend(s, { principalMinor: 50_000 });
        await borrow(s, { principalMinor: 20_000 });
      },
      path('алишер'),
      'Алишер',
    );
    expect(totalRow('TJS', 'Вам должны')).toBe(fmt(50_000));
    expect(totalRow('TJS', 'Вы должны')).toBe(fmt(20_000));
    expect(totalRow('TJS', 'Итого вам должны')).toBe(fmt(30_000));
    expect(screen.getByRole('list', { name: 'Мне должны' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Я должен' })).toBeTruthy();
  });

  it('адрес в другом регистре и с «ё» открывает того же человека', async () => {
    await open(lend, path('АЛИШЁР'), 'Алишер');
    expect(tid('person-totals')).not.toBeNull();
  });

  it('нет такого человека — понятное сообщение и путь назад', async () => {
    await open(lend, path('никто'), 'Человек');
    expect(screen.getByRole('heading', { name: 'Человек не найден' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'К списку долгов' })).toBeTruthy();
  });

  it('дубли: два открытых долга одного направления — кнопка «Объединить»; после объединения остаётся один долг', async () => {
    const td = await open(
      async (s) => {
        await lend(s, { principalMinor: 50_000 });
        await lend(s, { principalMinor: 20_000 });
      },
      path('алишер'),
      'Алишер',
    );
    await user.click(screen.getByRole('button', { name: 'Объединить: мне должны, TJS (2)' }));
    await findByRole('dialog', { name: 'Объединить долги' });
    await user.click(screen.getByRole('button', { name: /^Объединить: 2 долга$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Объединить долги' })).toBeNull());
    await waitFor(() => expect(totalRow('TJS', 'Вам должны')).toBe(fmt(70_000)));
    expect(screen.queryByRole('button', { name: /^Объединить: мне должны/ })).toBeNull();
    expect((await td.stores[0]!.db.debts.toArray()).filter((d) => d.deletedAt === null)).toHaveLength(1);
  });

  it('одиночные долги разных направлений — без кнопки «Объединить»', async () => {
    await open(
      async (s) => {
        await lend(s);
        await borrow(s, { principalMinor: 10_000 });
      },
      path('алишер'),
      'Алишер',
    );
    expect(screen.queryByRole('button', { name: /^Объединить:/ })).toBeNull();
  });

  it('закрытые долги — в свёрнутом блоке и в итог не входят', async () => {
    await open(
      async (s) => {
        await lend(s, { principalMinor: 10_000 });
        const closed = await lend(s, { principalMinor: 99_000 });
        await s.debts.close(closed.id);
      },
      path('алишер'),
      'Алишер',
    );
    expect(totalRow('TJS', 'Вам должны')).toBe(fmt(10_000));
    const fold = screen.getByRole('button', { name: /Закрытые · 1/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('напоминание о долге', () => {
  const path = `/debts/people/${encodeURIComponent('алишер')}`;
  const remindText = () => (document.querySelector('textarea') as HTMLTextAreaElement).value;

  it('на странице человека: окно с текстом, который можно поправить; ссылки Telegram и WhatsApp несут этот текст', async () => {
    await open((s) => lend(s, { principalMinor: 50_000, dueOn: '2026-10-25' }), path, 'Алишер');
    await user.click(screen.getByRole('button', { name: 'Напомнить о долге' }));
    await findByRole('dialog', { name: 'Напомнить: Алишер' });
    expect(remindText()).toBe('Алишер, привет! Напоминаю про долг: 500 с. Срок возврата — 25 октября. Спасибо!');

    const area = document.querySelector('textarea') as HTMLTextAreaElement;
    await user.clear(area);
    await user.type(area, 'Привет, вернёшь?');
    const wa = screen.getByRole('link', { name: 'WhatsApp' }) as HTMLAnchorElement;
    const tg = screen.getByRole('link', { name: 'Telegram' }) as HTMLAnchorElement;
    expect(wa.href).toBe(`https://wa.me/?text=${encodeURIComponent('Привет, вернёшь?')}`);
    expect(tg.href).toBe(`https://t.me/share/url?url=%20&text=${encodeURIComponent('Привет, вернёшь?')}`);
    for (const a of [wa, tg]) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toContain('noopener');
    }
  });

  it('пустой текст: отправить нельзя', async () => {
    await open(lend, path, 'Алишер');
    await user.click(screen.getByRole('button', { name: 'Напомнить о долге' }));
    await findByRole('dialog', { name: 'Напомнить: Алишер' });
    await user.clear(document.querySelector('textarea') as HTMLTextAreaElement);
    for (const name of ['WhatsApp', 'Telegram']) {
      expect(screen.queryByRole('link', { name })).toBeNull();
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByRole('button', { name: 'Скопировать текст' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('«Поделиться…» есть, только если браузер умеет; тогда вызывает системное окно с текстом', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    await open(lend, path, 'Алишер');
    await user.click(screen.getByRole('button', { name: 'Напомнить о долге' }));
    await findByRole('dialog', { name: 'Напомнить: Алишер' });
    await user.click(screen.getByRole('button', { name: 'Поделиться…' }));
    expect(share).toHaveBeenCalledWith({ text: remindText() });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Напомнить: Алишер' })).toBeNull());
  });

  it('без «Поделиться»: кнопки нет, ссылки есть', async () => {
    await open(lend, path, 'Алишер');
    await user.click(screen.getByRole('button', { name: 'Напомнить о долге' }));
    await findByRole('dialog', { name: 'Напомнить: Алишер' });
    expect(screen.queryByRole('button', { name: 'Поделиться…' })).toBeNull();
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeTruthy();
  });

  it('человек отменил системное окно — окно напоминания остаётся, ошибки нет', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError'));
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    await open(lend, path, 'Алишер');
    await user.click(screen.getByRole('button', { name: 'Напомнить о долге' }));
    await findByRole('dialog', { name: 'Напомнить: Алишер' });
    await user.click(screen.getByRole('button', { name: 'Поделиться…' }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(screen.getByRole('dialog', { name: 'Напомнить: Алишер' })).toBeTruthy();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('напоминание только о долге «мне должны»: у долга «я должен» кнопки нет', async () => {
    await open(borrow, path, 'Алишер');
    expect(screen.queryByRole('button', { name: 'Напомнить о долге' })).toBeNull();
  });

  it('на странице долга: кнопка есть у «мне должны», нет у «я должен» и у закрытого', async () => {
    let id = '';
    await open(async (s) => void (id = (await lend(s)).id), '/debts');
    await user.click(screen.getByRole('link', { name: /^Алишер/ }));
    await findByRole('heading', { name: 'Алишер', level: 1 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Напомнить о долге' })).toBeTruthy());
    expect(id).not.toBe('');
  });
});

describe('со страницы долга — к человеку', () => {
  it('ссылка «Все долги: …» появляется, если у человека есть другие открытые долги', async () => {
    let first = '';
    await open(
      async (s) => {
        first = (await lend(s)).id;
        await borrow(s, { principalMinor: 10_000 });
      },
      '/debts',
    );
    await user.click(screen.getByRole('link', { name: /^Алишер/ }));
    const link = await waitFor(() => screen.getByRole('link', { name: 'Все долги: Алишер' }));
    await user.click(link);
    await findByRole('heading', { name: 'Алишер', level: 1 });
    expect(currentPath()).toBe(`/debts/people/${encodeURIComponent('алишер')}`);
    expect(first).not.toBe('');
  });

  it('единственный долг человека — ссылки нет', async () => {
    await open(lend, '/debts');
    await user.click(screen.getByRole('link', { name: /^Алишер/ }));
    await findByRole('heading', { name: 'Алишер', level: 1 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Напомнить о долге' })).toBeTruthy());
    expect(screen.queryByRole('link', { name: /^Все долги: / })).toBeNull();
  });
});
