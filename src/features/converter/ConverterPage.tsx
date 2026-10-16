import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { inputClasses } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/Toast';
import type { CurrencyCode } from '@/domain/types';
import { cn } from '@/lib/cn';
import { useRateService, useRates } from '@/rates/hooks';
import { formatNumber, formatRate, parseAmount } from './convert';
import { CURRENCY_META, POPULAR_CURRENCIES, currencyName } from './currencyMeta';
import { CurrencyPicker } from './CurrencyPicker';
import { FlagIcon } from './FlagIcon';

const STORAGE_KEY = 'finora:converter:v1';
const QUICK_AMOUNTS = ['1', '10', '100', '1000'] as const;

interface Saved {
  from: CurrencyCode;
  to: CurrencyCode;
  amount: string;
}

function loadSaved(): Saved {
  const fallback: Saved = { from: 'USD', to: 'TJS', amount: '100' };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Saved> | null;
    if (!raw || typeof raw !== 'object') return fallback;
    const ok = (c: unknown): c is string => typeof c === 'string' && Object.prototype.hasOwnProperty.call(CURRENCY_META, c);
    return {
      from: ok(raw.from) ? raw.from : fallback.from,
      to: ok(raw.to) ? raw.to : fallback.to,
      amount: typeof raw.amount === 'string' && raw.amount.length <= 18 ? raw.amount : fallback.amount,
    };
  } catch {
    return fallback;
  }
}

