import { describe, expect, it, vi } from 'vitest';
import { AiListError, type Invoker } from '@/features/shopping/aiList';
import { MAX_ORIGINAL_BYTES, parseReceiptWithAi, prepareReceiptImage } from './aiReceipt';

const ctx = { categories: [{ id: 'food', name: 'Продукты' }], today: '2026-10-15', currency: 'TJS' } as const;

const invoker = (data: unknown, error: unknown = null) => {
  const invoke = vi.fn(async () => ({ data, error }));
  return { client: { functions: { invoke } } as unknown as Invoker, invoke };
};

describe('parseReceiptWithAi', () => {
  it('отправляет фото, названия категорий и дату; ответ приводится к черновику', async () => {
    const { client, invoke } = invoker({ ok: true, merchant: 'Корзинка', date: '2026-10-14', total: 36.5, items: [{ name: 'молоко', qty: 2, unit: 'l', price: 26, category: 'Продукты' }, { name: 'хлеб', qty: 1, unit: 'pcs', price: 10.5, category: '' }] });
    const d = await parseReceiptWithAi({ base64: 'QUJD', mime: 'image/jpeg' }, ctx, 1, client);
    expect(invoke).toHaveBeenCalledWith('parse-receipt', { body: { image: 'QUJD', mime: 'image/jpeg', categories: ['Продукты'], today: '2026-10-15' } });
    expect(d).toMatchObject({ merchant: 'Корзинка', date: '2026-10-14', totalText: '36,5' });
    expect(d.lines.map((l) => [l.name, l.priceText, l.categoryId])).toEqual([['Молоко', '26', 'food'], ['Хлеб', '10,5', 'food']]); // у «хлеба» ИИ категорию не назвал: продукт из каталога → «Продукты»
  });

  it('нет облака — понятная ошибка; ответ с ошибкой сервера — тоже', async () => {
    await expect(parseReceiptWithAi({ base64: 'x', mime: 'image/jpeg' }, ctx, 1, null)).rejects.toBeInstanceOf(AiListError);
    const { client } = invoker(null, { context: { status: 404 } });
    await expect(parseReceiptWithAi({ base64: 'x', mime: 'image/jpeg' }, ctx, 1, client)).rejects.toThrow(/не установлен|чека/);
  });
});

describe('prepareReceiptImage', () => {
  // В jsdom нет createImageBitmap: фото уходит как есть, если оно подходит по типу и размеру.
  it('подходящее фото отправляется как есть (base64 и тип)', async () => {
    const r = await prepareReceiptImage(new Blob(['ABC'], { type: 'image/png' }));
    expect(r).toEqual({ base64: 'QUJD', mime: 'image/png' });
  });

  it('не фотография или слишком большой файл — понятная ошибка', async () => {
    await expect(prepareReceiptImage(new Blob(['x'], { type: 'text/plain' }))).rejects.toThrow(/Это не фотография/);
    await expect(prepareReceiptImage(new Blob([new Uint8Array(MAX_ORIGINAL_BYTES + 1)], { type: 'image/jpeg' }))).rejects.toThrow(/слишком большое/);
  });
});
