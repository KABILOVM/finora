import { Card } from '@/components/Card';
import { TextInput } from '@/components/Field';
import type { RateNeed } from '@/import/types';
import { opsWord, symbolOf } from './importText';
import { parseRateInput } from './rateInput';

export interface RatesBlockProps {
  needs: readonly RateNeed[];
  base: string;
  texts: Readonly<Record<string, string>>;
  onChange: (currency: string, text: string) => void;
}

/**
 * Для каждой НЕбазовой валюты — одно поле «Курс для пересчёта в <база>». Исторических курсов у приложения нет, поэтому все
 * операции валюты пересчитываются одним курсом (fxSource «manual»). Без курса такие операции не добавляются.
 */
export function RatesBlock({ needs, base, texts, onChange }: RatesBlockProps) {
  if (needs.length === 0) return null;
  return (
    <section aria-labelledby="rates-h" className="flex flex-col gap-2">
      <h2 id="rates-h" className="px-1 text-sm font-bold uppercase tracking-wide text-muted">
        Курсы
      </h2>
      <Card className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Курс на дату операции неизвестен — все операции этой валюты будут пересчитаны по этому курсу (на отчёты в основной валюте влияет,
          остатки кошельков — нет).
        </p>
        {needs.map((n) => {
          const text = texts[n.currency] ?? '';
          let error: string | null = null;
          if (text.trim() === '') error = `Укажите курс — без него ${n.rows} ${opsWord(n.rows)} в ${n.currency} не добавятся`;
          else if (parseRateInput(text) === null) error = 'Курс — число больше нуля, например 10,9';
          return (
            <TextInput
              key={n.currency}
              label={`Курс для пересчёта в ${base} (${n.currency})`}
              hint={`Сколько ${symbolOf(base)} за 1 ${symbolOf(n.currency)}, например 10,9. Операций в ${n.currency}: ${n.rows}.`}
              value={text}
              onChange={(e) => onChange(n.currency, e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="Например, 10,9"
              error={error}
            />
          );
        })}
      </Card>
    </section>
  );
}
