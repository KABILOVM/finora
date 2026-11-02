import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';
import { render, screen, user } from './testUtils';

const stubPointer = (coarse: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query.includes('coarse'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
afterEach(() => vi.unstubAllGlobals());

function Harness({ explicit = false, keypad = false }: { explicit?: boolean; keypad?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Открыть</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Кошелёк">
        {keypad ? <input aria-label="Сумма" inputMode="none" /> : null}
        <input aria-label="Название" {...(explicit ? { 'data-autofocus': true } : {})} />
        <button>Сохранить</button>
      </Sheet>
    </>
  );
}

const openIt = () => user.click(screen.getByRole('button', { name: 'Открыть' }));
const dialog = () => screen.getByRole('dialog', { name: 'Кошелёк' });

describe('окно на телефоне не выдвигает клавиатуру само', () => {
  it('палец: первое поле «Название» не получает фокус — он на самом окне; нажали на поле — фокус в поле', async () => {
    stubPointer(true);
    render(<Harness />);
    await openIt();
    expect(screen.getByRole('textbox', { name: 'Название' })).not.toHaveFocus();
    expect(dialog()).toHaveFocus();
    await user.click(screen.getByRole('textbox', { name: 'Название' }));
    expect(screen.getByRole('textbox', { name: 'Название' })).toHaveFocus();
  });

  it('палец: поле с data-autofocus тоже не получает фокус', async () => {
    stubPointer(true);
    render(<Harness explicit />);
    await openIt();
    expect(screen.getByRole('textbox', { name: 'Название' })).not.toHaveFocus();
    expect(dialog()).toHaveFocus();
  });

  it('палец: поле со своей цифровой клавиатурой (inputmode="none") фокус получает — клавиатуры системы не будет', async () => {
    stubPointer(true);
    render(<Harness keypad />);
    await openIt();
    expect(screen.getByRole('textbox', { name: 'Сумма' })).toHaveFocus();
  });

  it('мышь: курсор сразу в первом поле, как и раньше', async () => {
    stubPointer(false);
    render(<Harness />);
    await openIt();
    expect(screen.getByRole('textbox', { name: 'Название' })).toHaveFocus();
  });

  it('палец: после закрытия курсор не возвращается в текстовое поле, откуда окно открыли', async () => {
    stubPointer(true);
    function WithField() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <input aria-label="Поиск" onFocus={() => setOpen(true)} />
          <Sheet open={open} onClose={() => setOpen(false)} title="Кошелёк">
            <button>Сохранить</button>
          </Sheet>
        </>
      );
    }
    render(<WithField />);
    await user.click(screen.getByRole('textbox', { name: 'Поиск' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('textbox', { name: 'Поиск' })).not.toHaveFocus();
  });
});
