import { describe, expect, it } from 'vitest';
import type { TxPrefill } from '@/features/transactions/prefill';
import {
  addTemplate,
  cleanName,
  insertTemplate,
  nameKey,
  NAME_MAX,
  parseTemplates,
  removeTemplate,
  renameTemplate,
  resolveTemplate,
  suggestName,
  templatePrefill,
  TEMPLATES_MAX,
  uniqueName,
  type Template,
} from './templates';

const prefill = (over: Partial<TxPrefill> = {}): TxPrefill => ({ kind: 'expense', walletId: 'w1', toWalletId: null, amountMinor: 1_500, categoryId: 'food', note: 'кофе', ...over });
const tpl = (id: string, name: string, over: Partial<TxPrefill> = {}): Template => ({ id, name, prefill: prefill(over) });

describe('названия', () => {
  it('cleanName: пробелы схлопываются, длина ограничена, пустое — null', () => {
    expect(cleanName('  Обед   в   столовой ')).toBe('Обед в столовой');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('я'.repeat(NAME_MAX + 5))).toBe('я'.repeat(NAME_MAX));
  });

  it('nameKey: без регистра и «ё»', () => {
    expect(nameKey('Ёлка')).toBe(nameKey('елка'));
    expect(nameKey('КОФЕ')).toBe(nameKey('кофе'));
  });

  it('uniqueName: «Кофе» → «Кофе 2» → «Кофе 3»; при переименовании сам шаблон не мешает; длина не растёт', () => {
    const list = [tpl('a', 'Кофе'), tpl('b', 'кофе 2')];
    expect(uniqueName('Чай', list)).toBe('Чай');
    expect(uniqueName('КОФЕ', list)).toBe('КОФЕ 3');
    expect(uniqueName('Кофе', list, 'a')).toBe('Кофе');
    const long = 'я'.repeat(NAME_MAX);
    const out = uniqueName(long, [tpl('a', long)]);
    expect(out.length).toBeLessThanOrEqual(NAME_MAX);
    expect(out.endsWith(' 2')).toBe(true);
  });

  it('suggestName: заметка (без меток поездки) → категория → вид операции', () => {
    expect(suggestName({ kind: 'expense', note: 'кофе #Самарканд' }, 'Еда')).toBe('кофе');
    expect(suggestName({ kind: 'expense', note: '#Самарканд' }, 'Еда')).toBe('Еда');
    expect(suggestName({ kind: 'income', note: '' }, null)).toBe('Доход');
    expect(suggestName({ kind: 'transfer', note: '' }, null)).toBe('Перевод');
  });
});

describe('templatePrefill', () => {
  it('убирает метки поездки из заметки; у расхода и дохода нет «куда» и комиссии', () => {
    expect(templatePrefill(prefill({ note: 'кофе #Самарканд', toWalletId: 'w2', feeMinor: 5 }))).toEqual(prefill({ note: 'кофе' }));
  });
  it('у перевода комиссия остаётся', () => {
    const p = prefill({ kind: 'transfer', toWalletId: 'w2', categoryId: null, feeMinor: 50 });
    expect(templatePrefill(p)).toEqual(p);
  });
});

describe('parseTemplates', () => {
  it('годные берёт, мусор выбрасывает; повтор номера — один раз; порядок сохраняется', () => {
    const good = tpl('a', 'Кофе');
    const raw = [
      good,
      good,
      null,
      'строка',
      { id: 'b', name: '  ', prefill: prefill() },
      { id: 'c', name: 'Без суммы', prefill: { ...prefill(), amountMinor: 0 } },
      { id: 'd', name: 'Дробь', prefill: { ...prefill(), amountMinor: 1.5 } },
      { id: 'e', name: 'Вид', prefill: { ...prefill(), kind: 'debt' } },
      { id: 'f', name: 'Нет кошелька', prefill: { ...prefill(), walletId: '' } },
      { id: 'g', name: 'Перевод в себя', prefill: prefill({ kind: 'transfer', toWalletId: 'w1', categoryId: null }) },
      { id: 'h', name: 'Перевод', prefill: prefill({ kind: 'transfer', toWalletId: 'w2', categoryId: 'food', feeMinor: 100 }) },
      { id: 'i', name: 'Комиссия больше суммы', prefill: prefill({ kind: 'transfer', toWalletId: 'w2', categoryId: null, feeMinor: 9_999 }) },
    ];
    const out = parseTemplates(raw);
    expect(out.map((t) => t.id)).toEqual(['a', 'h', 'i']);
    expect(out[1]!.prefill).toEqual(prefill({ kind: 'transfer', toWalletId: 'w2', categoryId: null, feeMinor: 100 }));
    expect(out[2]!.prefill.feeMinor).toBeUndefined();
  });

  it('не массив — пусто; больше TEMPLATES_MAX — лишние отбрасываются', () => {
    expect(parseTemplates({})).toEqual([]);
    expect(parseTemplates(null)).toEqual([]);
    const many = Array.from({ length: TEMPLATES_MAX + 5 }, (_, i) => tpl(`t${i}`, `Шаблон ${i}`));
    expect(parseTemplates(many)).toHaveLength(TEMPLATES_MAX);
  });
});

