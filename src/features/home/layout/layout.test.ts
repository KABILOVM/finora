import { describe, expect, it } from 'vitest';
import { parseHome, stringifyHome, type HomeItem } from '@/domain/homeLayout';
import { HOME_BLOCKS, homeBlock } from './blocks';
import { HOME_PRESETS, adviceAnchor, defaultHome, matchPreset, presetHome, reorderShown, resolveHome, setShown, setSize, shiftShown, sizeOf, slotsOf, widthOf } from './layout';

const ids = (items: readonly HomeItem[]) => items.map((i) => i.id);
const shownIds = (items: readonly HomeItem[]) =>
  slotsOf(items)
    .filter((s) => s.on)
    .map((s) => s.block.id);

describe('реестр блоков главной', () => {
  it('id не повторяются, подходят под формат записи и все помещаются в одну раскладку', () => {
    expect(new Set(HOME_BLOCKS.map((b) => b.id)).size).toBe(HOME_BLOCKS.length);
    expect(parseHome(stringifyHome(defaultHome()))).toEqual(defaultHome());
  });

  it('стандартная главная — прежняя: те же блоки в том же порядке, курсы и погода парой; новые блоки скрыты', () => {
    expect(shownIds(defaultHome())).toEqual([
      'hero', 'templates', 'attention', 'missed', 'weekly', 'monthly', 'save', 'trip', 'daily', 'rates', 'weather', 'wallets', 'budgets', 'upcoming', 'recent',
    ]);
    expect(HOME_BLOCKS.filter((b) => !b.on).map((b) => b.id)).toEqual(['spending', 'debts', 'goals', 'shopping', 'shortcuts']);
    expect(HOME_BLOCKS.filter((b) => b.size === 'half').map((b) => b.id)).toEqual(['rates', 'weather']);
  });

  it('у каждого блока есть название и пояснение; половиной по умолчанию бывает только блок с узким видом', () => {
    for (const b of HOME_BLOCKS) {
      expect(b.title.trim(), b.id).not.toBe('');
      expect(b.hint.trim(), b.id).not.toBe('');
      expect(/^#[0-9a-f]{6}$/.test(b.color), b.id).toBe(true);
      if (b.size === 'half') expect(b.half, b.id).toBe('always');
    }
  });
});

describe('resolveHome: полный список по записи', () => {
  it('записи нет — стандартная раскладка', () => {
    expect(resolveHome(null)).toEqual(defaultHome());
  });

  it('порядок и отметки из записи сохраняются; полная запись возвращается как есть', () => {
    const stored: HomeItem[] = [...defaultHome()].reverse().map((i) => (i.id === 'hero' ? { ...i, off: true as const } : i));
    expect(resolveHome(stored)).toEqual(stored);
  });

  it('блок, которого в записи нет (появился позже), встаёт за своим соседом по реестру и показан или скрыт по умолчанию', () => {
    // запись от «старого» приложения: без погоды, долгов и последних операций; кошельки подняты наверх
    const stored: HomeItem[] = [{ id: 'wallets' }, { id: 'hero' }, { id: 'rates', off: true }, { id: 'budgets' }];
    const full = resolveHome(stored);
    expect(new Set(ids(full))).toEqual(new Set(HOME_BLOCKS.map((b) => b.id)));
    const at = (id: string) => ids(full).indexOf(id);
    expect(at('wallets')).toBe(0); // выбор человека на месте
    expect(at('weather')).toBe(at('rates') + 1); // погода — сразу за курсами
    expect(full[at('weather')]).toEqual({ id: 'weather' }); // и показана, как на стандартной главной
    expect(full[at('debts')]).toEqual({ id: 'debts', off: true }); // новый блок скрыт
    expect(full[at('rates')]).toEqual({ id: 'rates', off: true }); // скрытое человеком осталось скрытым
  });

  it('незнакомый блок (от более нового приложения) остаётся в списке на своём месте, но в блоки для показа не попадает', () => {
    const full = resolveHome([{ id: 'hero' }, { id: 'future-block', size: 'half' }, { id: 'recent' }]);
    expect(ids(full).indexOf('future-block')).toBeGreaterThan(ids(full).indexOf('hero'));
    expect(full.find((i) => i.id === 'future-block')).toEqual({ id: 'future-block', size: 'half' });
    expect(slotsOf(full).some((s) => (s.block.id as string) === 'future-block')).toBe(false);
    expect(parseHome(stringifyHome(full))).toEqual(full); // и переживает сохранение
  });
});

describe('порядок, показ и ширина', () => {
  const base = resolveHome(null);

  it('reorderShown переставляет показанные блоки; скрытые и незнакомые остаются на своих местах', () => {
    const items: HomeItem[] = [{ id: 'hero' }, { id: 'debts', off: true }, { id: 'future' }, { id: 'wallets' }, { id: 'recent' }];
    const next = reorderShown(items, ['recent', 'hero', 'wallets']);
    expect(ids(next)).toEqual(['recent', 'debts', 'future', 'hero', 'wallets']);
    expect(next[1]).toEqual({ id: 'debts', off: true });
  });

  it('reorderShown не трогает список, если порядок — не перестановка показанных блоков', () => {
    const items: HomeItem[] = [{ id: 'hero' }, { id: 'wallets' }, { id: 'debts', off: true }];
    for (const bad of [['hero'], ['hero', 'hero'], ['hero', 'debts'], ['hero', 'wallets', 'recent']]) {
      expect(reorderShown(items, bad), bad.join()).toEqual(items);
    }
  });

  it('shiftShown двигает блок на одно место среди показанных; у края ничего не меняет', () => {
    const up = shiftShown(base, 'recent', -1);
    expect(shownIds(up).slice(-2)).toEqual(['recent', 'upcoming']);
    expect(shiftShown(base, 'hero', -1)).toEqual(base);
    expect(shiftShown(base, 'recent', 1)).toEqual(base);
    expect(shiftShown(base, 'debts', -1)).toEqual(base); // скрытый блок не двигается
    // скрытые блоки между показанными не мешают: «Ближайшие платежи» и «Можно тратить» меняются местами через скрытые «Расходы»
    expect(shownIds(shiftShown(base, 'upcoming', -1))).toEqual(shownIds(base).map((id) => (id === 'upcoming' ? 'budgets' : id === 'budgets' ? 'upcoming' : id)));
  });

  it('setShown скрывает и возвращает блок на прежнее место', () => {
    const hidden = setShown(base, 'weather', false);
    expect(shownIds(hidden)).not.toContain('weather');
    expect(ids(hidden)).toEqual(ids(base));
    expect(setShown(hidden, 'weather', true)).toEqual(base);
    expect(shownIds(setShown(base, 'debts', true))).toContain('debts');
  });

  it('setSize запоминает выбор; sizeOf: выбор человека, иначе задуманная ширина; блок без узкого вида всегда во всю ширину', () => {
    const slot = (items: readonly HomeItem[], id: string) => slotsOf(items).find((s) => s.block.id === id)!;
    expect(sizeOf(slot(base, 'rates'))).toBe('half');
    expect(sizeOf(slot(setSize(base, 'rates', 'full'), 'rates'))).toBe('full');
    expect(sizeOf(slot(base, 'debts'))).toBe('full');
    expect(sizeOf(slot(setSize(base, 'debts', 'half'), 'debts'))).toBe('half');
    expect(sizeOf(slot(setSize(base, 'recent', 'half'), 'recent'))).toBe('full');
  });

  it('widthOf: половина на любом экране — только у блоков с узким видом; компактные карточки — от 560 px или парами у «Бенто»', () => {
    const w = (id: string, size?: 'full' | 'half') => widthOf({ block: homeBlock(id)!, ...(size ? { size } : {}) });
    expect(w('rates')).toBe('half');
    expect(w('rates', 'full')).toBe('full');
    expect(w('debts')).toBe('full');
    expect(w('debts', 'half')).toBe('half');
    expect(w('budgets')).toBe('bento');
    expect(w('budgets', 'half')).toBe('half-wide');
    expect(w('budgets', 'full')).toBe('full');
    expect(w('hero', 'half')).toBe('full');
  });
});

describe('adviceAnchor: где стоит строка-совет погоды', () => {
  const shown = (items: readonly HomeItem[]) => slotsOf(items).filter((s) => s.on);
  const anchorId = (items: readonly HomeItem[]) => {
    const list = shown(items);
    const at = adviceAnchor(list);
    return at < 0 ? null : list[at]!.block.id;
  };

  it('стандартная главная: курсы и погода парой, совет — под ними (за погодой)', () => {
    expect(anchorId(defaultHome())).toBe('weather');
  });

  it('погода первой в паре — совет за её соседкой справа', () => {
    expect(anchorId([{ id: 'hero' }, { id: 'weather' }, { id: 'rates' }, { id: 'recent' }])).toBe('rates');
  });

  it('погода одна в ряду (сосед во всю ширину или её нет) — совет сразу за ней', () => {
    expect(anchorId([{ id: 'hero' }, { id: 'weather' }, { id: 'recent' }])).toBe('weather');
    expect(anchorId([{ id: 'hero' }, { id: 'weather' }])).toBe('weather');
    expect(anchorId([{ id: 'weather' }, { id: 'rates', size: 'full' }])).toBe('weather');
  });

  it('три половины подряд: пары считаются по порядку', () => {
    // (долги, курсы) (погода, …) — погода начинает новый ряд
    expect(anchorId([{ id: 'debts', size: 'half' }, { id: 'rates' }, { id: 'weather' }, { id: 'recent' }])).toBe('weather');
    // (долги, погода) (курсы) — погода вторая в паре
    expect(anchorId([{ id: 'debts', size: 'half' }, { id: 'weather' }, { id: 'rates' }])).toBe('weather');
    // (долги, курсы) (погода, покупки)
    expect(anchorId([{ id: 'debts', size: 'half' }, { id: 'rates' }, { id: 'weather' }, { id: 'shopping', size: 'half' }])).toBe('shopping');
  });

  it('компактная карточка («половина от 560 px») парой для погоды не считается', () => {
    expect(anchorId([{ id: 'weather' }, { id: 'budgets', size: 'half' }])).toBe('weather');
  });

  it('погода во всю ширину или скрыта — отдельного места нет: совет остаётся в её карточке', () => {
    expect(anchorId([{ id: 'rates' }, { id: 'weather', size: 'full' }])).toBeNull();
    expect(anchorId(setShown(defaultHome(), 'weather', false))).toBeNull();
  });
});

describe('готовые наборы', () => {
  it('«Стандартная» очищает запись', () => {
    expect(presetHome('standard')).toBeNull();
    expect(matchPreset(null)).toBe('standard');
  });

  it('«Операции сверху»: последние операции сразу под итогом, дальше кошельки и остальное как было', () => {
    const items = presetHome('ops')!;
    expect(shownIds(items).slice(0, 3)).toEqual(['hero', 'recent', 'wallets']);
    expect(new Set(shownIds(items))).toEqual(new Set(shownIds(defaultHome())));
    expect(matchPreset(items)).toBe('ops');
  });

  it('«Минимум»: итог, «Требует внимания», кошельки и операции', () => {
    const items = presetHome('minimal')!;
    expect(shownIds(items)).toEqual(['hero', 'attention', 'wallets', 'recent']);
    expect(matchPreset(items)).toBe('minimal');
  });

  it('«Всё»: показаны все блоки реестра', () => {
    const items = presetHome('all')!;
    expect(shownIds(items)).toEqual(HOME_BLOCKS.map((b) => b.id));
    expect(matchPreset(items)).toBe('all');
  });

  it('набор не стирает незнакомые блоки из текущей раскладки', () => {
    const items = presetHome('minimal', [{ id: 'hero' }, { id: 'future-block' }])!;
    expect(ids(items)).toContain('future-block');
  });

  it('своя раскладка ни одному набору не равна; раскладка, совпавшая со стандартной, опознаётся как стандартная', () => {
    expect(matchPreset(setShown(defaultHome(), 'weather', false))).toBeNull();
    expect(matchPreset(setSize(defaultHome(), 'rates', 'full'))).toBeNull();
    expect(matchPreset(defaultHome())).toBe('standard');
  });

  it('каждый набор сохраняется в настройки', () => {
    for (const p of HOME_PRESETS) {
      const items = presetHome(p.id);
      if (items !== null) expect(() => stringifyHome(items), p.id).not.toThrow();
    }
  });
});
