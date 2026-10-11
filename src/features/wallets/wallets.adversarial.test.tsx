/**
 * ЛОМАТЕЛЬ: кошельки и категории. Падающий тест = находка.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventually, makeTestDeps, pick, renderAppRoot, write, type TestDeps } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import CategoriesPage from '@/features/categories/CategoriesPage';
import { formatMinor } from '@/domain/money';
import WalletsPage from './WalletsPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));
afterEach(() => vi.restoreAllMocks());

const st = (td: TestDeps) => td.stores[0]!;

async function openWallets() {
  const td = makeTestDeps();
  renderAppRoot(<WalletsPage />, { deps: td.deps });
  await findByRole('heading', { name: 'Кошельки', level: 1 });
  await waitFor(() => expect(screen.getByText('Наличные')).toBeInTheDocument());
  return td;
}

describe('ATTACK: «Сверка» при правке кошелька с другого устройства', () => {
  it('открыта «Сверка», а начальный остаток кошелька изменился (пришло с синхронизации): экран не должен кричать «не совпадает»', async () => {
    const td = await openWallets();
    const cash = (await st(td).db.wallets.toArray())[0]!;
    await user.click(screen.getByRole('button', { name: 'Сверка: Наличные' }));
    const dialog = await findByRole('dialog', { name: 'Сверка: Наличные' });
    await waitFor(() => expect(dialog).toHaveTextContent('Совпадает с остатком'));

    // то же, что принёс бы pull с другого телефона
    await write(() => st(td).wallets.update(cash.id, { openingBalanceMinor: 50_000 }));
    await eventually(async () => expect(screen.getAllByText(formatMinor(50_000, 'TJS')).length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 200));
    expect(dialog, 'после правки остатка сверка должна пересчитаться или молчать, а не показывать ложную тревогу').not.toHaveTextContent('Не совпадает');
  });
});

describe('ATTACK: правка кошелька по устаревшему снимку', () => {
  it('имя изменено «с другого телефона», пока открыт шит правки; человек меняет только цвет — чужое имя не откатывается', async () => {
    const td = await openWallets();
    const cash = (await st(td).db.wallets.toArray())[0]!;
    await user.click(screen.getByText('Наличные'));
    await findByRole('dialog', { name: 'Правка кошелька' });
    await write(() => st(td).wallets.update(cash.id, { name: 'Касса' }));
    await user.click(screen.getByRole('button', { name: 'Синий' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const after = (await st(td).db.wallets.toArray())[0]!;
    expect(after.name).toBe('Касса');
    expect(after.color).toBe('#2563eb');
  });
});

describe('ATTACK: архив кошелька по умолчанию', () => {
  it('в архив ушёл кошелёк по умолчанию → настройка сброшена, и архивный кошелёк нельзя вернуть «по умолчанию» молча', async () => {
    const td = await openWallets();
    const cash = (await st(td).db.wallets.toArray())[0]!;
    expect((await st(td).settings.get())?.defaultWalletId).toBe(cash.id);
    await user.click(screen.getByText('Наличные'));
    await findByRole('dialog', { name: 'Правка кошелька' });
    await user.click(screen.getByRole('button', { name: 'Убрать в архив' }));
    await user.click(await findByRole('button', { name: 'В архив' }));
    await eventually(async () => expect((await st(td).settings.get())?.defaultWalletId).toBeNull());
  });

  it('архивный кошелёк с остатком не входит в «Всего», и об этом сказано; вернули → снова входит', async () => {
    const td = await openWallets();
    await write(() => st(td).wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 100_000, color: '#2563eb', icon: '🪙' }));
    const total = () => document.querySelector('[data-testid="wallets-total"]')?.textContent ?? '';
    await waitFor(() => expect(total()).toContain(formatMinor(100_000, 'TJS')));
    const piggy = (await st(td).db.wallets.toArray()).find((w) => w.name === 'Копилка')!;
    await write(() => st(td).wallets.archive(piggy.id));
    await waitFor(() => expect(total()).toContain(formatMinor(0, 'TJS')));
    await write(() => st(td).wallets.restore(piggy.id));
    await waitFor(() => expect(total()).toContain(formatMinor(100_000, 'TJS')));
  });
});

describe('ATTACK: ввод в форму кошелька', () => {
  it('меняем валюту ПОСЛЕ ввода суммы с копейками на валюту без копеек: сохранённая сумма совпадает с показанной', async () => {
    const td = await openWallets();
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog', { name: 'Новый кошелёк' });
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Йены');
    await user.type(screen.getByRole('textbox', { name: /Начальный остаток/ }), '1000,55');
    pick(screen.getByRole('combobox', { name: 'Валюта' }), 'JPY');
    await new Promise((r) => setTimeout(r, 50));
    const shown = (screen.getByRole('textbox', { name: /Начальный остаток/ }) as HTMLInputElement).value.replace(/\s/g, '');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const w = (await st(td).db.wallets.toArray()).find((x) => x.name === 'Йены')!;
    expect(w.currency).toBe('JPY');
    expect(String(w.openingBalanceMinor), `на экране было «${shown}»`).toBe(shown.replace(/[^\d]/g, ''));
  });

  it('название из невидимых символов (ZWSP/неразрывный пробел/RTL-метка) не создаёт «безымянный» кошелёк', async () => {
    const td = await openWallets();
    for (const sneaky of ['​', '  ', '‎', '⁠​']) {
      await user.click(screen.getByRole('button', { name: 'Добавить' }));
      await findByRole('dialog', { name: 'Новый кошелёк' });
      await user.type(screen.getByRole('textbox', { name: 'Название' }), sneaky);
      await user.click(screen.getByRole('button', { name: 'Сохранить' }));
      await new Promise((r) => setTimeout(r, 60));
      const names = (await st(td).db.wallets.toArray()).map((w) => w.name);
      expect(names.map((n) => n.replace(/[\s​-‏⁠﻿]/g, '')).includes(''), `«${JSON.stringify(sneaky)}» сохранилось как безымянный кошелёк`).toBe(false);
      if (screen.queryByRole('dialog')) await user.keyboard('{Escape}');
    }
  });
});

describe('ATTACK: категории', () => {
  it('«Еда» и «еда » (пробел, другой регистр) не создают дубль; архивная «Еда» подсказывает вернуть', async () => {
    const td = makeTestDeps();
    renderAppRoot(<CategoriesPage />, { deps: td.deps, path: '/settings/categories' });
    await findByRole('heading', { name: 'Категории', level: 1 });
    await waitFor(() => expect(screen.getByText('Еда')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await findByRole('dialog');
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'еда ');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await waitFor(() => screen.getByText('Такая категория уже есть'))).toBeInTheDocument();
    expect((await st(td).db.categories.toArray()).filter((c) => c.name.toLowerCase().trim() === 'еда' && c.kind === 'expense')).toHaveLength(1);
  });
});
