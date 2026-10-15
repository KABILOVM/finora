import { useId } from 'react';
import { Link } from 'react-router-dom';
import { ChipPicker } from '@/components/ChipPicker';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, DebtDirection, LocalRow, Minor, Wallet } from '@/domain/types';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { FxNotice } from '@/features/transactions/FxNotice';
import { endSentence } from '@/features/transactions/txDisplay';
import type { WalletFx } from './useWalletFx';

export interface DebtMoneySectionProps {
  direction: DebtDirection;
  currency: CurrencyCode;
  amountMinor: Minor | null;
  /** Кошельки в валюте долга (не архивные). */
  candidates: readonly LocalRow<Wallet>[];
  /** Человек оставил галочку «Записать движение денег». */
  wanted: boolean;
  onWanted: (on: boolean) => void;
  walletId: string | null;
  onWallet: (id: string) => void;
  fx: WalletFx;
  fxError?: string | null;
  walletError?: string | null;
  /** Это пополнение существующего долга («добавить ещё»), а не новый долг: меняются слова. */
  topUp?: boolean;
}

/**
 * «Записать движение денег» при создании долга. По умолчанию включено: выдача долга — расход с кошелька, получение — доход.
 * Нет кошелька в валюте долга — честно предлагаем долг «на бумаге» и объясняем, что тогда остатки кошельков не меняются.
 */
export function DebtMoneySection({
  direction,
  currency,
  amountMinor,
  candidates,
  wanted,
  onWanted,
  walletId,
  onWallet,
  fx,
  fxError,
  walletError,
  topUp = false,
}: DebtMoneySectionProps) {
  const titleId = useId();
  const hintId = useId();
  const noWallet = candidates.length === 0;
  const on = wanted && !noWallet;
  const wallet = candidates.find((w) => w.id === walletId);
  const sum = amountMinor !== null && amountMinor > 0 ? formatMinor(amountMinor, currency) : topUp ? 'сумма пополнения' : 'сумма долга';
  const what = topUp ? 'Сумма пополнения' : 'Сумма долга';
  const paper = topUp ? 'Пополнение' : 'Долг';

  return (
    <section aria-label="Движение денег" className="flex flex-col gap-3 rounded-2xl border border-border p-3">
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={noWallet}
          onChange={(e) => onWanted(e.target.checked)}
          aria-labelledby={titleId}
          aria-describedby={hintId}
          className="mt-0.5 h-6 w-6 shrink-0 accent-brand"
        />
        <span>
          <span id={titleId} className="block font-semibold">
            Записать движение денег
          </span>
          <span id={hintId} className="block text-sm text-muted">
            {direction === 'lent'
              ? `${what} спишется с кошелька как расход (в расходы месяца она не войдёт).`
              : `${what} поступит на кошелёк как доход (в доходы месяца она не войдёт).`}
          </span>
        </span>
      </label>

      {noWallet && (
        <p className="text-sm font-medium text-warning" data-testid="debt-paper-note">
          Нет кошелька в валюте {currency}, поэтому {paper.toLowerCase()} запишется «на бумаге»: остатки кошельков не изменятся. Чтобы
          деньги двигались, сначала создайте кошелёк в {currency} на экране «Кошельки».{' '}
          <Link to="/wallets" className="inline-flex min-h-[44px] items-center font-semibold text-brand">
            Открыть кошельки
          </Link>
        </p>
      )}
      {!noWallet && !on && (
        <p className="text-sm text-muted">
          {paper} запишется «на бумаге»: остатки кошельков не изменятся.
          {topUp && ' В списке «Выдачи и пополнения» такого пополнения не будет — только сумма долга вырастет.'}
        </p>
      )}

      {on && (
        <>
          <FieldGroup label={direction === 'lent' ? 'С какого кошелька' : 'На какой кошелёк'} error={walletError}>
            <ChipPicker
              ariaLabel="Кошелёк"
              value={walletId}
              onChange={onWallet}
              options={candidates.map((w) => ({ value: w.id, label: w.name, icon: w.icon }))}
            />
          </FieldGroup>
          {wallet && (
            <p className="text-sm text-muted">
              {endSentence(
                direction === 'lent'
                  ? `С кошелька «${wallet.name}» спишется ${sum}`
                  : `На кошелёк «${wallet.name}» поступит ${sum}`,
              )}{' '}
              {topUp ? 'Дата операции — дата пополнения.' : 'Дата операции — дата долга.'}
            </p>
          )}
          <FxNotice fx={fx.view} amountMinor={amountMinor} rateText={fx.rateText} onRateText={fx.setRateText} error={fxError} />
        </>
      )}
    </section>
  );
}
