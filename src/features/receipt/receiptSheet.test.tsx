import { describe, expect, it, vi } from 'vitest';
import { fire, findByRole, render, screen, user, waitFor } from '@/components/testUtils';
import type { LocalRow, Transaction, Wallet } from '@/domain/types';
import { ToastProvider } from '@/components/Toast';
import { emptyLine, type ReceiptContext, type ReceiptDraft } from './receiptAi';
import { ReceiptSheet, type ReceiptSheetProps } from './ReceiptSheet';

const wallets = [
  { id: 'w1', name: 'Наличные', currency: 'TJS', archivedAt: null, deletedAt: null },
  { id: 'w2', name: 'Доллары', currency: 'USD', archivedAt: null, deletedAt: null },
  { id: 'w3', name: 'Карта', currency: 'TJS', archivedAt: null, deletedAt: null },
] as unknown as LocalRow<Wallet>[];
const categories = [
  { id: 'food', name: 'Продукты' },
  { id: 'home', name: 'Быт' },
];

const aiDraft: ReceiptDraft = {
  merchant: 'Корзинка',
  date: '2026-10-14',
  totalText: '50',
  lines: [
    { ...emptyLine(1), name: 'Молоко', qtyText: '2', unit: 'l', priceText: '26', categoryId: 'food' },
    { ...emptyLine(2), name: 'Порошок', priceText: '12,5', categoryId: 'home' },
  ],
};

function setup(over: Partial<ReceiptSheetProps> = {}) {
  const created = [{ id: 't1' }, { id: 't2' }] as unknown as LocalRow<Transaction>[];
  const onClose = vi.fn();
  const analyze = vi.fn(async (_file: File, _ctx: ReceiptContext, _rid: number) => aiDraft);
  const save = vi.fn(async (_draft: ReceiptDraft, _walletId: string) => created);
  const undo = vi.fn(async () => undefined);
  render(
    <ToastProvider>
      <ReceiptSheet wallets={wallets} base="TJS" categories={categories} defaultWalletId="w1" today="2026-10-15" analyze={analyze} save={save} undo={undo} onClose={onClose} {...over} />
    </ToastProvider>,
  );
  return { onClose, analyze, save, undo };
}

/** Выбор файла так, как это делает браузер: у поля появляется файл и срабатывает change. */
function pick(file: File) {
  const input = document.querySelector<HTMLInputElement>('[data-testid="receipt-file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fire(input, new Event('change', { bubbles: true }));
}
const photo = () => new File(['x'], 'check.jpg', { type: 'image/jpeg' });
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('«Чек по позициям»', () => {
  it('сначала два пути: фото и вручную', async () => {
    setup();
    expect(await findByRole('button', { name: 'Сфотографировать чек' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ввести вручную' })).toBeTruthy();
  });

  it('фото → позиции и категории видны; группы по категориям; «Сохранить 2 расхода» отдаёт чек и закрывает окно', async () => {
    const { analyze, save, onClose } = setup();
    pick(photo());
    await waitFor(() => expect(document.querySelectorAll('[data-testid="receipt-line"]')).toHaveLength(2));
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0]![1]).toMatchObject({ currency: 'TJS', today: '2026-10-15' });
    expect(Array.from(document.querySelectorAll('[data-testid="receipt-group"]')).map(text)).toEqual([expect.stringContaining('Продукты'), expect.stringContaining('Быт')]);
    expect(text(document.querySelector('[data-testid="receipt-summary"]'))).toContain('Сумма позиций');
    // сумма позиций 38,50, на чеке 50: не хватает 11,50
    expect(text(document.querySelector('[data-testid="receipt-diff"]'))).toMatch(/Позиций не хватает на .*11,50/);
    await user.click(screen.getByRole('button', { name: 'Сохранить 2 расхода' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(2));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![1]).toBe('w1'); // кошелёк в основной валюте; «Доллары» в выбор не попадают
  });

  it('в выборе кошелька только кошельки в основной валюте', async () => {
    setup();
    pick(photo());
    await waitFor(() => expect(document.querySelectorAll('[data-testid="receipt-line"]')).toHaveLength(2));
    const options = Array.from(document.querySelectorAll<HTMLOptionElement>('#receipt-wallet option')).map((o) => o.textContent);
    expect(options).toEqual(['Наличные', 'Карта']);
  });

  it('позицию можно поправить (цена, категория) и убрать; сумма и группы пересчитываются', async () => {
    const { save } = setup();
    pick(photo());
    await waitFor(() => expect(document.querySelectorAll('[data-testid="receipt-line"]')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Изменить: Порошок' }));
    const price = screen.getByRole('textbox', { name: 'Цена за всю позицию' });
    await user.clear(price);
    await user.type(price, '24');
    await user.click(screen.getByRole('button', { name: /^Категория:/ }));
    await user.click(screen.getByRole('option', { name: /Продукты/ }));
    await waitFor(() => expect(document.querySelectorAll('[data-testid="receipt-group"]')).toHaveLength(1));
    await user.click(await findByRole('button', { name: 'Убрать: Молоко' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить 1 расход' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0].lines.map((l) => [l.name, l.priceText, l.categoryId])).toEqual([['Порошок', '24', 'food']]);
  });

  it('вручную: позиция раскрыта сразу, «Добавить позицию» добавляет следующую; без названия и цены не сохраняется', async () => {
    const { save } = setup();
    await user.click(await findByRole('button', { name: 'Ввести вручную' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Исправьте 1 позицию/));
    expect(save).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Хлеб');
    await user.type(screen.getByRole('textbox', { name: 'Цена за всю позицию' }), '10');
    await user.click(screen.getByRole('button', { name: 'Добавить позицию' }));
    expect(document.querySelectorAll('[data-testid="receipt-line"]')).toHaveLength(2);
    // вторая позиция пустая: пока она пустая, сохранить нельзя; уберём её
    await user.click(screen.getByRole('button', { name: 'Убрать: Без названия' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить 1 расход' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
  });

  it('не прочиталось или ошибка сервера — объяснение на первом экране, можно повторить', async () => {
    const analyze = vi.fn(async (_f: File, _c: ReceiptContext, _r: number): Promise<ReceiptDraft> => ({ merchant: '', date: '2026-10-15', totalText: '', lines: [] }));
    setup({ analyze });
    pick(photo());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Не удалось прочитать позиции/));
    expect(screen.getByRole('button', { name: 'Сфотографировать чек' })).toBeTruthy();
  });

  it('сбой разбора показывает текст ошибки', async () => {
    setup({ analyze: vi.fn(async () => Promise.reject(new Error('Слишком часто. Подождите минуту и повторите.'))) });
    pick(photo());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Слишком часто'));
  });

  it('нет кошелька в основной валюте — предупреждение и «Сохранить» недоступна', async () => {
    setup({ wallets: [wallets[1]!] });
    pick(photo());
    await waitFor(() => expect(document.querySelectorAll('[data-testid="receipt-line"]')).toHaveLength(2));
    expect(screen.getByRole('alert').textContent).toContain('Нет кошелька в основной валюте');
    expect(screen.getByRole('button', { name: 'Сохранить 2 расхода' })).toBeDisabled();
  });

  it('«Отменить» в уведомлении после сохранения убирает расходы чека', async () => {
    const { undo } = setup();
    pick(photo());
    await waitFor(() => expect(document.querySelectorAll('[data-testid="receipt-line"]')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Сохранить 2 расхода' }));
    await user.click(await findByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(1));
  });
});
