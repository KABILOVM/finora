import { useEffect, useState } from 'react';
import { Field, inputClasses } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useSettings, useStore } from '@/db';
import { CURRENCIES, currencyInfo } from '@/domain/currency';
import type { CurrencyCode } from '@/domain/types';
import { setBaseCurrency } from './onboardingActions';
import { WizardFrame } from './WizardFrame';

/** Шаг 1: основная валюта. Сохраняется при «Дальше»; повтор безопасен. */
export function CurrencyStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const [code, setCode] = useState<CurrencyCode | null>(null);
  const [busy, setBusy] = useState(false);

  // Пока человек не выбрал сам, показываем то, что сейчас в настройках (TJS у нового; при возврате на шаг — прежний выбор).
  useEffect(() => {
    if (code === null && settings) setCode(settings.baseCurrency);
  }, [code, settings]);

  const current = code ?? settings?.baseCurrency ?? 'TJS';
  const options = CURRENCIES.some((c) => c.code === current) ? CURRENCIES : [...CURRENCIES, currencyInfo(current)];

  const next = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setBaseCurrency(store, current);
      onNext();
    } catch (e) {
      console.error('Не удалось сохранить валюту:', e);
      toast.error(e instanceof Error && e.name === 'ValidationError' ? e.message : 'Не удалось сохранить валюту. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <WizardFrame
      step="currency"
      title="Основная валюта"
      lead="В ней Finora считает «Всего», итоги месяца и отчёты."
      onBack={onBack}
      onNext={() => void next()}
      nextDisabled={!settings}
      nextLoading={busy}
    >
      <Field id="onb-currency" label="Валюта" hint="Кошельки могут быть и в других валютах: их суммы пересчитаются по курсу.">
        <select id="onb-currency" value={current} onChange={(e) => setCode(e.target.value)} className={`${inputClasses(false)} min-h-[52px]`}>
          {options.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </Field>
    </WizardFrame>
  );
}
