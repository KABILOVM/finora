import { describe, expect, it } from 'vitest';
import { changeText, percentChange, periodTitle, rangeText } from './periodText';
import { customProblem, defaultSelection, effectiveCompare, parseSelection, resolvePeriod, selectionToParams, type PeriodSelection } from './periodParams';
import { customPeriod, quarterPeriod, yearPeriod } from './periods';

const TODAY = '2026-10-15';
const q = (s: string) => new URLSearchParams(s);

describe('выбор периода в адресе', () => {
  it('пустой адрес — идущий год, сравнение с предыдущим', () => {
    expect(parseSelection(q(''), TODAY)).toEqual({
      kind: 'year',
      year: 2026,
      quarter: 4,
      from: '2026-09-16',
      to: TODAY,
      cmp: 'prev',
    });
    expect(defaultSelection(TODAY)).toEqual(parseSelection(q(''), TODAY));
  });

  it('читает год, квартал, свои даты и вид сравнения', () => {
    expect(parseSelection(q('kind=quarter&year=2025&q=2&cmp=yoy'), TODAY)).toMatchObject({ kind: 'quarter', year: 2025, quarter: 2, cmp: 'yoy' });
    expect(parseSelection(q('kind=custom&from=2026-03-01&to=2026-04-15&cmp=none'), TODAY)).toMatchObject({ kind: 'custom', from: '2026-03-01', to: '2026-04-15', cmp: 'none' });
    expect(parseSelection(q('year=2024'), TODAY)).toMatchObject({ kind: 'year', year: 2024 });
  });

  it('мусор заменяется умолчаниями: вид, сравнение, год (будущий, ранний, не число), квартал, даты', () => {
    expect(parseSelection(q('kind=weird&cmp=sideways'), TODAY)).toMatchObject({ kind: 'year', cmp: 'prev' });
    for (const bad of ['2027', '1999', 'abc', '', '-1', '20260', '2026.5']) expect(parseSelection(q(`year=${bad}`), TODAY).year, bad).toBe(2026);
    for (const bad of ['0', '5', 'x', '']) expect(parseSelection(q(`kind=quarter&q=${bad}`), TODAY).quarter, bad).toBe(4);
    expect(parseSelection(q('from=вчера&to=2026-02-30x'), TODAY)).toMatchObject({ from: '2026-09-16', to: TODAY });
  });

  it('квартал нынешнего года не дальше нынешнего; в прошлом году — любой', () => {
    expect(parseSelection(q('kind=quarter&year=2026&q=4'), TODAY).quarter).toBe(4);
    expect(parseSelection(q('kind=quarter&year=2026&q=4'), '2026-05-10').quarter).toBe(2); // нынешний квартал II
    expect(parseSelection(q('kind=quarter&year=2025&q=4'), '2026-05-10').quarter).toBe(4);
  });

  it('в адрес — только отличное от умолчаний и нужное виду периода', () => {
    const sel = (over = {}) => ({ ...defaultSelection(TODAY), ...over });
    expect(selectionToParams(sel(), TODAY).toString()).toBe('');
    expect(selectionToParams(sel({ year: 2025 }), TODAY).toString()).toBe('year=2025');
    expect(selectionToParams(sel({ cmp: 'none' }), TODAY).toString()).toBe('cmp=none');
    expect(selectionToParams(sel({ kind: 'quarter' }), TODAY).toString()).toBe('kind=quarter');
    expect(selectionToParams(sel({ kind: 'quarter', quarter: 2 }), TODAY).toString()).toBe('kind=quarter&q=2');
    expect(selectionToParams(sel({ kind: 'quarter', year: 2025, quarter: 4 }), TODAY).toString()).toBe('kind=quarter&year=2025&q=4');
    expect(selectionToParams(sel({ kind: 'custom', from: '2026-03-01', to: '2026-04-15' }), TODAY).toString()).toBe('kind=custom&from=2026-03-01&to=2026-04-15');
    // год в адресе квартала не мешается с «годом» вида «год»; даты чужого вида в адрес не попадают
    expect(selectionToParams(sel({ kind: 'year', quarter: 1, from: '2026-03-01' }), TODAY).toString()).toBe('');
  });

  it('свойство: выбор → адрес → выбор возвращает тот же выбор', () => {
    const cases: Partial<PeriodSelection>[] = [
      { kind: 'year', year: 2024, quarter: 4, cmp: 'none' },
      { kind: 'quarter', year: 2025, quarter: 1, cmp: 'yoy' },
      { kind: 'custom', from: '2026-03-01', to: '2026-04-15', cmp: 'prev' },
    ];
    const effective = (s: PeriodSelection) => ({
      kind: s.kind,
      cmp: s.cmp,
      ...(s.kind === 'year' ? { year: s.year } : {}),
      ...(s.kind === 'quarter' ? { year: s.year, quarter: s.quarter } : {}),
      ...(s.kind === 'custom' ? { from: s.from, to: s.to } : {}),
    });
    for (const c of cases) {
      const sel: PeriodSelection = { ...defaultSelection(TODAY), ...c };
      expect(effective(parseSelection(selectionToParams(sel, TODAY), TODAY))).toEqual(effective(sel));
    }
  });

  it('resolvePeriod: по виду; негодные даты — null', () => {
    const base = defaultSelection(TODAY);
    expect(resolvePeriod(base, TODAY)).toEqual(yearPeriod(2026, TODAY));
    expect(resolvePeriod({ ...base, kind: 'quarter', quarter: 2 }, TODAY)).toEqual(quarterPeriod(2026, 2, TODAY));
    expect(resolvePeriod({ ...base, kind: 'custom', from: '2026-03-01', to: '2026-04-15' }, TODAY)).toEqual(customPeriod('2026-03-01', '2026-04-15', TODAY));
    expect(resolvePeriod({ ...base, kind: 'custom', from: '2026-05-01', to: '2026-04-15' }, TODAY)).toBeNull();
  });

  it('effectiveCompare: для года «год назад» — то же, что «предыдущий»', () => {
    expect(effectiveCompare('year', 'yoy')).toBe('prev');
    expect(effectiveCompare('year', 'none')).toBe('none');
    expect(effectiveCompare('quarter', 'yoy')).toBe('yoy');
    expect(effectiveCompare('custom', 'yoy')).toBe('yoy');
  });
});

