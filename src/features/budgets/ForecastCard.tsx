import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import type { DailyForecast, DailyForecastOk, ForecastSkipped } from '@/domain/forecast';
import { formatMinor } from '@/domain/money';
import { endSentence } from '@/features/transactions/txDisplay';
import { pluralRu } from '@/lib/plural';
import { daysText, fitFontSize, longDate } from './budgetText';

const SKIPPED_WHERE: Record<ForecastSkipped['source'], string> = {
  money: 'в кошельках',
  income: 'в доходах',
  payment: 'в платежах',
  debt: 'в долгах',
};

/** «100 $ (в кошельках), 20 $ (в платежах)» — что не вошло в расчёт из-за отсутствия курса. */
export function skippedText(skipped: readonly ForecastSkipped[]): string {
  return skipped.map((s) => `${formatMinor(s.amountMinor, s.currency)} (${SKIPPED_WHERE[s.source]})`).join(', ');
}

/** Сколько знаков в крупном числе «в день» (с «≈ »): по ним подбирается размер шрифта. */
export const perDayChars = (f: DailyForecastOk): number => formatMinor(f.effective.perDayMinor, f.base).length + (f.approximate ? 2 : 0);

/** Тратить нечего: денег не хватает или общий лимит месяца исчерпан. Тогда крупное число красное. */
export const spendBlocked = (f: DailyForecastOk): boolean =>
  f.notEnough || f.effective.budgetState === 'over' || f.effective.budgetState === 'exhausted';

/** «Лимит месяца превышен на 500 с.» / «Лимит месяца исчерпан»; null — лимит не исчерпан или его нет. */
function budgetStateText(f: DailyForecastOk): string | null {
  const b = f.budget;
  if (b === null) return null;
  if (b.overMinor > 0) return `Лимит месяца превышен на ${endSentence(formatMinor(b.overMinor, f.base))}`;
  if (b.leftMinor === 0) return 'Лимит месяца исчерпан';
  return null;
}

/** Крупное число «в день» (меньшее из «по деньгам» и «по лимиту»); «≈», если оно приблизительное. */
export function PerDay({ f, className }: { f: DailyForecastOk; className?: string }) {
  return (
    <span className={className}>
      {f.approximate && <span title="Приблизительно: часть денег пересчитана по курсу или не вошла в расчёт">≈ </span>}
      <MoneyText minor={f.effective.perDayMinor} currency={f.base} tone={spendBlocked(f) ? 'expense' : 'none'} />
    </span>
  );
}

/** Плитка с одним числом: подпись мелко, значение крупнее. Подпись и значение — dt / dd (так их читают скринридеры и тесты). */
function Tile({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`min-w-0 rounded-2xl bg-surface-2/70 px-3 py-2.5 ${wide ? 'col-span-full' : ''}`}>
      <dt className="text-xs leading-tight text-muted">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[15px] font-semibold leading-snug">{children}</dd>
    </div>
  );
}

