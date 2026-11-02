import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { COLOR_CHOICES } from '@/features/wallets/walletUi';
import { opsDeps, pinToday, showApp, storeOf, table, unpinToday } from '@/features/transactions/__fixtures__/opsKit';
import DebtsPage from './DebtsPage';
import { initialsOf, personColor } from './personAvatar';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

type Setup = (s: Store) => Promise<unknown>;
const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const byId = (id: string) => document.querySelector(`[data-testid="${id}"]`);

async function openPage(setup: Setup, path = '/debts') {
  const td = opsDeps([table()], { setup: async (s: Store) => void (await setup(s)) });
  await showApp(<DebtsPage />, td, path);
  await findByRole('heading', { name: 'Долги', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}
const lend = (s: Store, over: Partial<Parameters<Store['debts']['create']>[0]> = {}) =>
  s.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', ...over });
const cashOf = async (s: Store) => (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;

describe('кружок человека', () => {
  it('инициалы: первые буквы первых двух слов, прописные', () => {
    expect(initialsOf('Алишер')).toBe('А');
    expect(initialsOf('алишер каримов')).toBe('АК');
    expect(initialsOf('  Мама   и  папа ')).toBe('МИ');
    expect(initialsOf('Ёлкин')).toBe('Ё');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
  });

  it('инициалы не рвут эмодзи пополам', () => {
    expect(initialsOf('😀 Друг')).toBe('😀Д');
  });

  it('цвет один и тот же у одного человека (без учёта регистра, «ё» и пробелов) и всегда из набора приложения', () => {
    expect(personColor('Алишер')).toBe(personColor('  алишер '));
    expect(personColor('Артём')).toBe(personColor('артем'));
    const palette = COLOR_CHOICES.map((c) => c.value);
    for (const n of ['Алишер', 'Бобур', 'Вали', 'Джон', '', '😀', 'Очень Длинное Имя Человека']) expect(palette).toContain(personColor(n));
  });

  it('цвета у разных людей разные (набор не сводится к одному цвету)', () => {
    const names = ['Алишер', 'Бобур', 'Вали', 'Гулнора', 'Достон', 'Едгор', 'Зарина', 'Исмоил', 'Камол', 'Лола'];
    expect(new Set(names.map(personColor)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('экран «Долги»: вид', () => {
  it('строка с кружком человека: буквы не попадают в текст строки, а сам кружок скрыт от скринридера', async () => {
    await openPage(async (s) => void (await lend(s, { counterparty: 'Алишер Каримов' })));
    const link = screen.getByRole('link', { name: /^Алишер Каримов/ });
    expect(norm(link.textContent).startsWith('Алишер Каримов')).toBe(true);
    const avatar = link.querySelector('[data-initials]');
    expect(avatar?.getAttribute('data-initials')).toBe('АК');
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
    expect(avatar?.textContent).toBe('');
  });

  it('просроченный долг: цветная полоска слева и красная полоса погашения; обычный — без них', async () => {
    await openPage(async (s) => {
      await lend(s, { counterparty: 'Давно', dueOn: '2026-10-12' });
      await lend(s, { counterparty: 'Потом', dueOn: '2026-12-01' });
    });
    const late = screen.getByRole('link', { name: /^Давно/ });
    const calm = screen.getByRole('link', { name: /^Потом/ });
    expect(late.className).toContain('border-danger');
    expect(calm.className).toContain('border-transparent');
    expect(late.querySelector('[role="progressbar"] > div')?.className).toContain('bg-danger');
    expect(calm.querySelector('[role="progressbar"] > div')?.className).toContain('bg-brand');
  });

  it('горящий срок (до трёх дней) — жёлтая полоска', async () => {
    await openPage(async (s) => void (await lend(s, { counterparty: 'Завтра', dueOn: '2026-10-16' })));
    expect(screen.getByRole('link', { name: /^Завтра/ }).className).toContain('border-warning');
  });

  describe('карточка итога', () => {
    it('цветная: сколько открытых долгов, и ближайший срок, когда просрочки нет', async () => {
      await openPage(async (s) => {
        await lend(s, { counterparty: 'Скоро', dueOn: '2026-10-20' });
        await lend(s, { counterparty: 'Позже', dueOn: '2026-11-20' });
        await lend(s, { counterparty: 'Бессрочный' });
      });
      const totals = byId('debts-totals')!;
      expect(totals.className).toContain('from-hero-from');
      const text = norm(totals.textContent);
      expect(text).toContain('3 открытых долга');
      expect(text).toContain('Ближайший срок: 20.10 · через 5 дней');
      expect(text).not.toContain('Просрочено');
    });

    it('есть просрочка — показываем её, а ближайший срок не дублируем', async () => {
      await openPage(async (s) => {
        await lend(s, { counterparty: 'Давно', dueOn: '2026-10-12' });
        await lend(s, { counterparty: 'Скоро', dueOn: '2026-10-20' });
      });
      const text = norm(byId('debts-totals')!.textContent);
      expect(text).toContain('Просрочено: 1 долг');
      expect(text).not.toContain('Ближайший срок');
    });

    it('один открытый долг — слово в единственном числе', async () => {
      await openPage(async (s) => void (await lend(s)));
      expect(norm(byId('debts-totals')!.textContent)).toContain('1 открытый долг');
    });

    it('общая полоса «Возвращено N%»: только когда уже что-то вернули и валюта одна', async () => {
      await openPage(async (s) => {
        const cash = await cashOf(s);
        const a = await lend(s, { counterparty: 'Алишер', principalMinor: 50_000 });
        await lend(s, { counterparty: 'Бобур', principalMinor: 50_000 });
        await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 25_000, occurredOn: '2026-10-05', debtId: a.id });
      });
      // вернули 250 из 1000: 25%
      const bar = screen.getByRole('progressbar', { name: 'Итого: Возвращено 25%' });
      expect(bar.getAttribute('aria-valuenow')).toBe('25');
      expect(norm(byId('debts-totals')!.textContent)).toContain('Возвращено 25%');
    });

    it('ничего ещё не вернули — общей полосы нет', async () => {
      await openPage(async (s) => void (await lend(s)));
      expect(screen.queryByRole('progressbar', { name: /^Итого/ })).toBeNull();
    });

    it('две валюты: общей полосы нет (валюты не складываем)', async () => {
      await openPage(async (s) => {
        const cash = await cashOf(s);
        const a = await lend(s, { counterparty: 'Алишер' });
        await lend(s, { counterparty: 'Джон', currency: 'USD' });
        await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 10_000, occurredOn: '2026-10-05', debtId: a.id });
      });
      expect(screen.queryByRole('progressbar', { name: /^Итого/ })).toBeNull();
    });

    it('«Я должен»: подпись и слова про выплату', async () => {
      await openPage(async (s) => {
        const cash = await cashOf(s);
        const d = await s.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-10-01' });
        await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 20_000, occurredOn: '2026-10-05', debtId: d.id });
      }, '/debts?dir=borrowed');
      const text = norm(byId('debts-totals')!.textContent);
      expect(text).toContain('Вы должны всего');
      expect(text).toContain('Выплачено 20%');
    });
  });

  describe('разбивка по срокам', () => {
    it('есть просроченные и остальные: над группами подписи со счётом, а строки остаются одним списком', async () => {
      await openPage(async (s) => {
        await lend(s, { counterparty: 'Давно', dueOn: '2026-10-12' });
        await lend(s, { counterparty: 'Завтра', dueOn: '2026-10-16' });
        await lend(s, { counterparty: 'Потом', dueOn: '2026-12-01' });
        await lend(s, { counterparty: 'Бессрочный' });
      });
      expect(norm(byId('debts-bucket-overdue')?.textContent)).toBe('Просрочено · 1');
      expect(norm(byId('debts-bucket-soon')?.textContent)).toBe('Скоро срок · 1');
      expect(norm(byId('debts-bucket-later')?.textContent)).toBe('Остальные · 2');
      const list = screen.getByRole('list', { name: 'Мне должны' });
      // подписи не считаются строками списка, строки идут в том же порядке по срокам
      expect(list.querySelectorAll('a')).toHaveLength(4);
      expect(list.querySelectorAll('li:not([role="presentation"])')).toHaveLength(4);
      expect(list.querySelectorAll('li[role="presentation"]')).toHaveLength(3);
      expect(Array.from(list.querySelectorAll('a')).map((a) => norm(a.querySelector('.line-clamp-2')?.textContent))).toEqual(['Давно', 'Завтра', 'Потом', 'Бессрочный']);
    });

    it('в списке одна кучка — подписей нет', async () => {
      await openPage(async (s) => {
        await lend(s, { counterparty: 'Потом', dueOn: '2026-12-01' });
        await lend(s, { counterparty: 'Бессрочный' });
      });
      expect(byId('debts-bucket-later')).toBeNull();
      expect(byId('debts-bucket-overdue')).toBeNull();
    });

    it('только просроченные — подписей тоже нет (всё и так горит)', async () => {
      await openPage(async (s) => {
        await lend(s, { counterparty: 'Давно', dueOn: '2026-10-12' });
        await lend(s, { counterparty: 'Ещё давнее', dueOn: '2026-10-01' });
      });
      expect(byId('debts-bucket-overdue')).toBeNull();
    });
  });

  it('вкладка «Люди»: у каждого человека свой кружок', async () => {
    const td = await openPage(async (s) => {
      await lend(s, { counterparty: 'Алишер' });
      await lend(s, { counterparty: 'Бобур' });
    }, '/debts?dir=people');
    expect(storeOf(td)).toBeTruthy();
    const links = screen.getAllByRole('link', { name: /^(Алишер|Бобур)/ });
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.querySelector('[data-initials]')?.getAttribute('data-initials'))).toEqual(['А', 'Б']);
  });
});
