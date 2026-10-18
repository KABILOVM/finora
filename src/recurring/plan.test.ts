import { afterEach, describe, expect, it } from 'vitest';
import { addDays } from '@/lib/dates';
import {
  AUTO_POST_MAX_AGE_DAYS,
  autoPostDates,
  autoPostWindow,
  collectCandidates,
  FORECAST_OVERDUE_MAX_AGE_DAYS,
  historyFrom,
  isAutoPostRule,
  localDateOf,
} from './plan';

/** Для проверок задаём «местную дату создания» напрямую: результат не должен зависеть от часового пояса машины. */
const created = (day: string) => () => day;

/** По умолчанию правило «не правили с создания»: метка последней правки равна метке создания. */
const rule = (over: Record<string, unknown> = {}) => {
  const base = {
    id: 'r1',
    frequency: 'daily' as const,
    intervalN: 1,
    startOn: '2026-01-01',
    endOn: null as string | null,
    createdAt: '2026-10-01T10:00:00.000Z',
    autoPost: 1 as const,
    archivedAt: null as string | null,
    deletedAt: null as string | null,
    ...over,
  };
  return { clientUpdatedAt: base.createdAt, ...base, ...over };
};

/** Местная дата зависит от того, какую метку переводят: создание и правка могут приходить в разные дни. */
const byStamp = (days: Record<string, string>) => (iso: string) => days[iso] ?? null;

const TODAY = '2026-10-11';

