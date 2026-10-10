import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { makeTestDeps, renderAppRoot } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { balancesOf, tapAmount, liveTxs, allTxs } from './__fixtures__/opsKit';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

afterEach(() => vi.restoreAllMocks());

async function openApp(path = '/') {
  const td = makeTestDeps();
  renderAppRoot(<AppRoutes />, { path, deps: td.deps });
  await findByRole('heading', { name: path === '/transactions' ? 'Операции' : 'Главная', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const addLink = () => screen.getAllByRole('link', { name: /Добавить операцию/ })[0] as HTMLElement;

describe('весь путь: ввод → отмена → правка → удаление → возврат', () => {
  it('«Отменить» после сохранения убирает операцию, а остатки возвращаются', async () => {
    const td = await openApp('/');
    const before = [...(await balancesOf(td)).values()];
    await user.click(addLink());
    await findByRole('dialog', { name: 'Новая операция' });
    await tapAmount('25');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новая операция' })).toBeNull());
    expect(await liveTxs(td)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(async () => expect(await liveTxs(td)).toHaveLength(0));
    expect([...(await balancesOf(td)).values()]).toEqual(before);
    // операция не стёрта физически: удаление мягкое
    expect(await allTxs(td)).toHaveLength(1);
  });

  it('после сохранения шит закрывается на ту же страницу, где был, а «назад» не уводит из приложения', async () => {
    const td = await openApp('/transactions');
    await user.click(addLink());
    await findByRole('dialog', { name: 'Новая операция' });
    await tapAmount('3');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новая операция' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Операции', level: 1 })).toBeInTheDocument();
    expect(await liveTxs(td)).toHaveLength(1);
  });

  it('удаление из правки и «Отменить» возвращают ту же операцию с теми же полями', async () => {
    const td = await openApp('/transactions');
    await user.click(addLink());
    await findByRole('dialog', { name: 'Новая операция' });
    await tapAmount('12,5');
    await user.type(screen.getByRole('textbox', { name: /^Заметка/ }), 'хлеб');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новая операция' })).toBeNull());
    const [orig] = await liveTxs(td);
    await user.click(await waitFor(() => screen.getByText(/хлеб/)));
    await findByRole('dialog', { name: 'Правка операции' });
    await user.click(screen.getByRole('button', { name: 'Удалить операцию' }));
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Удалить' })));
    await waitFor(async () => expect(await liveTxs(td)).toHaveLength(0));
    // второй «Отменить» среди тостов «Сохранено» и «Операция удалена»
    const undo = await waitFor(() => screen.getAllByRole('button', { name: 'Отменить' }));
    await user.click(undo[undo.length - 1] as HTMLElement);
    await waitFor(async () => expect(await liveTxs(td)).toHaveLength(1));
    const [back] = await liveTxs(td);
    expect(back).toMatchObject({ id: orig?.id, amountMinor: orig?.amountMinor, note: 'хлеб', occurredOn: orig?.occurredOn });
  });
});

describe('двойное касание «+» (шит ещё не успел нарисоваться)', () => {
  it('после «Сохранить» шит закрывается, а не остаётся открытым с уже сохранённой суммой', async () => {
    const { fire } = await import('@/components/testUtils');
    const td = await openApp('/');
    const link = addLink();
    const click = () => fire(link, new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    click();
    click(); // второе касание, пока шит грузится
    await findByRole('dialog', { name: 'Новая операция' });
    await tapAmount('25');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect(await liveTxs(td)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByRole('dialog', { name: 'Новая операция' })).toBeNull();
  });

  it('если шит всё же остался открытым, повторное «Сохранить» не должно молча вернуть старую операцию: либо шит закрыт и операция одна, либо сохранено то, что на экране', async () => {
    const { fire } = await import('@/components/testUtils');
    const td = await openApp('/');
    const link = addLink();
    const click = () => fire(link, new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    click();
    click();
    await findByRole('dialog', { name: 'Новая операция' });
    await tapAmount('25');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect(await liveTxs(td)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 200));
    if (screen.queryByRole('dialog', { name: 'Новая операция' })) {
      // человек видит открытый шит, дописывает «5» и нажимает «Сохранить» ещё раз
      await tapAmount('5');
      const shown = (screen.getByRole('textbox', { name: /^Сумма/ }) as HTMLInputElement).value;
      await user.click(screen.getByRole('button', { name: 'Сохранить' }));
      await new Promise((r) => setTimeout(r, 200));
      const minor = Math.round(Number(shown.replace(/\s/g, '').replace(',', '.')) * 100);
      expect((await liveTxs(td)).map((t) => t.amountMinor)).toContain(minor);
    } else {
      expect((await liveTxs(td)).map((t) => t.amountMinor)).toEqual([2500]);
    }
  });
});
