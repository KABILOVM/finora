import { exponentOf } from '@/domain/currency';
import type { CurrencyCode, Minor } from '@/domain/types';
import { CATALOG } from '@/features/categories/catalog/catalogData';
import { findGroupCategory, nameKey, type ExistingCategory } from '@/features/categories/catalog/catalogPlan';

/**
 * Шаблоны лимитов: «50 / 30 / 20», «Семья», «Студент» и другие. Шаблон — это доли месячного дохода по наборам категорий (коммунальные,
 * продукты, транспорт…) и доля, которую человек откладывает. По доходу и своим категориям человека считаются лимиты на месяц: человек видит
 * их списком, отмечает, какие поставить, и ставит одним нажатием. Чистая логика без базы и React.
 */

/** Набор категорий, на который ставится доля: slug набора из каталога готовых категорий или 'other' («Прочее»). */
export interface TemplateLine {
  group: string;
  /** Доля дохода в процентах (может быть дробной: 2.5). */
  percent: number;
}

export interface BudgetTemplate {
  id: string;
  name: string;
  /** Одной строкой, что за шаблон. */
  tagline: string;
  /** Для кого и как считается. */
  about: string;
  /** Сколько процентов дохода остаётся на накопления: на них лимита нет, они только вычитаются из общего лимита. */
  savingsPercent: number;
  lines: readonly TemplateLine[];
}

const L = (group: string, percent: number): TemplateLine => ({ group, percent });

export const BUDGET_TEMPLATES: readonly BudgetTemplate[] = [
  {
    id: 'rule-50-30-20',
    name: '50 / 30 / 20',
    tagline: '50% нужное · 30% желания · 20% накопления',
    about: 'Классика: половина дохода на обязательное (жильё, еда, транспорт, здоровье), треть на желания, пятая часть откладывается.',
    savingsPercent: 20,
    lines: [
      L('housing', 15), L('utilities', 6), L('communication', 3), L('groceries', 14), L('transport', 6), L('health', 3), L('debts', 3),
      L('dining', 6), L('shopping', 6), L('entertainment', 5), L('beauty', 3), L('subscriptions', 2), L('travel', 3), L('celebrations', 3), L('other', 2),
    ],
  },
  {
    id: 'family',
    name: 'Семья с детьми',
    tagline: 'Больше на продукты, детей и образование',
    about: 'Для семьи: основная часть уходит на жильё и продукты, отдельно — на детей, учёбу и здоровье.',
    savingsPercent: 7,
    lines: [
      L('housing', 18), L('utilities', 7), L('communication', 3), L('groceries', 25), L('transport', 7), L('family', 10), L('health', 5),
      L('education', 5), L('shopping', 5), L('entertainment', 3), L('dining', 3), L('celebrations', 2),
    ],
  },
  {
    id: 'single',
    name: 'Один человек',
    tagline: 'Жильё, еда и немного на себя',
    about: 'Для тех, кто живёт один: жильё и еда — основная часть, остальное — на жизнь и отдых, десятая часть откладывается.',
    savingsPercent: 10,
    lines: [
      L('housing', 25), L('utilities', 5), L('communication', 3), L('groceries', 14), L('dining', 8), L('transport', 7), L('health', 3),
      L('shopping', 8), L('entertainment', 6), L('subscriptions', 2), L('beauty', 3), L('travel', 4), L('debts', 2),
    ],
  },
  {
    id: 'student',
    name: 'Студент / минимум',
    tagline: 'Только самое нужное',
    about: 'Когда денег немного: жильё, продукты, дорога и связь, небольшая часть на отдых.',
    savingsPercent: 5,
    lines: [
      L('housing', 25), L('utilities', 8), L('groceries', 30), L('transport', 10), L('communication', 5), L('health', 3),
      L('dining', 5), L('entertainment', 4), L('shopping', 5),
    ],
  },
  {
    id: 'saver',
    name: 'Копим 30%',
    tagline: 'Треть дохода откладываем',
    about: 'Для накопления на цель: самое нужное и скромные желания, 30% дохода уходит в накопления.',
    savingsPercent: 30,
    lines: [
      L('housing', 20), L('utilities', 6), L('communication', 3), L('groceries', 18), L('transport', 6), L('health', 3), L('debts', 4),
      L('dining', 3), L('shopping', 3), L('entertainment', 3), L('subscriptions', 1),
    ],
  },
];

export const templateById = (id: string): BudgetTemplate | undefined => BUDGET_TEMPLATES.find((t) => t.id === id);