/** Короткая отметка со значком: предупреждение (жёлтая) или тревога (красная). */
function Notice({ tone, children }: { tone: 'warning' | 'danger'; children: ReactNode }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm font-medium ${tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}
    >
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

const EXPLAIN = [
  'Деньги на руках — это остатки кошельков: наличные, карты и счета. Накопления не считаем: их тратить не нужно.',
  'Считаем от сегодня до дня перед ближайшим регулярным доходом; если его нет — до конца месяца, но не меньше недели.',
  'К деньгам прибавляем регулярные доходы до этого дня и вычитаем обязательное: регулярные платежи и переводы в накопления, которые вы ещё не провели и не пропустили (просроченные за последний месяц — тоже), и долги, которые нужно вернуть к этому сроку.',
  'Смотрим и дальше, до конца месяца: если после небольшого дохода денег на день выходит меньше (например, потом аренда), показываем меньшую цифру.',
  'Что осталось, делим на число дней и округляем вниз. Так мы никогда не обещаем больше, чем есть.',
  'Если задан общий лимит на месяц и по нему в день выходит меньше — показываем цифру по лимиту.',
  '«Обычно вы тратите» — средний расход в день за последние 30 дней без регулярных платежей и трат с накоплений.',
  'Деньги и платежи в валюте без курса в расчёт не входят — об этом написано под числом, а само число помечено «≈».',
] as const;

function ExplainPanel() {
  return (
    <ol className="relative mt-3 list-decimal space-y-1.5 rounded-2xl bg-surface-2/70 py-3 pl-8 pr-3 text-sm text-muted">
      {EXPLAIN.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ol>
  );
}

function Details({ f }: { f: DailyForecastOk }) {
  const e = f.effective;
  const over = e.spentTodayMinor > e.todayLimitMinor;
  const b = f.budget;
  const budgetAlarm = budgetStateText(f);
  return (
    <>
      <dl className="relative mt-4 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2">
        <Tile label="Деньги на руках">
          <MoneyText minor={f.moneyMinor} currency={f.base} tone={f.moneyMinor < 0 ? 'expense' : 'none'} />
        </Tile>
        {f.incomeMinor > 0 && (
          <Tile label={`Доходы до ${longDate(f.horizonEnd)}`}>
            <MoneyText minor={f.incomeMinor} currency={f.base} tone="none" sign="always" />
          </Tile>
        )}
        <Tile label={`Платежи и долги до ${longDate(f.horizonEnd)}`}>
          <MoneyText minor={-f.obligationsMinor} currency={f.base} tone="none" />
        </Tile>
        {f.usualPerDayMinor !== null && (
          <Tile label="Обычно вы тратите">
            <span className="money">{formatMinor(f.usualPerDayMinor, f.base)} в день</span>
          </Tile>
        )}
        {b && e.by === 'money' && (
          <Tile label="По бюджету на месяц">
            <span className="money">{formatMinor(b.perDayMinor, f.base)} в день</span>
          </Tile>
        )}
        {e.by === 'budget' && (
          <Tile label="По деньгам на руках">
            <span className="money">{formatMinor(f.perDayMinor, f.base)} в день</span>
          </Tile>
        )}
      </dl>

      <div className="relative mt-3 flex flex-col gap-2 empty:hidden">
        {f.overdueCount > 0 && (
          <Notice tone="warning">
            Из них просрочено {f.overdueCount} {pluralRu(f.overdueCount, 'платёж', 'платежа', 'платежей')} на{' '}
            <span className="money">{formatMinor(f.overduePaymentsMinor, f.base)}</span>.{' '}
            <Link to="/recurring" className="font-semibold underline">
              Провести или пропустить
            </Link>
          </Notice>
        )}
        {over && <Notice tone="warning">Сегодня потрачено больше нормы</Notice>}
        {f.usualPerDayMinor !== null && f.usualPerDayMinor > e.perDayMinor && !spendBlocked(f) && (
          <Notice tone="warning">Обычно тратите больше, чем можно в день</Notice>
        )}
        {budgetAlarm !== null && <Notice tone="danger">{budgetAlarm}</Notice>}
        {b && budgetAlarm === null && (
          <p className="px-1 text-sm text-muted">
            Лимит месяца {formatMinor(b.limitMinor, f.base)} · осталось {endSentence(formatMinor(b.leftMinor, f.base))}
            {b.partial && ' Часть операций не учтена.'}
          </p>
        )}
        {b && budgetAlarm !== null && b.partial && <p className="px-1 text-sm text-muted">Часть операций не учтена.</p>}
        {f.skipped.length > 0 && <Notice tone="warning">Не вошло в расчёт — нет курса: {endSentence(skippedText(f.skipped))}</Notice>}
        {f.unknownWalletPayments > 0 && (
          <Notice tone="warning">
            Не удалось учесть {f.unknownWalletPayments} {pluralRu(f.unknownWalletPayments, 'платёж', 'платежа', 'платежей')}: кошелёк не найден.
          </Notice>
        )}
      </div>
    </>
  );
}

/** Не удалось посчитать прогноз: объясняем словами, что сделать. */
function Unavailable({ forecast }: { forecast: Exclude<DailyForecast, DailyForecastOk> }) {
  const text: Record<typeof forecast.status, { title: string; text: string; action?: boolean }> = {
    'no-wallets': { title: 'Пока нечего считать', text: 'Создайте кошелёк и внесите остаток — тогда появится, сколько можно тратить в день.', action: true },
    'only-savings': { title: 'Тратить нечего', text: 'Все ваши кошельки — накопления, а их мы не считаем. Добавьте обычный кошелёк или смените вид у существующего.', action: true },
    overflow: { title: 'Не удалось посчитать', text: 'Суммы слишком большие, проверьте данные.' },
    'bad-date': { title: 'Не удалось посчитать', text: 'Не удаётся определить сегодняшнюю дату на устройстве.' },
  };
  const t = text[forecast.status];
  return (
    <Card aria-label="Сколько можно тратить в день">
      <h2 className="text-lg font-bold">{t.title}</h2>
      <p className="mt-1 text-muted">{t.text}</p>
      {t.action && (
        <Link to="/wallets" className={`${buttonClasses('secondary')} mt-3`}>
          Открыть кошельки
        </Link>
      )}
    </Card>
  );
}

/** Полоса «сегодня потрачено от дневной нормы»: красная, если норма превышена. Только картинка: те же цифры написаны словами ниже. */
function TodayBar({ f }: { f: DailyForecastOk }) {
  const { todayLimitMinor, spentTodayMinor } = f.effective;
  if (todayLimitMinor <= 0) return null;
  const ratio = spentTodayMinor / todayLimitMinor;
  const shown = Math.min(100, Math.max(0, ratio * 100));
  return (
    <div
      aria-hidden="true"
      className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2 shadow-inner"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${ratio > 1 ? 'bg-danger' : ratio > 0.8 ? 'bg-warning' : 'bg-gradient-to-r from-brand/70 to-brand'}`}
        style={{ width: `${shown > 0 ? Math.max(shown, 2) : 0}%` }}
      />
    </div>
  );
}

/** Под полосой: «Сегодня потрачено 400 с. из 176,47 с.» — одной строкой, суммы не рвутся (на узком экране «из …» переносится целиком). */
function TodayRow({ f }: { f: DailyForecastOk }) {
  return (
    <dl className="relative mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
      <dt className="text-muted">Сегодня потрачено</dt>
      <dd className="flex flex-wrap items-baseline gap-x-1.5 font-semibold">
        <span className="money">{formatMinor(f.effective.spentTodayMinor, f.base)}</span>{' '}
        <span className="font-normal text-muted">
          из <span className="money">{formatMinor(f.effective.todayLimitMinor, f.base)}</span>
        </span>
      </dd>
    </dl>
  );
}

/** Верх экрана «Бюджеты»: «Осталось на день» крупно, из чего оно сложилось и «Как это считается». */
export function ForecastCard({ forecast }: { forecast: DailyForecast | null | undefined }) {
  if (forecast === undefined) {
    return (
      <Card aria-label="Сколько можно тратить в день" aria-busy="true" className="min-h-[11rem]">
        <div className="h-4 w-32 animate-pulse rounded bg-surface-2" aria-hidden="true" />
        <div className="mt-3 h-10 w-48 animate-pulse rounded bg-surface-2" aria-hidden="true" />
      </Card>
    );
  }
  if (forecast === null) {
    return (
      <Card aria-label="Сколько можно тратить в день">
        <p className="text-muted">Настройки ещё не загружены.</p>
      </Card>
    );
  }
  if (forecast.status !== 'ok') return <Unavailable forecast={forecast} />;

  return <ForecastOk forecast={forecast} />;
}

function ForecastOk({ forecast }: { forecast: DailyForecastOk }) {
  const [explainOpen, setExplainOpen] = useState(false);
  return (
    <section
      aria-labelledby="forecast-title"
      data-testid="forecast-card"
      className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-brand/10 via-surface to-accent/10 p-4 shadow-card md:p-5"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-accent/20 blur-3xl" />
      <span aria-hidden="true" className="pointer-events-none absolute -left-20 top-10 h-40 w-40 rounded-full bg-brand/15 blur-3xl" />
      <div className="relative flex items-center justify-between gap-2">
        <h2 id="forecast-title" className="flex items-center gap-2 text-base font-semibold text-muted">
          <Icon name="pie" size={18} className="text-brand" />
          Осталось на день
        </h2>
        <button
          type="button"
          aria-label="Как это считается"
          title="Как это считается"
          aria-expanded={explainOpen}
          onClick={() => setExplainOpen((v) => !v)}
          className={`-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors ${explainOpen ? 'bg-brand/15 text-brand' : 'text-muted hover:bg-surface-2'}`}
        >
          <Icon name="info" size={20} />
        </button>
      </div>
      <p
        data-testid="forecast-per-day"
        className="relative -mt-1 font-bold leading-tight tracking-tight"
        style={{ fontSize: fitFontSize(perDayChars(forecast), '2.25rem', '11vw', '3rem') }}
      >
        <PerDay f={forecast} />
      </p>
      <TodayBar f={forecast} />
      <TodayRow f={forecast} />
      <p className="relative mt-3 flex flex-wrap gap-1.5 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface/80 px-3 py-1 font-medium text-text ring-1 ring-border/60">
          <Icon name="calendar" size={14} className="text-brand" />
          До {longDate(forecast.effective.horizonEnd)} · {daysText(forecast.effective.daysLeft)}
        </span>
        {forecast.effective.by === 'budget' && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface/80 px-3 py-1 font-medium text-muted ring-1 ring-border/60">
            <Icon name="pie" size={14} className="text-brand" />
            по лимиту месяца
          </span>
        )}
        {forecast.effective.by === 'money' && forecast.incomeDate !== null && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-income/10 px-3 py-1 font-medium text-income">
            <Icon name="income" size={14} />
            {longDate(forecast.incomeDate)} ждём доход
          </span>
        )}
      </p>
      {forecast.notEnough && (
        <div className="relative mt-3">
          <Notice tone="danger">
            Денег не хватает до {longDate(forecast.horizonEnd)}: нужно ещё {endSentence(formatMinor(forecast.shortfallMinor, forecast.base))}
          </Notice>
        </div>
      )}
      <Details f={forecast} />
      {explainOpen && <ExplainPanel />}
    </section>
  );
}
