import { useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { TextInput } from '@/components/Field';
import { MoneyText } from '@/components/MoneyText';
import { useStore } from '@/db';
import { currencyInfo } from '@/domain/currency';
import { convertMinor, formatMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, Minor } from '@/domain/types';
import { formatRate } from '@/features/transactions/txForm';
import { pluralRu } from '@/lib/plural';
import { useToday } from '@/recurring/useToday';
import { dailyAllowance, daysLeft, tripNetCost, type TripPlan } from './tripRates';
import { parseDays, useTripPlan } from './tripPlan';
import type { TripMoney, TripWalletView } from './useTripMoney';

const dayWord = (n: number): string => `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`;

export interface ExchangePreset {
  fromWalletId?: string;
  toCurrency?: CurrencyCode;
}

/** Цена суммы в основной валюте по курсу поездки; null — курса нет или сумма не помещается. */
function inBase(minor: Minor, currency: CurrencyCode, base: CurrencyCode, rate: number | undefined): Minor | null {
  if (rate === undefined) return null;
  try {
    return convertMinor(minor, currency, base, rate);
  } catch {
    return null;
  }
}

function PlanEditor({ plan, today, onSet }: { plan: TripPlan | null; today: IsoDate; onSet: (plan: TripPlan | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const days = parseDays(text);
    if (days === null) return setError('Дни — целое число от 1 до 365');
    onSet({ startOn: today, days });
    setEditing(false);
    setText('');
    setError(null);
  };
  if (plan !== null && !editing) {
    const left = daysLeft(plan, today);
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="trip-plan">
        <span className="text-muted">Деньги рассчитаны ещё на {dayWord(left)}.</span>
        <Button variant="ghost" onClick={() => { setText(String(left)); setEditing(true); }}>
          Изменить
        </Button>
        <Button variant="ghost" onClick={() => onSet(null)}>
          Убрать
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate data-testid="trip-plan-form">
      <TextInput
        label="Сколько дней осталось в поездке (считая сегодня)"
        value={text}
        onChange={(e) => { setText(e.target.value); setError(null); }}
        inputMode="numeric"
        autoComplete="off"
        placeholder="Например, 10"
        hint="Приложение подскажет, сколько можно тратить в день"
        error={error}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" disabled={text.trim() === ''}>
          Задать
        </Button>
        {plan !== null && (
          <Button variant="ghost" onClick={() => { setEditing(false); setError(null); }}>
            Отмена
          </Button>
        )}
      </div>
    </form>
  );
}

function WalletRow({ w, money, left, onExchange }: { w: TripWalletView; money: TripMoney; left: number | null; onExchange: (preset: ExchangePreset) => void }) {
  const rate = money.rates.get(w.currency);
  const allowance = left === null || w.balanceMinor + w.spentTodayMinor <= 0 ? null : dailyAllowance(w.balanceMinor, w.spentTodayMinor, left);
  const sym = currencyInfo(w.currency).symbol;
  return (
    <li className="flex flex-col gap-1 py-3" data-testid="trip-wallet">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium">{w.name}</span>
        <MoneyText minor={w.balanceMinor} currency={w.currency} tone="none" className="shrink-0 text-lg font-semibold" />
      </div>
      <p className="text-sm text-muted" data-testid="trip-wallet-value">
        {w.valueMinor !== null && rate ? (
          <>
            ≈ <MoneyText minor={w.valueMinor} currency={money.base} tone="none" className="font-semibold text-text" /> по вашему курсу 1 {sym} = {formatRate(rate.rate)}{' '}
            {currencyInfo(money.base).symbol}
          </>
        ) : (
          'Курса поездки для этой валюты нет'
        )}
      </p>
      {allowance && (
        <p className="text-sm" data-testid="trip-allowance">
          Можно тратить в день: <MoneyText minor={allowance.perDayMinor} currency={w.currency} tone="none" className="font-semibold" />
          {inBase(allowance.perDayMinor, w.currency, money.base, rate?.rate) !== null && (
            <span className="text-muted"> (≈ {formatMinor(inBase(allowance.perDayMinor, w.currency, money.base, rate?.rate) ?? 0, money.base)})</span>
          )}
          . Сегодня {allowance.leftTodayMinor >= 0 ? 'ещё можно' : 'потрачено больше нормы на'}{' '}
          <MoneyText minor={Math.abs(allowance.leftTodayMinor)} currency={w.currency} tone={allowance.leftTodayMinor >= 0 ? 'none' : 'expense'} className="font-semibold" />
        </p>
      )}
      {w.balanceMinor > 0 && (
        <div>
          <Button variant="ghost" onClick={() => onExchange({ fromWalletId: w.walletId, toCurrency: money.base })}>
            Вернуть остаток в {currencyInfo(money.base).symbol}
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * «Деньги поездки»: кошельки поездки с остатком в сомони по вашему курсу, курс каждой валюты, «сколько можно тратить в день»
 * и итог с учётом возврата остатка. Обмен валюты и возврат остатка открываются отсюда. `active` — поездка идёт сейчас: только тогда
 * предлагаем задать дни (у законченной поездки «сколько можно тратить в день» ни к чему, но заданный план остаётся виден).
 */
export function TripMoneyCard({ money, expenseMinor, active, onExchange }: { money: TripMoney; expenseMinor: Minor | null; active: boolean; onExchange: (preset?: ExchangePreset) => void }) {
  const store = useStore();
  const today = useToday();
  const { plan, set } = useTripPlan(store.userId, money.tag);
  const left = plan === null ? null : daysLeft(plan, today);
  const wallets = money.wallets.filter((w) => !(w.archived && w.balanceMinor === 0));
  const net = expenseMinor === null ? null : tripNetCost(expenseMinor, money);
  const rates = [...money.rates.values()];
  return (
    <Card aria-labelledby="trip-money-title" className="!py-4 md:!p-5" data-testid="trip-money">
      <h2 id="trip-money-title" className="mb-1 text-base font-semibold">
        Деньги поездки
      </h2>
      {wallets.length === 0 ? (
        <p className="text-sm text-muted">Обменяйте сомони на валюту поездки: курс вашего обмена станет основой трат, а в форме траты сразу видно, сколько это в сомони.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {wallets.map((w) => (
            <WalletRow key={w.walletId} w={w} money={money} left={left} onExchange={onExchange} />
          ))}
        </ul>
      )}
      {rates.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5 text-sm text-muted" data-testid="trip-rates">
          {rates.map((r) => (
            <li key={r.currency}>
              Курс поездки: 1 {currencyInfo(r.currency).symbol} = {formatRate(r.rate)} {currencyInfo(money.base).symbol} ({r.exchanges}{' '}
              {pluralRu(r.exchanges, 'обмен', 'обмена', 'обменов')})
            </li>
          ))}
        </ul>
      )}
      {net && (
        <p className="mt-2 text-sm" data-testid="trip-net">
          С учётом возврата остатка поездка обошлась в <MoneyText minor={net.netMinor} currency={money.base} tone="none" className="font-semibold" />
          {net.lossMinor !== 0 && (
            <span className="text-muted">
              {' '}
              ({net.lossMinor > 0 ? 'потеряно на курсе' : 'выиграно на курсе'} {formatMinor(Math.abs(net.lossMinor), money.base)})
            </span>
          )}
          .
        </p>
      )}
      {(active || plan !== null) && (
        <div className="mt-3">
          <PlanEditor plan={plan} today={today} onSet={set} />
        </div>
      )}
      <div className="mt-3">
        <Button variant="secondary" fullWidth onClick={() => onExchange()}>
          Обмен валюты
        </Button>
      </div>
    </Card>
  );
}
