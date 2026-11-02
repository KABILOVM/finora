import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { inputClasses } from '@/components/Field';
import { CURRENCIES, currencyInfo } from '@/domain/currency';
import type { CurrencyCode } from '@/domain/types';
import { rateFromAmounts } from '@/features/trips/tripRates';
import { FieldGroup } from './FieldGroup';
import { lastForeignCurrency, rememberForeignCurrency } from './foreignMemory';
import { formatRate } from './txForm';
import type { TxFormController } from './useTxFormController';

/** Мельче крупной суммы: это второе поле на экране. */
const SMALL = '[&_.money]:!text-3xl';

/** Валюта чека по умолчанию: прошлая выбранная (если не совпадает с валютой кошелька), иначе доллар или евро. */
function defaultForeign(walletCurrency: CurrencyCode): CurrencyCode {
  const last = lastForeignCurrency();
  if (last !== null && last !== walletCurrency) return last;
  return walletCurrency === 'USD' ? 'EUR' : 'USD';
}

/**
 * «Сумма на чеке в другой валюте»: платили картой в сомони за границей, банк списал 135 с., а на чеке было 50 AED. Сумма в сомони
 * вводится в основном поле, здесь — чек. На остаток и курс это не влияет: приложение лишь запоминает, сколько было на чеке, и показывает
 * «курс карты» (сколько сомони банк взял за единицу валюты).
 */
export function ForeignAmountField({ c }: { c: TxFormController }) {
  const { form, errors, wallet } = c;
  if (!c.foreignAvailable) return null;

  if (!form.foreignOpen) {
    return (
      <div>
        <Button
          variant="ghost"
          onClick={() => c.set({ foreignOpen: true, foreignCurrency: form.foreignCurrency ?? (wallet ? defaultForeign(wallet.currency) : null) })}
        >
          Сумма на чеке в другой валюте
        </Button>
      </div>
    );
  }

  const walletCurrency = wallet?.currency ?? c.currency;
  const currency = form.foreignCurrency;
  const rate =
    currency !== null && form.foreignAmount !== null && form.foreignAmount > 0 && form.amountMinor !== null && form.amountMinor > 0
      ? rateFromAmounts(form.foreignAmount, form.amountMinor, currency, walletCurrency)
      : null;
  const options = CURRENCIES.filter((x) => x.code !== walletCurrency);

  return (
    <FieldGroup label="Сумма на чеке" hint="платили картой" error={errors.foreign}>
      <div className="flex items-start gap-2" data-testid="foreign-field">
        {/* ширина — у обёртки: у самого поля ввода своя ширина (w-full) и перебила бы узкую */}
        <div className="w-24 shrink-0">
          <select
            aria-label="Валюта чека"
            value={currency ?? ''}
            onChange={(e) => {
              const code = e.target.value;
              if (code !== '') rememberForeignCurrency(code);
              c.set({ foreignCurrency: code === '' ? null : code });
            }}
            className={`${inputClasses(!!errors.foreign)} min-h-[48px]`}
          >
            <option value="">Валюта…</option>
            {options.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <AmountInput
            currency={currency ?? walletCurrency}
            value={form.foreignAmount}
            onChange={(v) => c.set({ foreignAmount: v })}
            label="Сумма на чеке"
            showKeypad={false}
            className={SMALL}
          />
        </div>
      </div>
      {currency !== null && rate !== null && (
        <p className="text-sm text-muted" data-testid="card-rate">
          Курс карты: 1 {currencyInfo(currency).symbol} = {formatRate(rate)} {currencyInfo(walletCurrency).symbol}
        </p>
      )}
      <div>
        <Button variant="ghost" onClick={() => c.set({ foreignOpen: false, foreignCurrency: null, foreignAmount: null })}>
          Убрать сумму на чеке
        </Button>
      </div>
    </FieldGroup>
  );
}
