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

const SKIPPED_WHERE: Record<ForecastSkipped['source'], string> = { money: 'в кошельках', payment: 'в платежах', debt: 'в долгах' };

/** «100 $ (в кошельках), 20 $ (в платежах)» — что не вошло в расчёт из-за отсутствия курса. */
export function skippedText(skipped: readonly ForecastSkipped[]): string {
  return skipped.map((s) => `${formatMinor(s.amountMinor, s.currency)} (${SKIPPED_WHERE[s.source]})`).join(', ');
}

/** Сколько знаков в крупном числе «в день» (с «≈ »): по ним подбирается размер шрифта. */
export const perDayChars = (f: DailyForecastOk): number => formatMinor(f.perDayMinor, f.base).length + (f.approximate ? 2 : 0);

/** Крупное число «в день»; «≈», если оно приблизительное. */
export function PerDay({ f, className }: { f: DailyForecastOk; className?: string }) {
  return (
    <span className={className}>
      {f.approximate && <span title="Приблизительно: часть денег пересчитана по курсу или не вошла в расчёт">≈ </span>}
      <MoneyText minor={f.perDayMinor} currency={f.base} tone={f.notEnough ? 'expense' : 'none'} />
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

const EXPLAIN = [
  'Деньги на руках — это остатки кошельков: наличные, карты и счета. Накопления не считаем: их тратить не нужно.',
  'Считаем от сегодня до конца месяца. Если раньше придёт доход по регулярному платежу — только до дня перед ним.',
  'Из денег вычитаем обязательное: регулярные платежи и переводы в накопления по расписанию, которые вы ещё не провели, и долги, которые нужно вернуть к этому сроку.',
  'Что осталось, делим на число дней и округляем вниз. Так мы никогда не обещаем больше, чем есть.',
  'Деньги и платежи в валюте без курса в расчёт не входят — об этом написано под числом, а само число помечено «≈».',
] as const;

function Explain() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border-t border-border pt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl text-left font-semibold text-brand"
      >
        <span>Как это считается</span>
        <Icon name="chevron" size={18} className={open ? 'rotate-90' : ''} />
      </button>
      {open && (
        <ol className="mb-1 mt-1 list-decimal space-y-1.5 pl-5 text-sm text-muted">
          {EXPLAIN.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Details({ f }: { f: DailyForecastOk }) {
  const over = f.spentTodayMinor > f.todayLimitMinor;
  const b = f.budget;
  return (
    <>
      <dl className="mt-4 flex flex-col gap-1.5 border-t border-border pt-3">
        <Row label="Деньги на руках">
          <MoneyText minor={f.moneyMinor} currency={f.base} tone={f.moneyMinor < 0 ? 'expense' : 'none'} />
        </Row>
        <Row label={`Платежи и долги до ${longDate(f.horizonEnd)}`}>
          <MoneyText minor={-f.obligationsMinor} currency={f.base} tone="none" />
        </Row>
        <Row label="Сегодня потрачено">
          {/* Две отдельные суммы (каждая не рвётся), а не одна длинная строка: на узком экране со многозначными суммами (сум, тенге) «из …» переносится. */}
          <span className="money">{formatMinor(f.spentTodayMinor, f.base)}</span>{' '}
          <span className="font-normal text-muted">
            из <span className="money">{formatMinor(f.todayLimitMinor, f.base)}</span>
          </span>
        </Row>
        <Row label="Обычно вы тратите">
          {f.usualPerDayMinor === null ? (
            <span className="font-normal text-muted">пока мало данных</span>
          ) : (
            <span className="money">{formatMinor(f.usualPerDayMinor, f.base)} в день</span>
          )}
        </Row>
        {b && (
          <Row label="По бюджету на месяц">
            <span className="money">{formatMinor(b.perDayMinor, f.base)} в день</span>
          </Row>
        )}
      </dl>

      {over && (
        <p className="mt-2 text-sm font-medium text-warning">Сегодня потрачено больше, чем можно на день: завтра придётся тратить меньше.</p>
      )}
      {f.usualPerDayMinor !== null && f.usualPerDayMinor > f.perDayMinor && !f.notEnough && (
        <p className="mt-2 text-sm font-medium text-warning">Обычно вы тратите больше, чем можно в день: деньги закончатся раньше срока.</p>
      )}
      {b && (
        <p className="mt-2 text-sm text-muted">
          {b.overMinor > 0
            ? `Общий лимит месяца превышен на ${endSentence(formatMinor(b.overMinor, f.base))}`
            : `Общий лимит месяца ${formatMinor(b.limitMinor, f.base)}: осталось ${endSentence(formatMinor(b.leftMinor, f.base))}`}
          {b.partial && ' Часть операций не учтена, поэтому цифра может быть выше настоящей.'}
        </p>
      )}
      {f.skipped.length > 0 && (
        <p className="mt-2 text-sm font-medium text-warning">Не вошло в расчёт — нет курса: {endSentence(skippedText(f.skipped))}</p>
      )}
      {f.unknownWalletPayments > 0 && (
        <p className="mt-2 text-sm font-medium text-warning">
          Не удалось учесть {f.unknownWalletPayments} {pluralRu(f.unknownWalletPayments, 'платёж', 'платежа', 'платежей')}: кошелёк не найден.
        </p>
      )}
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

  return (
    <section aria-labelledby="forecast-title" data-testid="forecast-card" className="rounded-2xl border border-border bg-surface p-4 shadow-card md:p-5">
      <h2 id="forecast-title" className="text-base font-semibold text-muted">
        Осталось на день
      </h2>
      <p
        data-testid="forecast-per-day"
        className="mt-0.5 font-bold leading-tight tracking-tight"
        style={{ fontSize: fitFontSize(perDayChars(forecast), '2rem', '10vw', '2.75rem') }}
      >
        <PerDay f={forecast} />
      </p>
      <p className="mt-0.5 text-sm text-muted">
        Считаем до {longDate(forecast.horizonEnd)}: {daysText(forecast.daysLeft)} включая сегодня.
        {forecast.incomeDate !== null && ` ${longDate(forecast.incomeDate)} ждём доход — дальше деньги пополнятся.`}
      </p>
      {forecast.notEnough && (
        <p className="mt-2 flex items-start gap-2 text-sm font-semibold text-danger">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <span>
            Денег не хватает до {longDate(forecast.horizonEnd)}: нужно ещё {endSentence(formatMinor(forecast.shortfallMinor, forecast.base))}
          </span>
        </p>
      )}
      <Details f={forecast} />
      <Explain />
    </section>
  );
}
