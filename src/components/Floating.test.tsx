import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Floating, useDismiss } from './Floating';
import { Sheet } from './Sheet';
import { fire, render, screen, user } from './testUtils';

function Demo({ onSheetClose = () => {} }: { onSheetClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), box);
  return (
    <Sheet open onClose={onSheetClose} title="Окно">
      <div ref={box} className="relative">
        <button onClick={() => setOpen((v) => !v)}>Открыть</button>
        {open && (
          <Floating>
            <button>Внутри</button>
          </Floating>
        )}
      </div>
      <button>Снаружи</button>
    </Sheet>
  );
}

const inside = () => screen.queryByRole('button', { name: 'Внутри' });

describe('Floating + useDismiss', () => {
  it('панель открывается поверх формы и не закрывается от тапа внутри', async () => {
    render(<Demo />);
    await user.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(inside()).not.toBeNull();
    fire(screen.getByRole('button', { name: 'Внутри' }), new Event('pointerdown', { bubbles: true }));
    expect(inside()).not.toBeNull();
  });

  it('тап мимо закрывает панель', async () => {
    render(<Demo />);
    await user.click(screen.getByRole('button', { name: 'Открыть' }));
    fire(screen.getByRole('button', { name: 'Снаружи' }), new Event('pointerdown', { bubbles: true }));
    expect(inside()).toBeNull();
  });

  it('Esc закрывает только панель, а окно под ней остаётся', async () => {
    const onSheetClose = vi.fn();
    render(<Demo onSheetClose={onSheetClose} />);
    await user.click(screen.getByRole('button', { name: 'Открыть' }));
    fire(document.body, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(inside()).toBeNull();
    expect(onSheetClose).not.toHaveBeenCalled();
    fire(document.body, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onSheetClose).toHaveBeenCalled();
  });

  it('поверх окна с панелью открыт диалог: Esc закрывает диалог, а панель под ним остаётся', async () => {
    const onDialogClose = vi.fn();
    function WithDialog() {
      const [open, setOpen] = useState(true);
      const box = useRef<HTMLDivElement>(null);
      useDismiss(open, () => setOpen(false), box);
      return (
        <>
          <Sheet open onClose={() => {}} title="Окно">
            <div ref={box} className="relative">
              {open && (
                <Floating>
                  <button>Внутри</button>
                </Floating>
              )}
            </div>
          </Sheet>
          <Sheet open onClose={onDialogClose} title="Вопрос" role="alertdialog" placement="center">
            <p>Сохранить?</p>
          </Sheet>
        </>
      );
    }
    render(<WithDialog />);
    expect(inside()).not.toBeNull();
    fire(document.body, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(inside()).not.toBeNull(); // панель под диалогом не тронута
    expect(onDialogClose).toHaveBeenCalledTimes(1);
  });
});
