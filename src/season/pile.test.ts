import { describe, expect, it } from 'vitest';
import { accentCorner, capClear, capFill, capLand, capVolume, COLUMN, cornerDrop, makeCap, makeScatter, particleCount, scatterLand, shiftClock, usableLedge } from './pile';

/** Предсказуемые «случайные» числа для тестов. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('сугроб на блоке (makeCap, capLand)', () => {
  it('столбики по 4 px; в середине предел полный, к скруглённым углам сходит на нет', () => {
    const cap = makeCap(200, 8, 16);
    expect(COLUMN).toBe(4);
    expect(cap.h).toHaveLength(50);
    expect(capVolume(cap)).toBe(0);
    expect(cap.limit[25]).toBe(8);
    for (let i = 1; i <= 25; i++) expect(cap.limit[i]!, `столбик ${i}`).toBeGreaterThanOrEqual(cap.limit[i - 1]!);
    expect(cap.limit[1]!).toBeGreaterThan(0);
    expect(cap.limit[1]!).toBeLessThan(8);
    expect(cap.limit[4]).toBe(8); // дальше радиуса угла — уже полный предел
    for (let i = 0; i < 25; i++) expect(cap.limit[49 - i], `симметрия ${i}`).toBe(cap.limit[i]);
  });

  it('на самом скруглении, где контур блока ушёл вниз больше чем на 5 px, снег не лежит: он висел бы в воздухе', () => {
    // радиус 16: в 2 px от края контур ниже верхнего края на 8 px, в 6 px — на 3,5
    expect(makeCap(200, 8, 16).limit[0]).toBe(0);
    expect(makeCap(200, 8, 16).limit[1]!).toBeGreaterThan(0);
    // радиус 24: в 2 и 6 px от края — ниже чем на 5 px, в 10 px — уже нет
    const big = makeCap(200, 8, 24);
    expect([big.limit[0], big.limit[1]]).toEqual([0, 0]);
    expect(big.limit[2]!).toBeGreaterThan(0);
    // прямой угол: снег лежит до самого края
    expect(makeCap(200, 8, 0).limit[0]!).toBeGreaterThan(0);
  });

  it('снежинка ложится: столбик под ней растёт, соседние — меньше, снег прибавляется', () => {
    const cap = makeCap(200, 8, 16);
    expect(capLand(cap, 100, 1)).toBe(true);
    expect(cap.h[25]).toBe(1);
    expect(cap.h[24]!).toBeGreaterThan(0);
    expect(cap.h[24]!).toBeLessThan(1);
    expect(cap.h[23]!).toBeLessThan(cap.h[24]!);
    expect(cap.h[22]).toBe(0);
    expect(capVolume(cap)).toBeGreaterThan(COLUMN);
  });

  it('выше предела снег не растёт; на полный столбик снежинка не ложится (летит дальше)', () => {
    const cap = makeCap(200, 8, 16);
    for (let i = 0; i < 40; i++) capLand(cap, 100, 1);
    expect(cap.h[25]).toBe(8);
    for (let i = 0; i < cap.h.length; i++) expect(cap.h[i]!).toBeLessThanOrEqual(cap.limit[i]!);
    const before = capVolume(cap);
    expect(capLand(cap, 100, 1)).toBe(false);
    expect(capVolume(cap)).toBe(before);
  });

  it('мимо блока снежинка не ложится', () => {
    const cap = makeCap(200, 8, 16);
    expect(capLand(cap, -1, 1)).toBe(false);
    expect(capLand(cap, 200, 1)).toBe(false);
    expect(capVolume(cap)).toBe(0);
  });

  it('стряхнуть — снега нет; после этого он копится заново', () => {
    const cap = makeCap(200, 8, 16);
    capFill(cap, 0.6, seq(0.5));
    expect(capVolume(cap)).toBeGreaterThan(0);
    capClear(cap);
    expect(capVolume(cap)).toBe(0);
    expect(capLand(cap, 60, 1)).toBe(true);
  });

  it('начальный снег: примерно заданная доля от полного, не выше предела', () => {
    const full = makeCap(200, 8, 16);
    capFill(full, 1, seq(1));
    const cap = makeCap(200, 8, 16);
    capFill(cap, 0.5, seq(0.2, 0.9, 0.5, 0.7));
    const share = capVolume(cap) / capVolume(full);
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.7);
    for (let i = 0; i < cap.h.length; i++) expect(cap.h[i]!).toBeLessThanOrEqual(cap.limit[i]!);
  });

  it('узкий блок: сугроб есть, пределы не отрицательные', () => {
    const cap = makeCap(40, 8, 24);
    expect(cap.h).toHaveLength(10);
    for (const l of cap.limit) expect(l).toBeGreaterThanOrEqual(0);
  });
});

describe('cornerDrop: насколько скруглённый угол ниже верхнего края', () => {
  it('у самого края — на радиус, дальше радиуса — ноль, между ними убывает', () => {
    expect(cornerDrop(0, 16)).toBe(16);
    expect(cornerDrop(16, 16)).toBe(0);
    expect(cornerDrop(40, 16)).toBe(0);
    expect(cornerDrop(4, 16)).toBeGreaterThan(cornerDrop(8, 16));
    expect(cornerDrop(8, 16)).toBeGreaterThan(0);
    expect(cornerDrop(5, 0)).toBe(0);
  });
});

describe('лежащие лепестки и листья (makeScatter, scatterLand)', () => {
  it('помещается не больше одного на каждые N px ширины и не больше общего предела', () => {
    expect(makeScatter(160, 16, 24).max).toBe(10);
    expect(makeScatter(900, 16, 24).max).toBe(24);
    const s = makeScatter(48, 16, 24);
    const item = { x: 10, sprite: 0, angle: 0, scale: 1 };
    expect(scatterLand(s, item)).toBe(true);
    expect(scatterLand(s, { ...item, x: 20 })).toBe(true);
    expect(scatterLand(s, { ...item, x: 30 })).toBe(true);
    expect(scatterLand(s, { ...item, x: 40 })).toBe(false); // места нет — летит дальше
    expect(s.items).toHaveLength(3);
  });
});

describe('usableLedge: на какие блоки ложится', () => {
  const vw = 390;
  const vh = 844;
  it('блок на экране, достаточно широкий и высокий', () => {
    expect(usableLedge({ left: 16, top: 200, width: 358, height: 120 }, vw, vh)).toBe(true);
  });
  it('не годятся: узкий, низкий, выше или ниже экрана, целиком сбоку', () => {
    expect(usableLedge({ left: 16, top: 200, width: 80, height: 120 }, vw, vh)).toBe(false);
    expect(usableLedge({ left: 16, top: 200, width: 358, height: 20 }, vw, vh)).toBe(false);
    expect(usableLedge({ left: 16, top: -30, width: 358, height: 120 }, vw, vh)).toBe(false);
    expect(usableLedge({ left: 16, top: 850, width: 358, height: 120 }, vw, vh)).toBe(false);
    expect(usableLedge({ left: 400, top: 200, width: 358, height: 120 }, vw, vh)).toBe(false);
  });
});

describe('accentCorner: «в некоторых местах»', () => {
  it('каждый третий блок, углы чередуются', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(accentCorner)).toEqual(['left', null, null, 'right', null, null, 'left']);
  });
});

describe('particleCount: сколько частиц на экране', () => {
  it('на телефоне — как в описании сезона; на большом экране больше, но с пределом; на крошечном — не меньше восьми', () => {
    expect(particleCount(36, 390, 844)).toBe(36);
    expect(particleCount(36, 1280, 800)).toBe(70);
    expect(particleCount(16, 1280, 800)).toBe(50);
    expect(particleCount(36, 200, 200)).toBe(8);
  });
});

describe('shiftClock: частица движется вместе со скроллом', () => {
  // путь длится 10 с (10 000 мс); частица падает со скоростью 50 px/с; доля скролла k
  const D = 10_000;
  it('прокрутили вниз на 100 px, k = 0,5: частица поднялась на 50 px — это 1 с пути назад', () => {
    expect(shiftClock(4000, D, 100, 0.5, 50)).toBe(3000);
  });
  it('прокрутили вверх: частица опустилась', () => {
    expect(shiftClock(4000, D, -100, 0.5, 50)).toBe(5000);
  });
  it('время не уходит за начало и за конец пути — путь повторяется по кругу', () => {
    expect(shiftClock(200, D, 100, 0.5, 50)).toBe(9200); // раньше начала — снова у конца
    expect(shiftClock(9500, D, -100, 0.5, 50)).toBe(500); // позже конца — снова у начала
    expect(shiftClock(0, D, 100_000, 1, 50)).toBeGreaterThanOrEqual(0);
    expect(shiftClock(0, D, 100_000, 1, 50)).toBeLessThan(D);
  });
  it('быстрая частица смещается во времени меньше, медленная — больше (на экране сдвиг одинаков)', () => {
    const fast = 5000 - shiftClock(5000, D, 100, 0.5, 200);
    const slow = 5000 - shiftClock(5000, D, 100, 0.5, 50);
    expect(slow / fast).toBe(4);
  });
  it('нулевая скорость или мусор — время не меняется', () => {
    expect(shiftClock(4000, D, 100, 0.5, 0)).toBe(4000);
    expect(shiftClock(4000, D, Number.NaN, 0.5, 50)).toBe(4000);
  });
});