describe('autoPostWindow: историю не проводим', () => {
  it('берётся самая поздняя из четырёх границ: начало расписания, день создания, день последней правки, сегодня − 60 дней', () => {
    // начало позже всех
    expect(autoPostWindow(rule({ startOn: '2026-10-05' }), TODAY, created('2026-10-01'))).toEqual({ from: '2026-10-05', to: TODAY });
    // создано позже всех
    expect(autoPostWindow(rule({ startOn: '2026-01-01' }), TODAY, created('2026-10-09'))).toEqual({ from: '2026-10-09', to: TODAY });
    // оба раньше окна в 60 дней
    expect(autoPostWindow(rule({ startOn: '2025-01-01' }), TODAY, created('2025-01-02'))).toEqual({ from: addDays(TODAY, -AUTO_POST_MAX_AGE_DAYS), to: TODAY });
  });

  describe('день последней правки', () => {
    const CREATED = '2026-01-05T08:00:00.000Z';
    const EDITED = '2026-10-08T08:00:00.000Z';
    const at = byStamp({ [CREATED]: '2026-01-05', [EDITED]: '2026-10-08' });

    it('правка позже всех границ: всё до дня правки остаётся «Просроченным» (поправили день платежа, включили автоплатёж, вернули из архива)', () => {
      const r = rule({ frequency: 'monthly', startOn: '2026-01-06', createdAt: CREATED, clientUpdatedAt: EDITED });
      expect(autoPostWindow(r, '2026-10-11', at)).toEqual({ from: '2026-10-08', to: '2026-10-11' });
      // 6 сентября и 6 октября — даты НОВОГО расписания, они раньше правки: сами не проводятся
      expect(autoPostDates(r, '2026-10-11', at)).toEqual([]);
    });

    it('в день правки сам платёж этого дня ещё проводится (создали правило на сегодня — оно сразу проводится)', () => {
      const r = rule({ frequency: 'monthly', startOn: '2026-01-08', createdAt: CREATED, clientUpdatedAt: EDITED });
      expect(autoPostDates(r, '2026-10-08', at)).toEqual(['2026-10-08']);
      expect(autoPostDates(r, '2026-10-11', at)).toEqual(['2026-10-08']); // день правки входит в окно и через три дня
      expect(autoPostDates(r, '2026-10-07', at)).toEqual([]); // «сегодня» раньше метки правки (часы разошлись) — платежа на 7-е в расписании нет
    });

    it('после правки платежи по новому расписанию проводятся как обычно', () => {
      const r = rule({ frequency: 'weekly', startOn: '2026-01-05', createdAt: CREATED, clientUpdatedAt: EDITED });
      expect(autoPostDates(r, '2026-10-20', at)).toEqual(['2026-10-12', '2026-10-19']);
    });

    it('не правили с создания — окно прежнее (доведение пропущенных дней после долгого неоткрытия приложения)', () => {
      const r = rule({ frequency: 'weekly', startOn: '2026-09-11', createdAt: CREATED, clientUpdatedAt: CREATED });
      expect(autoPostDates(r, '2026-10-11', byStamp({ [CREATED]: '2026-09-11' }))).toEqual(['2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09']);
    });

    it('метка правки из будущего (часы убегали вперёд) сегодняшний платёж не откладывает', () => {
      const r = rule({ frequency: 'daily', startOn: '2026-01-05', createdAt: CREATED, clientUpdatedAt: '2026-11-30T08:00:00.000Z' });
      const w = autoPostWindow(r, '2026-10-11', byStamp({ [CREATED]: '2026-01-05', '2026-11-30T08:00:00.000Z': '2026-11-30' }));
      expect(w).toEqual({ from: '2026-10-11', to: '2026-10-11' });
    });

    it('метку правки не прочитать — историю не трогаем, только сегодня', () => {
      expect(autoPostWindow(rule({ createdAt: CREATED, clientUpdatedAt: 'мусор' }), '2026-10-11', byStamp({ [CREATED]: '2026-01-05' }))).toEqual({
        from: '2026-10-11',
        to: '2026-10-11',
      });
      expect(autoPostDates(rule({ createdAt: CREATED, clientUpdatedAt: '' }), '2026-10-11', byStamp({ [CREATED]: '2026-01-05' }))).toEqual(['2026-10-11']);
    });

    it('день правки считается по местным часам, а не по UTC', () => {
      const saved = process.env['TZ'];
      try {
        process.env['TZ'] = 'Asia/Dushanbe'; // UTC+5: 20:00 UTC уже следующий день
        const r = rule({ startOn: '2026-01-01', createdAt: CREATED, clientUpdatedAt: '2026-10-10T20:00:00.000Z' });
        expect(autoPostWindow(r, '2026-10-11')).toEqual({ from: '2026-10-11', to: '2026-10-11' });
        process.env['TZ'] = 'America/Los_Angeles';
        expect(autoPostWindow(r, '2026-10-11')).toEqual({ from: '2026-10-10', to: '2026-10-11' });
      } finally {
        if (saved === undefined) delete process.env['TZ'];
        else process.env['TZ'] = saved;
      }
    });
  });

  it('ровно 60 дней назад ещё входит, 61 — уже нет', () => {
    const w = autoPostWindow(rule({ startOn: '2000-01-01' }), TODAY, created('2000-01-01'));
    expect(w?.from).toBe('2026-08-12'); // 2026-10-11 − 60 дней
    const dates = autoPostDates(rule({ startOn: '2000-01-01' }), TODAY, created('2000-01-01'));
    expect(dates[0]).toBe('2026-08-12');
    expect(dates).toHaveLength(61);
    expect(dates).not.toContain('2026-08-11');
  });

  it('правило создано сегодня с началом вчера: вчерашнюю дату автоматика не берёт, сегодняшнюю — берёт', () => {
    const dates = autoPostDates(rule({ startOn: '2026-10-10' }), TODAY, created(TODAY));
    expect(dates).toEqual([TODAY]);
  });

  it('начало в будущем или создано «в будущем» — проводить нечего', () => {
    expect(autoPostWindow(rule({ startOn: '2026-10-12' }), TODAY, created('2026-10-01'))).toBeNull();
    expect(autoPostWindow(rule(), TODAY, created('2026-10-12'))).toBeNull();
    expect(autoPostDates(rule({ startOn: '2026-10-12' }), TODAY, created('2026-10-01'))).toEqual([]);
  });

  it('метку создания не прочитать — только сегодняшний день (историю не трогаем)', () => {
    expect(autoPostWindow(rule({ createdAt: 'мусор' }), TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(autoPostDates(rule({ createdAt: '' }), TODAY)).toEqual([TODAY]);
  });

  it('сегодняшняя дата нечитаема — ничего не проводим', () => {
    expect(autoPostWindow(rule(), '2026-02-30', created('2026-10-01'))).toBeNull();
    expect(autoPostDates(rule(), 'вчера', created('2026-10-01'))).toEqual([]);
  });

  it('дата окончания обрезает окно; пустое окно после окончания даёт пусто', () => {
    const dates = autoPostDates(rule({ startOn: '2026-10-01', endOn: '2026-10-03' }), TODAY, created('2026-10-01'));
    expect(dates).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(autoPostDates(rule({ startOn: '2026-01-01', endOn: '2026-06-30' }), TODAY, created('2026-01-01'))).toEqual([]);
  });
});

describe('historyFrom: с какого дня прошлые даты правила «настоящие» (общая граница автоплатежа и прогноза)', () => {
  const CREATED = '2026-01-05T08:00:00.000Z';
  const EDITED = '2026-10-08T08:00:00.000Z';
  const at = byStamp({ [CREATED]: '2026-01-05', [EDITED]: '2026-10-08' });

  it('самая поздняя из границ: начало расписания, создание, правка, сегодня − maxAge', () => {
    expect(historyFrom(rule({ startOn: '2026-10-05' }), TODAY, 31, created('2026-10-01'))).toBe('2026-10-05');
    expect(historyFrom(rule({ startOn: '2026-01-01' }), TODAY, 31, created('2026-10-09'))).toBe('2026-10-09');
    expect(historyFrom(rule({ startOn: '2025-01-01' }), TODAY, 31, created('2025-01-02'))).toBe(addDays(TODAY, -31));
    expect(historyFrom(rule({ startOn: '2026-01-06', createdAt: CREATED, clientUpdatedAt: EDITED }), TODAY, 31, at)).toBe('2026-10-08');
  });

  it('метка правки из будущего не сдвигает границу дальше сегодняшнего дня; нечитаемые метки — сегодня', () => {
    const future = byStamp({ [CREATED]: '2026-01-05', '2030-01-01T00:00:00.000Z': '2030-01-01' });
    expect(historyFrom(rule({ startOn: '2026-01-06', createdAt: CREATED, clientUpdatedAt: '2030-01-01T00:00:00.000Z' }), TODAY, 31, future)).toBe(TODAY);
    expect(historyFrom(rule({ createdAt: 'мусор', clientUpdatedAt: 'мусор' }), TODAY, 31, () => null)).toBe(TODAY);
  });

  it('sinceEdit: false — без границы последней правки (прогнозу правка не отменяет неоплаченную дату)', () => {
    const r = rule({ startOn: '2026-01-06', createdAt: CREATED, clientUpdatedAt: EDITED });
    expect(historyFrom(r, TODAY, 31, at)).toBe('2026-10-08');
    expect(historyFrom(r, TODAY, 31, at, { sinceEdit: false })).toBe(addDays(TODAY, -31));
  });

  it('может быть позже сегодня (правило начнётся позже); сегодняшняя дата нечитаема — null', () => {
    expect(historyFrom(rule({ startOn: '2026-12-01' }), TODAY, 31, created('2026-10-01'))).toBe('2026-12-01');
    expect(historyFrom(rule(), 'вчера', 31, created('2026-10-01'))).toBeNull();
  });

  it('прогноз смотрит на месяц назад, автоплатёж — на 60 дней: окно автоплатежа не изменилось', () => {
    expect(FORECAST_OVERDUE_MAX_AGE_DAYS).toBe(31);
    const old = rule({ startOn: '2025-01-01' });
    expect(historyFrom(old, TODAY, FORECAST_OVERDUE_MAX_AGE_DAYS, created('2025-01-02'))).toBe(addDays(TODAY, -31));
    expect(autoPostWindow(old, TODAY, created('2025-01-02'))).toEqual({ from: historyFrom(old, TODAY, AUTO_POST_MAX_AGE_DAYS, created('2025-01-02')), to: TODAY });
  });
});

describe('autoPostDates: расписание в окне', () => {
  it('конец месяца: платёж на 31-е в коротком месяце — последний день месяца', () => {
    const r = rule({ frequency: 'monthly', startOn: '2026-01-31', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(autoPostDates(r, '2026-03-01', created('2026-01-01'))).toEqual(['2026-01-31', '2026-02-28']);
    // окно в 60 дней от 30 апреля начинается 1 марта: январь и февраль уже история
    expect(autoPostDates(r, '2026-04-30', created('2026-01-01'))).toEqual(['2026-03-31', '2026-04-30']);
  });

  it('високосный год: 29 февраля — и в невисокосный 28-го', () => {
    const r = rule({ frequency: 'yearly', startOn: '2024-02-29' });
    expect(autoPostDates(r, '2024-03-01', created('2024-01-01'))).toEqual(['2024-02-29']);
    expect(autoPostDates(r, '2025-03-01', created('2025-01-01'))).toEqual(['2025-02-28']);
    expect(autoPostDates(r, '2028-03-01', created('2028-01-01'))).toEqual(['2028-02-29']);
  });

  it('раз в 2 недели: шаг сохраняется от якоря', () => {
    const r = rule({ frequency: 'weekly', intervalN: 2, startOn: '2026-09-04' });
    expect(autoPostDates(r, TODAY, created('2026-09-01'))).toEqual(['2026-09-04', '2026-09-18', '2026-10-02']);
  });

  it('граница суток: сегодня платёж — входит; завтра — нет', () => {
    const r = rule({ frequency: 'monthly', startOn: '2026-09-12' });
    expect(autoPostDates(r, '2026-10-11', created('2026-09-01'))).toEqual(['2026-09-12']);
    expect(autoPostDates(r, '2026-10-12', created('2026-09-01'))).toEqual(['2026-09-12', '2026-10-12']);
  });
});

describe('localDateOf: местная дата устройства, а не UTC', () => {
  const saved = process.env['TZ'];
  afterEach(() => {
    if (saved === undefined) delete process.env['TZ'];
    else process.env['TZ'] = saved;
  });

  it('одна и та же метка — разные местные даты в разных поясах', () => {
    process.env['TZ'] = 'Asia/Dushanbe'; // UTC+5: 20:00 UTC уже следующий день
    expect(localDateOf('2026-10-10T20:00:00.000Z')).toBe('2026-10-11');
    process.env['TZ'] = 'America/Los_Angeles'; // UTC−7
    expect(localDateOf('2026-10-10T20:00:00.000Z')).toBe('2026-10-10');
    expect(localDateOf('2026-10-11T03:00:00.000Z')).toBe('2026-10-10');
    process.env['TZ'] = 'Pacific/Kiritimati'; // UTC+14
    expect(localDateOf('2026-10-10T12:00:00.000Z')).toBe('2026-10-11');
  });

  it('нечитаемая метка — null', () => {
    expect(localDateOf('')).toBeNull();
    expect(localDateOf('вчера')).toBeNull();
    expect(localDateOf(undefined as never)).toBeNull();
  });

  it('правило, созданное поздним вечером по UTC, в Душанбе считается созданным на следующий день', () => {
    process.env['TZ'] = 'Asia/Dushanbe';
    const r = rule({ startOn: '2026-10-01', createdAt: '2026-10-10T20:00:00.000Z' });
    expect(autoPostWindow(r, '2026-10-11')).toEqual({ from: '2026-10-11', to: '2026-10-11' });
    process.env['TZ'] = 'America/Los_Angeles';
    expect(autoPostWindow(r, '2026-10-11')).toEqual({ from: '2026-10-10', to: '2026-10-11' });
  });
});

describe('collectCandidates / isAutoPostRule', () => {
  it('только правила «Проводить само», живые и не в архиве', () => {
    const rules = [
      rule({ id: 'a' }),
      rule({ id: 'manual', autoPost: 0 }),
      rule({ id: 'arch', archivedAt: '2026-10-01T00:00:00.000Z' }),
      rule({ id: 'del', deletedAt: '2026-10-01T00:00:00.000Z' }),
    ];
    expect(rules.map((r) => isAutoPostRule(r))).toEqual([true, false, false, false]);
    const got = collectCandidates(rules, TODAY, created('2026-10-10'));
    expect(new Set(got.map((c) => c.rule.id))).toEqual(new Set(['a']));
    expect(got.map((c) => c.date)).toEqual(['2026-10-10', '2026-10-11']);
  });

  it('старые даты первыми; при равной дате — по времени создания, затем по id', () => {
    const rules = [
      rule({ id: 'b', createdAt: '2026-10-02T00:00:00.000Z', startOn: '2026-10-10' }),
      rule({ id: 'a', createdAt: '2026-10-02T00:00:00.000Z', startOn: '2026-10-10' }),
      rule({ id: 'c', createdAt: '2026-10-01T00:00:00.000Z', startOn: '2026-10-10' }),
    ];
    const got = collectCandidates(rules, '2026-10-10', created('2026-10-01'));
    expect(got.map((c) => c.rule.id)).toEqual(['c', 'a', 'b']);
  });

  it('пустой список правил — пустой результат', () => {
    expect(collectCandidates([], TODAY)).toEqual([]);
  });
});
