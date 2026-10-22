import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TxPrefill } from '@/features/transactions/prefill';
import { deleteStoredTemplate, forgetTemplatesCache, readTemplates, renameStoredTemplate, restoreStoredTemplate, saveTemplate } from './templateStore';

const prefill = (over: Partial<TxPrefill> = {}): TxPrefill => ({ kind: 'expense', walletId: 'w1', toWalletId: null, amountMinor: 1_500, categoryId: 'food', note: 'кофе', ...over });
const KEY = 'finora:templates:u1';

beforeEach(() => {
  localStorage.clear();
  forgetTemplatesCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  forgetTemplatesCache();
});

describe('шаблоны на устройстве', () => {
  it('по умолчанию пусто; сохранённый шаблон переживает «перезагрузку»', () => {
    expect(readTemplates('u1')).toEqual([]);
    const r = saveTemplate('u1', 'Кофе', prefill());
    expect(r.ok).toBe(true);
    forgetTemplatesCache();
    expect(readTemplates('u1')).toHaveLength(1);
    expect(readTemplates('u1')[0]).toMatchObject({ name: 'Кофе', prefill: { amountMinor: 1_500 } });
    expect(readTemplates('u1')).toBe(readTemplates('u1')); // один и тот же массив, пока ничего не менялось
  });

  it('у каждого человека свои шаблоны', () => {
    saveTemplate('u1', 'Кофе', prefill());
    expect(readTemplates('u2')).toEqual([]);
  });

  it('переименование, удаление и возврат на прежнее место', () => {
    saveTemplate('u1', 'А', prefill());
    saveTemplate('u1', 'Б', prefill({ amountMinor: 200 }));
    saveTemplate('u1', 'В', prefill({ amountMinor: 300 }));
    const [a, b] = readTemplates('u1');
    renameStoredTemplate('u1', a!.id, 'Первый');
    expect(readTemplates('u1').map((t) => t.name)).toEqual(['Первый', 'Б', 'В']);
    const removed = deleteStoredTemplate('u1', b!.id)!;
    expect(readTemplates('u1').map((t) => t.name)).toEqual(['Первый', 'В']);
    restoreStoredTemplate('u1', removed.template, removed.index);
    expect(readTemplates('u1').map((t) => t.name)).toEqual(['Первый', 'Б', 'В']);
    expect(deleteStoredTemplate('u1', 'нет такого')).toBeNull();
  });

  it('последний удалённый шаблон убирает ключ из localStorage', () => {
    saveTemplate('u1', 'А', prefill());
    expect(localStorage.getItem(KEY)).not.toBeNull();
    deleteStoredTemplate('u1', readTemplates('u1')[0]!.id);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('испорченное хранилище читается как пустое; годные шаблоны среди мусора остаются', () => {
    localStorage.setItem(KEY, '{не json');
    expect(readTemplates('u1')).toEqual([]);
    forgetTemplatesCache();
    localStorage.setItem(KEY, JSON.stringify([{ id: 'a', name: 'Ок', prefill: prefill() }, { id: 'b' }, 7]));
    expect(readTemplates('u1').map((t) => t.id)).toEqual(['a']);
  });

  it('хранилище недоступно: шаблоны живут до перезагрузки страницы', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readTemplates('u1')).toEqual([]);
    expect(saveTemplate('u1', 'Кофе', prefill()).ok).toBe(true);
    expect(readTemplates('u1')).toHaveLength(1);
  });

  it('отказ (пустое название) ничего не пишет', () => {
    expect(saveTemplate('u1', '  ', prefill())).toEqual({ ok: false, reason: 'name' });
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