describe('добавление, переименование, удаление', () => {
  it('addTemplate: в конец, название уникальное, метка поездки из заметки убрана', () => {
    const first = addTemplate([], { id: 'a', name: ' Кофе ', prefill: prefill({ note: 'кофе #Баку' }) });
    expect(first.ok && first.template).toEqual(tpl('a', 'Кофе'));
    const second = addTemplate(first.ok ? first.templates : [], { id: 'b', name: 'кофе', prefill: prefill() });
    expect(second.ok && second.templates.map((t) => t.name)).toEqual(['Кофе', 'кофе 2']);
  });

  it('addTemplate: пустое название, негодная заготовка и полный список — отказ с причиной', () => {
    expect(addTemplate([], { id: 'a', name: '  ', prefill: prefill() })).toEqual({ ok: false, reason: 'name' });
    expect(addTemplate([], { id: 'a', name: 'Х', prefill: prefill({ amountMinor: 0 }) })).toEqual({ ok: false, reason: 'invalid' });
    const full = Array.from({ length: TEMPLATES_MAX }, (_, i) => tpl(`t${i}`, `Шаблон ${i}`));
    expect(addTemplate(full, { id: 'new', name: 'Ещё', prefill: prefill() })).toEqual({ ok: false, reason: 'limit' });
  });

  it('renameTemplate: уникальность среди других; пустое и неизвестное — без изменений', () => {
    const list = [tpl('a', 'Кофе'), tpl('b', 'Чай')];
    expect(renameTemplate(list, 'b', 'кофе').map((t) => t.name)).toEqual(['Кофе', 'кофе 2']);
    expect(renameTemplate(list, 'a', 'КОФЕ').map((t) => t.name)).toEqual(['КОФЕ', 'Чай']);
    expect(renameTemplate(list, 'a', '  ')).toEqual(list);
    expect(renameTemplate(list, 'zzz', 'Х')).toEqual(list);
  });

  it('removeTemplate и insertTemplate («Отменить» возвращает на прежнее место, второй раз — не дублирует)', () => {
    const list = [tpl('a', 'А'), tpl('b', 'Б'), tpl('c', 'В')];
    const removed = removeTemplate(list, 'b');
    expect(removed.map((t) => t.id)).toEqual(['a', 'c']);
    const back = insertTemplate(removed, list[1]!, 1);
    expect(back.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(insertTemplate(back, list[1]!, 0).map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(insertTemplate(removed, list[1]!, 99).map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('resolveTemplate', () => {
  const wallets = [
    { id: 'w1', name: 'Наличные', currency: 'TJS' },
    { id: 'w2', name: 'Карта', currency: 'TJS' },
  ] as const;
  const cat = (over: Record<string, unknown> = {}) => ({ id: 'food', name: 'Еда', icon: '🍽️', color: '#f97316', kind: 'expense' as const, archivedAt: null, ...over });

  it('кошелёк и категория на месте — готово; категории может не быть', () => {
    expect(resolveTemplate(tpl('a', 'А'), wallets, [cat()])).toMatchObject({ wallet: { id: 'w1' }, category: { id: 'food' } });
    expect(resolveTemplate(tpl('a', 'А', { categoryId: null }), wallets, [])).toMatchObject({ category: null });
  });

  it('нет кошелька, категория в архиве, не того вида или не найдена — null', () => {
    expect(resolveTemplate(tpl('a', 'А', { walletId: 'gone' }), wallets, [cat()])).toBeNull();
    expect(resolveTemplate(tpl('a', 'А'), wallets, [cat({ archivedAt: '2026-01-01T00:00:00.000Z' })])).toBeNull();
    expect(resolveTemplate(tpl('a', 'А'), wallets, [cat({ kind: 'income' })])).toBeNull();
    expect(resolveTemplate(tpl('a', 'А'), wallets, [])).toBeNull();
  });

  it('перевод: нужны оба кошелька и они разные', () => {
    const t = tpl('a', 'А', { kind: 'transfer', toWalletId: 'w2', categoryId: null });
    expect(resolveTemplate(t, wallets, [])).toMatchObject({ wallet: { id: 'w1' }, toWallet: { id: 'w2' } });
    expect(resolveTemplate(tpl('a', 'А', { kind: 'transfer', toWalletId: 'gone', categoryId: null }), wallets, [])).toBeNull();
  });
});
