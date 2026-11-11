import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { CURRENCIES, currencyInfo } from '@/domain/currency';
import { HOME_MAX_CUR } from '@/domain/homeLayout';
import type { CurrencyCode } from '@/domain/types';
import { FlagIcon } from '@/features/converter/FlagIcon';
import { cn } from '@/lib/cn';
import { useRates } from '@/rates/hooks';
import { formatUnits, formatWidgetRate, scaleRate, widgetCurrencies } from '../ratesView';

export interface RatesCurrencySheetProps {
  open: boolean;
  /** Основная валюта: к ней показываются курсы, сама она в списке не нужна. */
  base: CurrencyCode;
  /** Выбор человека из раскладки главной; не задан — стандартные валюты. */
  value: readonly CurrencyCode[] | undefined;
  /** Новый выбор (в порядке списка); null — вернуть стандартные. */
  onChange: (next: CurrencyCode[] | null) => void;
  onClose: () => void;
}

/**
 * Окно «Валюты блока курсов»: какие курсы показывать на «Главной» — от одной до трёх валют (больше в блок не помещается). Выбор
 * применяется сразу и хранится в раскладке главной, поэтому он один на все устройства человека. Рядом с валютой — её курс к
 * основной, если он есть на устройстве; валюту без курса выбрать можно, блок честно напишет «нет курса».
 */
export default function RatesCurrencySheet({ open, base, value, onChange, onClose }: RatesCurrencySheetProps) {
  const { getRate } = useRates();
  const chosen = widgetCurrencies(base, value);
  // известные валюты плюс те, что уже выбраны, но в списке их нет (выбраны на другом устройстве с более новым приложением)
  const codes = [...CURRENCIES.map((c) => c.code), ...chosen.filter((c) => !CURRENCIES.some((k) => k.code === c))].filter((c) => c !== base);
  const full = chosen.length >= HOME_MAX_CUR;

  const toggle = (code: CurrencyCode) => {
    const next = chosen.includes(code) ? chosen.filter((c) => c !== code) : [...chosen, code];
    if (next.length < 1 || next.length > HOME_MAX_CUR) return;
    onChange(codes.filter((c) => next.includes(c)));
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Валюты блока курсов"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button size="lg" className="min-w-[9rem] flex-1" onClick={onClose}>
            Готово
          </Button>
          {value !== undefined && (
            <Button variant="ghost" size="lg" className="min-w-[9rem] flex-1" onClick={() => onChange(null)}>
              По умолчанию
            </Button>
          )}
        </div>
      }
    >
      <p className="mb-2 text-sm text-muted">
        От одной до трёх валют. Курс показывается к основной валюте ({currencyInfo(base).name}).
      </p>
      <ul className="-mx-1 divide-y divide-border/60" aria-label="Валюты">
        {codes.map((code) => {
          const on = chosen.includes(code);
          const lookup = getRate(code, base);
          const rate = lookup ? scaleRate(lookup.rate) : null;
          // последнюю выбранную не снимаем, четвёртую не добавляем
          const locked = on ? chosen.length === 1 : full;
          return (
            <li key={code}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={`${code}, ${currencyInfo(code).name}`}
                disabled={locked}
                onClick={() => toggle(code)}
                className={cn(
                  'flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-surface-2 active:bg-border/60 disabled:opacity-50',
                  on && 'bg-brand/10',
                )}
              >
                <FlagIcon code={code} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-text">{code}</span>
                  <span className="block truncate text-sm text-muted">{currencyInfo(code).name}</span>
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums text-muted">
                  {rate ? `${formatUnits(rate.units)} = ${formatWidgetRate(rate.value)} ${currencyInfo(base).symbol}` : 'нет курса'}
                </span>
                <span
                  aria-hidden="true"
                  className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', on ? 'border-brand bg-brand text-brand-fg' : 'border-border-strong')}
                >
                  {on && <Icon name="check" size={14} strokeWidth={3} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