/** Название набора для подсказки «нет категории…». */
const groupName = (slug: string): string => CATALOG.find((g) => g.slug === slug)?.name ?? 'Прочее';

/** Названия, под которыми человек мог завести «Прочее» (в каталоге такого набора нет). */
const OTHER_NAMES = ['прочее', 'другое', 'разное', 'остальное'].map(nameKey);

export interface TemplateRow {
  /** null — общий лимит на все расходы. */
  categoryId: string | null;
  name: string;
  /** Набор шаблона (для значка); у общего лимита — 'total'. */
  group: string;
  percent: number;
  amountMinor: Minor;
  /** Сумма лимита, который уже стоит (в основной валюте); null — лимита нет. */
  currentMinor: Minor | null;
}

export interface TemplateResult {
  rows: TemplateRow[];
  /** Наборы шаблона, для которых у человека нет категории: лимит на них поставить некуда. */
  missing: { group: string; name: string; percent: number }[];
  /** Сколько остаётся на накопления по шаблону. */
  savingsMinor: Minor;
  /** Проценты шаблона, которые попали в лимиты (без накоплений и без пропавших наборов). */
  coveredPercent: number;
}

/** Округление «по-человечески»: 1 234 → 1 200, 85 → 85, 12 345 → 12 300 (два значащих знака), не меньше целой денежной единицы. */
export function niceMinor(minor: Minor, currency: CurrencyCode): Minor {
  const unit = 10 ** exponentOf(currency);
  const major = minor / unit;
  if (!Number.isFinite(major) || major <= 0) return 0;
  if (major < 10) return Math.max(1, Math.round(major)) * unit;
  const step = 10 ** (Math.floor(Math.log10(major)) - 1);
  return Math.round(major / step) * step * unit;
}

const amountOf = (income: Minor, percent: number, currency: CurrencyCode): Minor => niceMinor((income * percent) / 100, currency);

/**
 * Лимиты по шаблону: доход × доля набора для каждой категории человека, которая этому набору соответствует (по названию и синонимам,
 * как в каталоге готовых категорий). Первой строкой — общий лимит на все расходы: доход без накоплений. Суммы округлены; строки с нулевой
 * суммой не создаются. `limits` — уже стоящие лимиты (id категории → сумма, общий — под ключом 'total').
 */
export function buildTemplateRows(
  template: BudgetTemplate,
  incomeMinor: Minor,
  categories: readonly ExistingCategory[],
  limits: ReadonlyMap<string, Minor>,
  currency: CurrencyCode,
): TemplateResult {
  const rows: TemplateRow[] = [];
  const missing: TemplateResult['missing'] = [];
  const used = new Set<string>();
  let covered = 0;
  if (Number.isSafeInteger(incomeMinor) && incomeMinor > 0) {
    for (const line of template.lines) {
      const cat =
        line.group === 'other'
          ? (categories.find((c) => c.kind === 'expense' && !c.archived && c.parentId === null && OTHER_NAMES.includes(nameKey(c.name))) ?? null)
          : findGroupCategory(categories, line.group);
      if (!cat || used.has(cat.id)) {
        if (!cat) missing.push({ group: line.group, name: groupName(line.group), percent: line.percent });
        continue;
      }
      const amountMinor = amountOf(incomeMinor, line.percent, currency);
      if (amountMinor <= 0) continue;
      used.add(cat.id);
      covered += line.percent;
      rows.push({ categoryId: cat.id, name: cat.name, group: line.group, percent: line.percent, amountMinor, currentMinor: limits.get(cat.id) ?? null });
    }
    const totalPercent = 100 - template.savingsPercent;
    const total = amountOf(incomeMinor, totalPercent, currency);
    if (total > 0) rows.unshift({ categoryId: null, name: 'Общий лимит на все расходы', group: 'total', percent: totalPercent, amountMinor: total, currentMinor: limits.get('total') ?? null });
  }
  return { rows, missing, savingsMinor: amountOf(incomeMinor > 0 ? incomeMinor : 0, template.savingsPercent, currency), coveredPercent: covered };
}

/** Какие строки отмечены заранее: все, у которых лимита ещё нет (стоящие лимиты человека не трогаем, пока он сам не отметит). */
export function defaultRowKeys(rows: readonly TemplateRow[]): Set<string> {
  return new Set(rows.filter((r) => r.currentMinor === null).map(rowKey));
}

export const rowKey = (r: Pick<TemplateRow, 'categoryId'>): string => r.categoryId ?? 'total';
