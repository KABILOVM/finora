import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { Sheet } from './Sheet';
import { act, fire, render, screen, user } from './testUtils';

function Harness({ onClose, dismissible = true }: { onClose?: () => void; dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Открыть</button>
      <Sheet
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Новая операция"
        dismissible={dismissible}
      >
        <input aria-label="Заметка" />
        <button>Сохранить</button>
      </Sheet>
    </>
  );
}

const opener = () => screen.getByRole('button', { name: 'Открыть' });
const dialog = () => screen.queryByRole('dialog', { name: 'Новая операция' });

async function open() {
  await user.click(opener());
  expect(dialog()).not.toBeNull();
}

describe('Sheet', () => {
  it('закрыт — в DOM ничего нет', () => {
    render(<Harness />);
    expect(dialog()).toBeNull();
  });

  it('открывается как диалог с названием и фокусом внутри', async () => {
    render(<Harness />);
    await open();
    const d = screen.getByRole('dialog', { name: 'Новая операция' });
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(d.contains(document.activeElement)).toBe(true);
    // первым получает фокус первый элемент содержимого, а не кнопка «Закрыть»
    expect(screen.getByRole('textbox', { name: 'Заметка' })).toHaveFocus();
  });

  it('Esc закрывает, фокус возвращается на кнопку, открывшую шит', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await open();
    await user.keyboard('{Escape}');
    expect(dialog()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener()).toHaveFocus();
  });

  it('кнопка «Закрыть» закрывает и возвращает фокус', async () => {
    render(<Harness />);
    await open();
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(dialog()).toBeNull();
    expect(opener()).toHaveFocus();
  });

  it('тап по фону закрывает, тап внутри — нет', async () => {
    render(<Harness />);
    await open();
    await user.click(screen.getByText('Новая операция'));
    expect(dialog()).not.toBeNull();
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(dialog()).toBeNull();
  });

  it('выделение текста внутри шита с отпусканием на фоне его не закрывает', async () => {
    render(<Harness />);
    await open();
    const panel = screen.getByRole('dialog');
    const backdrop = panel.parentElement as HTMLElement;
    fire(panel, new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    fire(backdrop, new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(dialog()).not.toBeNull();
  });

  it('Tab по кругу внутри шита: с последнего элемента — на первый, Shift+Tab — обратно', async () => {
    render(<Harness />);
    await open();
    const close = screen.getByRole('button', { name: 'Закрыть' });
    const save = screen.getByRole('button', { name: 'Сохранить' });
    save.focus();
    await user.keyboard('{Tab}');
    expect(close).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(save).toHaveFocus();
  });

  it('если фокус оказался вне шита, Tab возвращает его внутрь', async () => {
    render(<Harness />);
    await open();
    opener().focus();
    await user.keyboard('{Tab}');
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('прокрутка фона заблокирована, пока шит открыт, и восстановлена после', async () => {
    document.body.style.overflow = '';
    render(<Harness />);
    await open();
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('data-autofocus получает фокус первым', async () => {
    render(
      <Sheet open onClose={() => {}} title="Окно">
        <input aria-label="Первое" />
        <input aria-label="Второе" data-autofocus />
      </Sheet>,
    );
    expect(screen.getByRole('textbox', { name: 'Второе' })).toHaveFocus();
  });

  it('dismissible=false: ни Esc, ни фон не закрывают, кнопки «Закрыть» нет', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} dismissible={false} />);
    await open();
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(dialog()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('смена колбэка onClose при перерисовке не уводит фокус и не «закрывает» шит', async () => {
    const { rerender } = render(
      <Sheet open onClose={() => {}} title="Окно">
        <input aria-label="Поле" />
        <button>Кнопка</button>
      </Sheet>,
    );
    const btn = screen.getByRole('button', { name: 'Кнопка' });
    btn.focus();
    rerender(
      <Sheet open onClose={() => {}} title="Окно">
        <input aria-label="Поле" />
        <button>Кнопка</button>
      </Sheet>,
    );
    expect(screen.getByRole('button', { name: 'Кнопка' })).toHaveFocus();
  });

  it('при размонтировании открытого шита прокрутка и фокус восстанавливаются', async () => {
    const view = render(<Harness />);
    await open();
    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('вложенные окна и ConfirmDialog', () => {
  function Nested({ onConfirm }: { onConfirm?: () => void }) {
    const [confirm, setConfirm] = useState(false);
    return (
      <Sheet open onClose={() => {}} title="Операция">
        <button onClick={() => setConfirm(true)}>Удалить</button>
        <ConfirmDialog
          open={confirm}
          title="Удалить операцию?"
          message="Её можно будет вернуть через «Отменить»."
          confirmLabel="Удалить"
          danger
          onConfirm={() => {
            onConfirm?.();
            setConfirm(false);
          }}
          onCancel={() => setConfirm(false)}
        />
      </Sheet>
    );
  }

  it('Esc закрывает только верхнее окно (подтверждение), нижнее остаётся', async () => {
    render(<Nested />);
    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(screen.getByRole('alertdialog', { name: 'Удалить операцию?' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Операция' })).toBeInTheDocument();
    // фокус вернулся на «Удалить» нижнего шита
    expect(screen.getByRole('button', { name: 'Удалить' })).toHaveFocus();
  });

  it('прокрутка остаётся заблокированной, пока открыто хотя бы одно окно', async () => {
    document.body.style.overflow = '';
    render(<Nested />);
    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('фокус по умолчанию на «Отмена» — случайный Enter ничего не удалит', async () => {
    const onConfirm = vi.fn();
    render(<Nested onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(screen.getByRole('button', { name: 'Отмена' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('«Удалить» в подтверждении вызывает onConfirm один раз', async () => {
    const onConfirm = vi.fn();
    render(<Nested onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    const confirm = screen.getByRole('alertdialog').querySelector('button.bg-danger') as HTMLElement;
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('loading: кнопки заблокированы, Esc и «Отмена» не закрывают', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Удалить?" loading onConfirm={() => {}} onCancel={onCancel} />);
    const confirm = screen.getByRole('button', { name: 'Подтвердить' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    act(() => {});
  });
});
