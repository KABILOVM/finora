import { describe, expect, it } from 'vitest';
import { isInSection, isNavActive, MORE_SECTIONS, PHONE_ITEMS, SIDE_ITEMS } from './nav';

const item = (to: string) => {
  const found = [...PHONE_ITEMS, ...SIDE_ITEMS].find((i) => i.to === to);
  if (!found) throw new Error(`нет пункта ${to}`);
  return found;
};

describe('isInSection', () => {
  it('раздел и всё внутри него', () => {
    expect(isInSection('/settings', '/settings')).toBe(true);
    expect(isInSection('/settings/categories', '/settings')).toBe(true);
    expect(isInSection('/settings/', '/settings')).toBe(true);
    expect(isInSection('/SETTINGS', '/settings')).toBe(true); // маршруты не различают регистр, подсветка тоже
  });
  it('чужой путь с тем же началом не считается: /budgetsX не «Бюджеты»', () => {
    expect(isInSection('/budgetsX', '/budgets')).toBe(false);
    expect(isInSection('/more2', '/more')).toBe(false);
  });
  it('«/» — только главная', () => {
    expect(isInSection('/', '/')).toBe(true);
    expect(isInSection('/wallets', '/')).toBe(false);
  });
});

describe('isNavActive: нижняя панель телефона', () => {
  it.each([...MORE_SECTIONS, '/settings/categories', '/more/'])('«Ещё» подсвечен на %s', (path) => {
    expect(isNavActive(item('/more'), path, 'phone')).toBe(true);
  });
  it.each(['/', '/transactions', '/analytics'])('«Ещё» не подсвечен на %s', (path) => {
    expect(isNavActive(item('/more'), path, 'phone')).toBe(false);
  });
  it('«Главная» только на «/»', () => {
    expect(isNavActive(item('/'), '/', 'phone')).toBe(true);
    expect(isNavActive(item('/'), '/more', 'phone')).toBe(false);
  });
  it('в нижней панели четыре пункта: Главная, Операции, Аналитика, Ещё', () => {
    expect(PHONE_ITEMS.map((i) => i.label)).toEqual(['Главная', 'Операции', 'Аналитика', 'Ещё']);
  });
  it('«Аналитика» горит только на своём разделе, кошельки лежат за «Ещё»', () => {
    expect(isNavActive(item('/analytics'), '/analytics', 'phone')).toBe(true);
    expect(isNavActive(item('/analytics'), '/wallets', 'phone')).toBe(false);
    expect(isNavActive(item('/more'), '/wallets', 'phone')).toBe(true);
    expect(isNavActive(item('/more'), '/analytics', 'phone')).toBe(false);
  });
});

describe('isNavActive: боковая панель ПК', () => {
  const active = (path: string) => SIDE_ITEMS.filter((i) => isNavActive(i, path, 'side')).map((i) => i.label);

  it.each([
    ['/', ['Главная']],
    ['/transactions', ['Операции']],
    ['/wallets', ['Кошельки']],
    ['/budgets', ['Бюджеты']],
    ['/analytics', ['Аналитика']],
    ['/recurring', ['Регулярные платежи']],
    ['/shopping', ['Покупки']],
    ['/debts', ['Долги']],
    ['/rates', ['Курсы валют']],
    ['/weather', ['Погода']],
    ['/more', []], // на ПК пункта «Ещё» нет
    ['/import', ['Настройки']],
    ['/settings/categories', ['Настройки']],
    ['/settings', ['Настройки']],
    ['/settings/', ['Настройки']],
  ])('на %s подсвечено: %j', (path, expected) => {
    expect(active(path)).toEqual(expected);
  });

  it('на неизвестном адресе не подсвечено ничего', () => {
    expect(active('/нет-такого')).toEqual([]);
  });
});