function formatAsOf(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

function CurrencyButton({ code, label, onClick }: { code: CurrencyCode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${currencyName(code)}. Изменить`}
      className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2.5 rounded-2xl bg-white/15 px-3 py-1.5 text-left text-white transition active:scale-[0.97] hover:bg-white/25"
    >
      <FlagIcon code={code} size={32} className="ring-white/40" />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold leading-tight">{code}</span>
        <span className="hidden truncate text-xs text-white/80 sm:block">{currencyName(code)}</span>
      </span>
      <Icon name="chevron" size={16} className="shrink-0 rotate-90 text-white/80" />
    </button>
  );
}

/** «Курсы и конвертер»: сумма → результат, флаги стран, курс к выбранной валюте для всех валют списком. */
export default function ConverterPage() {
  const rates = useRates();
  const service = useRateService();
  const toast = useToast();
  const [saved] = useState(loadSaved);
  const [from, setFrom] = useState<CurrencyCode>(saved.from);
  const [to, setTo] = useState<CurrencyCode>(saved.to);
  const [amountText, setAmountText] = useState(saved.amount);
  const [picker, setPicker] = useState<null | 'from' | 'to'>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ from, to, amount: amountText } satisfies Saved));
    } catch {
      /* хранилище недоступно — просто не запоминаем */
    }
  }, [from, to, amountText]);

  const { getRate } = rates;
  // валюты, для которых есть курс хотя бы к сомони/к выбранной
  const available = useMemo(() => {
    const known = new Set([...service.listKnownCurrencies(), 'TJS']);
    return Object.keys(CURRENCY_META).filter((c) => known.has(c) && (c === from || getRate(from, c) !== null));
  }, [service, getRate, from]);
  // для выбора «в какую» нужны те же, но из-за смены from список может не включать to — добавим, чтобы выбор был виден
  const pickable = useMemo(() => [...new Set([...available, from, to])], [available, from, to]);

  const amount = parseAmount(amountText);
  const lookup = getRate(from, to);
  const result = amount !== null && lookup ? amount * lookup.rate : null;
  const shownResult = result !== null ? formatNumber(result) : '—';

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const popular = POPULAR_CURRENCIES.filter((c) => c !== from);
    const rest = Object.keys(CURRENCY_META)
      .filter((c) => c !== from && !popular.includes(c))
      .sort((a, b) => currencyName(a).localeCompare(currencyName(b), 'ru'));
    return [...popular, ...rest]
      .filter((c) => !q || c.toLowerCase().includes(q) || currencyName(c).toLowerCase().includes(q))
      .map((code) => ({ code, lookup: getRate(from, code) }))
      .filter((r) => r.lookup !== null);
  }, [filter, from, getRate]);

  const subtitle = rates.refreshing
    ? 'Обновляем…'
    : lookup
      ? `Курс на ${formatAsOf(lookup.asOf)}`
      : 'Курсов пока нет — подключитесь к интернету';

  const refresh = async () => {
    const r = await rates.refresh();
    if (r.ok) toast.success('Курсы обновлены');
    else toast.error('Не удалось обновить курсы. Показаны сохранённые');
  };

  const copyResult = async () => {
    if (result === null) return;
    try {
      await navigator.clipboard.writeText(shownResult.replace(/\s/g, '').replace(',', '.'));
      toast.success('Результат скопирован');
    } catch {
      /* буфер недоступен */
    }
  };

  return (
    <>
      <PageHeader
        title="Курсы валют"
        subtitle={subtitle}
        actions={<IconButton icon="refresh" label="Обновить курсы" onClick={refresh} disabled={rates.refreshing} className={cn(rates.refreshing && '[&_svg]:animate-spin')} />}
      />

      <section
        aria-label="Конвертер"
        className="relative animate-rise overflow-hidden rounded-3xl bg-gradient-to-br from-hero-from to-hero p-4 text-white shadow-[0_24px_50px_-22px_rgb(var(--brand)/0.9)] md:p-6"
      >
        <label htmlFor="conv-amount" className="text-sm font-semibold text-white/85">
          Сумма
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="conv-amount"
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.slice(0, 18))}
            onFocus={(e) => e.currentTarget.select()}
            aria-invalid={amount === null}
            className="min-h-[56px] w-full min-w-0 rounded-2xl border border-white/25 bg-white/10 px-4 text-3xl font-extrabold tabular-nums text-white placeholder:text-white/50 focus:outline-none focus:ring-4 focus:ring-white/30"
            placeholder="0"
          />
        </div>
        <div className="mt-2 flex gap-2" role="group" aria-label="Быстрая сумма">
          {QUICK_AMOUNTS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmountText(q)}
              className={cn(
                'min-h-[36px] flex-1 rounded-full px-3 text-sm font-bold transition active:scale-95',
                amountText === q ? 'bg-white text-hero' : 'bg-white/15 text-white hover:bg-white/25',
              )}
            >
              {q === '1000' ? '1 000' : q}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <CurrencyButton code={from} label="Из валюты" onClick={() => setPicker('from')} />
          <button
            type="button"
            onClick={swap}
            aria-label="Поменять валюты местами"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-hero shadow-float transition duration-200 ease-spring active:rotate-180 active:scale-90"
          >
            <Icon name="transfer" size={22} />
          </button>
          <CurrencyButton code={to} label="В валюту" onClick={() => setPicker('to')} />
        </div>

        <div className="mt-5 rounded-2xl bg-black/15 p-4" aria-live="polite">
          <p className="text-sm text-white/80">{amount !== null ? `${formatNumber(amount)} ${from} =` : 'Введите сумму'}</p>
          <button
            type="button"
            onClick={copyResult}
            disabled={result === null}
            aria-label={result !== null ? `Результат ${shownResult} ${to}. Копировать` : 'Результата нет'}
            className="mt-0.5 block max-w-full truncate text-left text-4xl font-extrabold tabular-nums tracking-tight disabled:cursor-default"
          >
            {shownResult} <span className="text-2xl font-bold text-white/85">{to}</span>
          </button>
          {lookup ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
              <span>
                1 {from} = {formatRate(lookup.rate)} {to}
              </span>
              <span>
                1 {to} = {formatRate(1 / lookup.rate)} {from}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-white/85">Курса {from} → {to} нет. Обновите курсы с интернетом.</p>
          )}
          {lookup && (lookup.stale || lookup.manual || lookup.entered) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {lookup.stale && <Badge tone="warning" className="!bg-white !text-hero">Курс устарел</Badge>}
              {lookup.manual && <Badge tone="brand" className="!bg-white !text-hero">Свой курс</Badge>}
              {lookup.entered && <Badge tone="brand" className="!bg-white !text-hero">Введён вручную {formatAsOf(lookup.asOf)}</Badge>}
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="rates-title" className="mt-6">
        <div className="mb-2 flex items-end justify-between gap-3">
          <h2 id="rates-title" className="text-lg font-bold">
            Все курсы к {from}
          </h2>
        </div>
        <div className="relative mb-3">
          <Icon name="search" size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            aria-label="Поиск валюты в списке"
            placeholder="Найти валюту"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className={cn(inputClasses(false), 'min-h-[48px] pl-11')}
          />
        </div>
        <Card padding="none">
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-muted">{filter ? 'Ничего не найдено' : 'Курсов нет. Обновите их, когда будет интернет.'}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {rows.map(({ code, lookup: l }) => (
                <li key={code}>
                  <button
                    type="button"
                    onClick={() => {
                      setTo(code);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    aria-label={`${currencyName(code)}: 1 ${from} = ${formatRate(l!.rate)} ${code}. Выбрать как «в валюту»`}
                    className={cn(
                      'flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-2 active:bg-border/60',
                      code === to && 'bg-brand/10',
                    )}
                  >
                    <FlagIcon code={code} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-text">{code}</span>
                      <span className="block truncate text-sm text-muted">{currencyName(code)}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-bold tabular-nums text-text">{formatRate(l!.rate)}</span>
                      <span className="block text-xs text-muted">за 1 {from}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="mt-3 text-center text-xs text-muted">Источники: Национальный банк Таджикистана и открытые курсы currency-api. Работает и без интернета по последним сохранённым.</p>
      </section>

      <CurrencyPicker
        open={picker !== null}
        title={picker === 'from' ? 'Из какой валюты' : 'В какую валюту'}
        value={picker === 'from' ? from : to}
        available={pickable}
        onPick={(c) => (picker === 'from' ? setFrom(c) : setTo(c))}
        onClose={() => setPicker(null)}
      />
    </>
  );
}
