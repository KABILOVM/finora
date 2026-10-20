import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, user } from '@/components/testUtils';
import { HideAmountsProvider, useHideAmounts } from './hideAmounts';
import { MoneyText } from './MoneyText';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

function Toggle() {
  const { hidden, toggle } = useHideAmounts();
  return (
    <button type="button" onClick={toggle}>
      {hidden ? 'скрыто' : 'видно'}
    </button>
  );
}

describe('«Скрыть суммы» действует на каждую MoneyText', () => {
  it('без провайдера суммы видны; с выбором «скрыто» вместо цифр — «Сумма скрыта»', () => {
    const { unmount } = render(<MoneyText minor={12_345} currency="TJS" tone="none" />);
    expect(document.body.textContent).toMatch(/123/);
    unmount();
    localStorage.setItem('finora-hide-balance', '1');
    render(
      <HideAmountsProvider>
        <MoneyText minor={12_345} currency="TJS" tone="none" />
      </HideAmountsProvider>,
    );
    expect(screen.getByRole('img', { name: 'Сумма скрыта' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d/);
  });

  it('переключатель меняет суммы сразу и запоминает выбор; вложенный провайдер состояния не заводит', async () => {
    render(
      <HideAmountsProvider>
        <HideAmountsProvider>
          <Toggle />
          <MoneyText minor={500} currency="TJS" tone="none" />
        </HideAmountsProvider>
      </HideAmountsProvider>,
    );
    expect(document.body.textContent).toMatch(/5/);
    await user.click(screen.getByRole('button', { name: 'видно' }));
    expect(screen.getByRole('img', { name: 'Сумма скрыта' })).toBeTruthy();
    expect(localStorage.getItem('finora-hide-balance')).toBe('1');
    await user.click(screen.getByRole('button', { name: 'скрыто' }));
    expect(screen.queryByRole('img', { name: 'Сумма скрыта' })).toBeNull();
    expect(localStorage.getItem('finora-hide-balance')).toBe('0');
  });
});
