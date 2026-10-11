import { describe, expect, it } from 'vitest';
import { isInSection, isNavActive, MORE_SECTIONS, NAV_ITEMS } from './nav';

const item = (to: string) => {
  const found = NAV_ITEMS.find((i) => i.to === to);
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
  it.each(['/', '/transactions', '/wallets'])('«Ещё» не подсвечен на %s', (path) => {
    expect(isNavActive(item('/more'), path, 'phone')).toBe(false);
  });
  it('«Главная» только на «/»', () => {
    expect(isNavActive(item('/'), '/', 'phone')).toBe(true);
    expect(isNavActive(item('/'), '/more', 'phone')).toBe(false);
  });
  it('в нижней панели четыре пункта: Главная, Операции, Кошельки, Ещё', () => {
    expect(NAV_ITEMS.filter((i) => i.phone).map((i) => i.label)).toEqual(['Главная', 'Операции', 'Кошельки', 'Ещё']);
  });
});

describe('isNavActive: боковая панель ПК', () => {
  const active = (path: string) => NAV_ITEMS.filter((i) => i.side && isNavActive(i, path, 'side')).map((i) => i.sideLabel);

  it.each([
    ['/', ['Главная']],
    ['/transactions', ['Операции']],
    ['/wallets', ['Кошельки']],
    ['/budgets', ['Бюджеты']],
    ['/recurring', ['Платежи']],
    ['/debts', ['Долги']],
    ['/more', ['Ещё']],
    ['/import', ['Ещё']],
    ['/settings/categories', ['Ещё']],
    ['/settings', ['Настройки']],
    ['/settings/', ['Настройки']],
  ])('на %s подсвечен ровно один пункт', (path, expected) => {
    expect(active(path)).toEqual(expected);
  });

  it('на неизвестном адресе не подсвечено ничего', () => {
    expect(active('/нет-такого')).toEqual([]);
  });
});
