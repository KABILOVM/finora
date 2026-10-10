import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Minor } from '@/domain/types';
import type { SyncStatus } from '@/sync/transport';
import { AmountInput } from './AmountInput';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { Segmented } from './Segmented';
import { Sheet } from './Sheet';
import { SyncBadge } from './SyncBadge';
import { fire, render, screen, user } from './testUtils';

function Amount({ currency = 'TJS', onValue }: { currency?: string; onValue: (m: Minor | null) => void }) {
  const [v, setV] = useState<Minor | null>(null);
  return (
    <AmountInput
      currency={currency}
      value={v}
      onChange={(m) => {
        setV(m);
        onValue(m);
      }}
    />
  );
}
const field = () => screen.getByRole('textbox', { name: /Сумма/ }) as HTMLInputElement;

describe('ATTACK: AmountInput — вставка суммы из банковского приложения', () => {
  it('«1.234,56» не должно давать 1,23 сомони (было бы 123 минор вместо 123456)', async () => {
    const onValue = vi.fn();
    render(<Amount onValue={onValue} />);
    await user.click(field());
    await user.paste('1.234,56');
    const last = onValue.mock.calls.at(-1)?.[0];
    expect([123456, null]).toContain(last);
  });

  it('иена: набор «12.5» с обычной клавиатуры ПК не должен давать 125', async () => {
    const onValue = vi.fn();
    render(<Amount currency="JPY" onValue={onValue} />);
    await user.type(field(), '12.5');
    const last = onValue.mock.calls.at(-1)?.[0];
    expect(last).not.toBe(125);
  });
});

describe('ATTACK: Sheet — фокус-ловушка и Segmented (roving tabindex)', () => {
  function Host() {
    const [t, setT] = useState<'expense' | 'income' | 'transfer'>('expense');
    return (
      <>
        <button type="button">Фон до</button>
        <Sheet open onClose={() => {}} title="Новая операция" placement="center">
          <Segmented
            ariaLabel="Тип операции"
            value={t}
            onChange={setT}
            options={[
              { value: 'expense', label: 'Расход' },
              { value: 'income', label: 'Доход' },
              { value: 'transfer', label: 'Перевод' },
            ]}
          />
        </Sheet>
        <button type="button">Фон после</button>
      </>
    );
  }

  it('Tab с последнего доступного по Tab элемента шита не выпускает фокус за пределы окна', async () => {
    render(<Host />);
    const dialog = screen.getByRole('dialog');
    // Идём по Tab несколько раз: окно модальное, фокус обязан оставаться внутри.
    for (let i = 0; i < 6; i++) {
      await user.keyboard('{Tab}');
      expect(dialog.contains(document.activeElement), `шаг ${i + 1}: фокус ушёл на «${document.activeElement?.textContent}»`).toBe(true);
    }
  });

  it('Shift+Tab назад — то же самое', async () => {
    render(<Host />);
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i++) {
      await user.keyboard('{Shift>}{Tab}{/Shift}');
      expect(dialog.contains(document.activeElement), `шаг ${i + 1}: фокус ушёл на «${document.activeElement?.textContent}»`).toBe(true);
    }
  });
});

describe('ATTACK: SyncBadge — отвергнутые сервером записи (карантин)', () => {
  it('при quarantined > 0 индикатор не должен говорить «Синхронизировано»', () => {
    const status: SyncStatus = { phase: 'idle', pending: 0, quarantined: 3, lastSyncedAt: null, lastError: null };
    // Так AppShell получает статус от движка: весь объект кладут в пропсы.
    render(<SyncBadge {...status} />);
    expect(screen.getByRole('status').textContent).not.toMatch(/^Синхронизировано$/);
  });
});

describe('ATTACK: Escape при заблокированном окне', () => {
  it('во время loading Esc не закрывает ни диалог, ни нижний шит', async () => {
    const onCloseSheet = vi.fn();
    const onCancel = vi.fn();
    render(
      <>
        <Sheet open onClose={onCloseSheet} title="Шит">
          <Button>Внутри</Button>
        </Sheet>
        <ConfirmDialog open loading title="Удаляем" onConfirm={() => {}} onCancel={onCancel} />
      </>,
    );
    fire(document.activeElement ?? document.body, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onCloseSheet).not.toHaveBeenCalled();
  });
});