describe('тексты периода', () => {
  it('заголовки и даты', () => {
    expect(periodTitle(yearPeriod(2026, TODAY)!)).toBe('2026 год');
    expect(periodTitle(quarterPeriod(2026, 3, TODAY)!)).toBe('3-й квартал 2026');
    expect(periodTitle(customPeriod('2026-03-01', '2026-04-15', TODAY)!)).toBe('01.03.2026 — 15.04.2026');
    expect(rangeText({ from: '2025-01-01', to: '2025-10-15' })).toBe('01.01.2025 — 15.10.2025');
  });

  it('percentChange: от нуля вверх, без прежнего — null', () => {
    expect(percentChange(112, 100)).toBe(12);
    expect(percentChange(92, 100)).toBe(-8);
    expect(percentChange(1125, 1000)).toBe(13); // 12,5% → 13
    expect(percentChange(875, 1000)).toBe(-13);
    expect(percentChange(100, 100)).toBe(0);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 100)).toBe(-100);
    expect(percentChange(Number.NaN, 100)).toBeNull();
  });

  it('changeText', () => {
    expect(changeText(112, 100)).toBe('▲ +12%');
    expect(changeText(92, 100)).toBe('▼ −8%');
    expect(changeText(100, 100)).toBe('без изменений');
    expect(changeText(5, 0)).toBeNull();
  });
});

describe('customProblem: что не так с датами своего периода', () => {
  it('годные даты — без замечаний, в том числе один день и конец в будущем (его подрежут до сегодня)', () => {
    expect(customProblem('2026-03-01', '2026-03-31', TODAY)).toBeNull();
    expect(customProblem('2026-03-05', '2026-03-05', TODAY)).toBeNull();
    expect(customProblem('2026-10-01', '2026-12-31', TODAY)).toBeNull();
  });

  it.each([
    ['', '2026-03-01', 'Укажите обе даты'],
    ['2026-03-01', 'не дата', 'Укажите обе даты'],
    ['1999-12-31', '2026-03-01', 'Начало не раньше 2000 года'],
    ['2026-10-16', '2026-10-20', 'Начало периода ещё не наступило'],
    ['2026-03-10', '2026-03-01', 'Начало позже конца'],
    ['2020-01-01', '2026-03-01', 'Период не длиннее пяти лет'],
  ])('%s — %s → %s', (from, to, expected) => expect(customProblem(from, to, TODAY)).toBe(expected));

  it('согласуется с customPeriod: замечания нет ровно тогда, когда период получился', () => {
    for (const [from, to] of [['2026-03-01', '2026-03-31'], ['2026-03-10', '2026-03-01'], ['2020-01-01', '2026-03-01'], ['2026-10-16', '2026-10-20'], ['2026-10-01', '2026-12-31']] as const) {
      expect(customProblem(from, to, TODAY) === null).toBe(resolvePeriod({ ...defaultSelection(TODAY), kind: 'custom', from, to }, TODAY) !== null);
    }
  });
});
