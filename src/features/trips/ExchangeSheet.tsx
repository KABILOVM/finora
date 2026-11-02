import { useMemo, useRef, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { Field, TextInput, inputClasses } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { newId, useBalances, useSettings, useStore, useWallets } from '@/db';
import { CURRENCIES, currencyInfo } from '@/domain/currency';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, LocalRow, Minor, Settings, UUID, Wallet } from '@/domain/types';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { humanError, toastWithUndo } from '@/features/transactions/txActions';
import { checkDate, formatRate, ruDate } from '@/features/transactions/txForm';
import { useRates } from '@/rates/hooks';
import { useToday } from '@/recurring/useToday';
import { recordExchange, walletOptionLabel } from './exchange';
import { rateFromAmounts, tripRates, type Exchange } from './tripRates';
import type { TripMoney } from './useTripMoney';

/** Курс отличается от курса Нацбанка сильнее чем на столько процентов — вежливо переспрашиваем (опечатка в сумме). */
const SUSPICIOUS_PERCENT = 25;

const SMALL = '[&_.money]:!text-3xl';

export interface ExchangeSheetProps {
  money: TripMoney;
  /** Заранее выбрано: откуда отдаём (например, кошелёк поездки при возврате остатка) и в какую валюту. */
  preset?: { fromWalletId?: UUID; toCurrency?: CurrencyCode } | undefined;
  onClose: () => void;
}

const symbol = (c: CurrencyCode): string => currencyInfo(c).symbol;

/** Строка курса: «1 $ = 11,11 с.». Одна из валют основная — курс к основной; иначе из первой валюты во вторую. */
export function exchangeRateLine(from: CurrencyCode, to: CurrencyCode, fromMinor: Minor | null, toMinor: Minor | null, base: CurrencyCode): string | null {
  if (fromMinor === null || toMinor === null || fromMinor <= 0 || toMinor <= 0) return null;
  const foreign = from === base ? to : from;
  const quote = from !== base && to !== base ? to : base;
  const rate =
    from === base
      ? rateFromAmounts(toMinor, fromMinor, to, base)
      : to === base
        ? rateFromAmounts(fromMinor, toMinor, from, base)
        : rateFromAmounts(fromMinor, toMinor, from, to);
  return rate === null ? null : `1 ${symbol(foreign)} = ${formatRate(rate)} ${symbol(quote)}`;
}

/** Курс обмена к основной валюте для сравнения с Нацбанком: единиц основной за 1 иностранную. null — одна из валют не основная. */
function rateToBase(from: CurrencyCode, to: CurrencyCode, fromMinor: Minor, toMinor: Minor, base: CurrencyCode): { currency: CurrencyCode; rate: number } | null {
  if (from === base && to !== base) {
    const rate = rateFromAmounts(toMinor, fromMinor, to, base);
    return rate === null ? null : { currency: to, rate };
  }
  if (to === base && from !== base) {
    const rate = rateFromAmounts(fromMinor, toMinor, from, base);
    return rate === null ? null : { currency: from, rate };
  }
  return null;
}

/**
 * «Обмен валюты» в поездке: отдал X, получил Y. Курс считается сам и ложится в основу трат поездки. Кошелёк для полученной валюты
 * заводится сам; при возврате остатка деньги зачисляются на выбранный кошелёк в основной валюте.
 */
export function ExchangeSheet(props: ExchangeSheetProps) {
  const settings = useSettings();
  const wallets = useWallets();
  const balances = useBalances();
  // Начальные значения формы (кошелёк, валюта) берутся из кошельков при открытии: пока они читаются, форму не показываем
  if (wallets === undefined || settings === undefined || balances === undefined) {
    return (
      <Sheet open onClose={props.onClose} title="Обмен валюты">
        <p role="status" className="text-muted">
          Загружаем…
        </p>
      </Sheet>
    );
  }
  return <ExchangeForm {...props} wallets={wallets} settings={settings} balances={balances} />;
}

interface FormProps extends ExchangeSheetProps {
  wallets: LocalRow<Wallet>[];
  settings: LocalRow<Settings> | null;
  balances: ReadonlyMap<UUID, Minor>;
}

