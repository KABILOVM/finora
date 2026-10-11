import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field, inputClasses } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useSettings, useStore } from '@/db';
import { CURRENCIES, currencyInfo } from '@/domain/currency';
import type { CurrencyCode } from '@/domain/types';
import { SettingsSection } from './SettingsSection';

/** Валюта учёта (базовая): в ней считаются итоги. Меняет только новые операции. */
export function CurrencySection() {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const [next, setNext] = useState<CurrencyCode | null>(null);
  const [busy, setBusy] = useState(false);

  const current = settings?.baseCurrency;
  const options = current && !CURRENCIES.some((c) => c.code === current) ? [...CURRENCIES, currencyInfo(current)] : CURRENCIES;

  const apply = async () => {
    if (!next || busy) return;
    setBusy(true);
    try {
      await store.settings.update({ baseCurrency: next });
      toast.success(`Валюта учёта: ${next}`);
      setNext(null);
    } catch (e) {
      console.error('Не удалось сменить валюту учёта:', e);
      toast.error(e instanceof Error && e.name === 'ValidationError' ? e.message : 'Не удалось сменить валюту учёта');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Валюта учёта">
      <Field
        id="base-currency"
        label="Основная валюта"
        hint="В ней показываются итоги. Смена касается только НОВЫХ операций: старые остаются в прежней валюте и в итоги месяца в новой валюте не войдут. Менять стоит только в самом начале учёта."
      >
        <select
          id="base-currency"
          value={current ?? ''}
          disabled={!current}
          onChange={(e) => {
            if (e.target.value !== current) setNext(e.target.value);
          }}
          className={`${inputClasses(false)} min-h-[48px]`}
        >
          {!current && <option value="">Загрузка…</option>}
          {options.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </Field>
      <ConfirmDialog
        open={next !== null}
        loading={busy}
        title={next ? `Сменить валюту учёта на ${next}?` : ''}
        confirmLabel="Сменить"
        message={
          next && current
            ? `Новые операции будут записываться в ${next}. Старые операции остаются в ${current}: их суммы не пересчитываются и в итоги месяца в ${next} не войдут. Остатки кошельков не меняются.`
            : undefined
        }
        onConfirm={() => void apply()}
        onCancel={() => !busy && setNext(null)}
      />
    </SettingsSection>
  );
}