function ExchangeForm({ money, preset, onClose, wallets, settings, balances }: FormProps) {
  const store = useStore();
  const toast = useToast();
  const today = useToday();
  const { getRate } = useRates();
  const base = money.base;

  const active = wallets;
  const baseWallets = useMemo(() => active.filter((w) => w.currency === base), [active, base]);

  const firstFrom = (): LocalRow<Wallet> | undefined =>
    active.find((w) => w.id === preset?.fromWalletId) ??
    active.find((w) => w.id === settings?.defaultWalletId && w.currency === base) ??
    baseWallets[0] ??
    active[0];

  const [fromId, setFromId] = useState<UUID | null>(() => firstFrom()?.id ?? null);
  const from = active.find((w) => w.id === fromId);
  const pickCurrency = (not: CurrencyCode | undefined): CurrencyCode => {
    const wanted = [preset?.toCurrency, money.wallets[0]?.currency, 'USD', 'EUR'];
    return wanted.find((c): c is CurrencyCode => c !== undefined && c !== not) ?? 'USD';
  };
  const [toCurrency, setToCurrency] = useState<CurrencyCode>(() => pickCurrency(firstFrom()?.currency));
  const [toWalletId, setToWalletId] = useState<UUID | null>(null);
  const [fromMinor, setFromMinor] = useState<Minor | null>(null);
  const [toMinor, setToMinor] = useState<Minor | null>(null);
  const [date, setDate] = useState<string>(today);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // номера выдаются при открытии: повтор после сбоя или двойное нажатие не создаёт дубль
  const ids = useRef({ tx: newId(), wallet: newId() });

  const returning = toCurrency === base;
  const destination = returning ? (baseWallets.find((w) => w.id === toWalletId) ?? baseWallets.find((w) => w.id !== from?.id)) : undefined;
  const balance = from ? balances.get(from.id) : undefined;

  const currencyOptions = useMemo(() => {
    const known = CURRENCIES.some((c) => c.code === base) ? CURRENCIES : [...CURRENCIES, currencyInfo(base)];
    return known.filter((c) => c.code !== from?.currency);
  }, [base, from?.currency]);

  const changeFrom = (id: UUID) => {
    setFromId(id);
    const next = active.find((w) => w.id === id);
    if (next && next.currency === toCurrency) setToCurrency(pickCurrency(next.currency));
    setError(null);
  };

  const rateLine = from ? exchangeRateLine(from.currency, toCurrency, fromMinor, toMinor, base) : null;

  // «Средний курс поездки станет …»: как этот обмен сдвинет курс валюты, которую получаем
  const afterRate = useMemo(() => {
    if (!from || fromMinor === null || toMinor === null || fromMinor <= 0 || toMinor <= 0 || toCurrency === base) return null;
    if (!money.exchanges.some((e) => e.toCurrency === toCurrency)) return null;
    const candidate: Exchange = {
      txId: 'new',
      occurredOn: date,
      fromWalletId: from.id,
      toWalletId: 'new',
      fromCurrency: from.currency,
      toCurrency,
      fromMinor,
      toMinor,
    };
    try {
      return tripRates([...money.exchanges, candidate], base).rates.get(toCurrency)?.rate ?? null;
    } catch {
      return null;
    }
  }, [from, fromMinor, toMinor, toCurrency, base, date, money.exchanges]);

  // Курс сильно отличается от курса Нацбанка: скорее всего, опечатка в одной из сумм
  const suspicious = useMemo(() => {
    if (!from || fromMinor === null || toMinor === null || fromMinor <= 0 || toMinor <= 0) return null;
    const mine = rateToBase(from.currency, toCurrency, fromMinor, toMinor, base);
    if (!mine) return null;
    const official = getRate(mine.currency, base);
    if (!official) return null;
    const diff = (Math.abs(mine.rate - official.rate) / official.rate) * 100;
    return diff > SUSPICIOUS_PERCENT ? { mine: mine.rate, official: official.rate, currency: mine.currency } : null;
  }, [from, fromMinor, toMinor, toCurrency, base, getRate]);

  const dirty = fromMinor !== null || toMinor !== null;

  const save = async () => {
    if (savingRef.current) return;
    if (!from) return setError('Выберите, откуда отдаёте деньги');
    if (fromMinor === null || fromMinor <= 0) return setError('Укажите, сколько отдаёте');
    if (toMinor === null || toMinor <= 0) return setError('Укажите, сколько получаете');
    const dateError = checkDate(date);
    if (dateError) return setError(dateError);
    if (returning && !destination) return setError('Нет кошелька в основной валюте, куда вернуть деньги');
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await recordExchange(store, {
        tag: money.tag,
        label: money.label,
        base,
        from,
        fromMinor,
        toCurrency,
        toMinor,
        toWalletId: returning ? destination?.id : undefined,
        tripWallets: money.wallets,
        occurredOn: date,
        ids: ids.current,
      });
      onClose();
      toastWithUndo(
        toast,
        `Обмен записан: ${formatMinor(fromMinor, from.currency)} → ${formatMinor(toMinor, toCurrency)}`,
        async () => {
          await store.transactions.softDelete(res.txId);
          if (res.createdWallet) await store.wallets.archive(res.walletId);
        },
        'Обмен отменён',
      );
    } catch (e) {
      console.error('Не удалось записать обмен:', e);
      setError(humanError(e, 'Не удалось записать обмен. Данные не изменены — попробуйте ещё раз.'));
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Обмен валюты"
      isDirty={dirty}
      dismissible={!saving}
      footer={
        <Button fullWidth onClick={() => void save()} loading={saving} disabled={!from}>
          Записать обмен
        </Button>
      }
    >
      <div className="flex flex-col gap-4" data-testid="exchange-sheet">
        <p className="text-sm text-muted">
          Отдали X, получили Y: курс посчитается сам и станет основой трат поездки «{money.label}». Кошелёк для новой валюты заведётся сам.
        </p>

        <Field id="ex-from" label="Откуда отдаёте">
          <select
            id="ex-from"
            value={fromId ?? ''}
            onChange={(e) => changeFrom(e.target.value)}
            className={`${inputClasses(false)} min-h-[48px]`}
          >
            {active.map((w) => (
              <option key={w.id} value={w.id}>
                {walletOptionLabel(w)}
              </option>
            ))}
          </select>
        </Field>

        <FieldGroup label={`Отдаю, ${symbol(from?.currency ?? base)}`}>
          <AmountInput currency={from?.currency ?? base} value={fromMinor} onChange={(v) => { setFromMinor(v); setError(null); }} label="Отдаю" showKeypad={false} className={SMALL} />
          {from && balance !== undefined && balance > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>На кошельке: {formatMinor(balance, from.currency)}</span>
              <Button variant="ghost" onClick={() => { setFromMinor(balance); setError(null); }}>
                Весь остаток
              </Button>
            </div>
          )}
        </FieldGroup>

        <Field id="ex-to-currency" label="Получаю в валюте">
          <select
            id="ex-to-currency"
            value={toCurrency}
            onChange={(e) => { setToCurrency(e.target.value); setError(null); }}
            className={`${inputClasses(false)} min-h-[48px]`}
          >
            {currencyOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </Field>

        {returning && (
          <Field id="ex-to-wallet" label="Куда зачислить">
            <select
              id="ex-to-wallet"
              value={destination?.id ?? ''}
              onChange={(e) => setToWalletId(e.target.value)}
              className={`${inputClasses(false)} min-h-[48px]`}
            >
              {baseWallets
                .filter((w) => w.id !== from?.id)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {walletOptionLabel(w)}
                  </option>
                ))}
            </select>
          </Field>
        )}

        <FieldGroup label={`Получаю, ${symbol(toCurrency)}`}>
          <AmountInput currency={toCurrency} value={toMinor} onChange={(v) => { setToMinor(v); setError(null); }} label="Получаю" showKeypad={false} className={SMALL} />
        </FieldGroup>

        <TextInput
          label="Дата обмена"
          type="date"
          value={date}
          min="2000-01-01"
          max="2100-01-01"
          onChange={(e) => { setDate(e.target.value); setError(null); }}
          hint={date === today ? 'Сегодня' : date !== '' ? ruDate(date) : undefined}
        />

        {rateLine && (
          <div className="rounded-xl bg-surface-2 px-3 py-2 text-sm" data-testid="exchange-rate">
            <p className="font-semibold text-text">Курс обмена: {rateLine}</p>
            {afterRate !== null && toCurrency !== base && (
              <p className="text-muted">
                Средний курс поездки по {symbol(toCurrency)} станет: 1 {symbol(toCurrency)} = {formatRate(afterRate)} {symbol(base)}
              </p>
            )}
          </div>
        )}
        {suspicious && (
          <Notice tone="warning">
            Курс сильно отличается от курса Нацбанка (1 {symbol(suspicious.currency)} = {formatRate(suspicious.official)} {symbol(base)}). Проверьте суммы.
          </Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Sheet>
  );
}
