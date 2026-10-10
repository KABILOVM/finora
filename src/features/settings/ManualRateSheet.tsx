import { useState } from 'react';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import type { CurrencyCode } from '@/domain/types';
import { useRateService } from '@/rates/hooks';
import type { RateLookup } from '@/rates/types';
import { formatRate, parseRateInput } from './rateInput';

export interface ManualRateSheetProps {
  from: CurrencyCode;
  to: CurrencyCode;
  current: RateLookup | null;
  onClose: () => void;
}

/** Свой курс для пары «1 {from} = ? {to}». Действует вместо курса из сети, пока его не убрать. */
export function ManualRateSheet({ from, to, current, onClose }: ManualRateSheetProps) {
  const service = useRateService();
  const toast = useToast();
  const [text, setText] = useState(current?.manual ? formatRate(current.rate).replace(/ /g, '') : '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const rate = parseRateInput(text);
    if (rate === null) {
      setError('Введите курс числом больше нуля, например 10,9');
      return;
    }
    try {
      service.setManualRate(from, to, rate);
      toast.success(`Курс ${from} → ${to} сохранён`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить курс');
    }
  };

  const clear = () => {
    try {
      service.clearManualRate(from, to);
      toast.success('Свой курс убран: снова используется курс из сети');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось убрать курс');
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Курс ${from} → ${to}`}
      footer={
        <div className="flex flex-col gap-2">
          <Button size="lg" fullWidth onClick={save}>
            Сохранить курс
          </Button>
          {current?.manual && (
            <Button variant="ghost" fullWidth onClick={clear}>
              Убрать свой курс
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <TextInput
          label={`Сколько ${to} стоит 1 ${from}`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="Например, 10,9"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          error={error}
          data-autofocus
        />
        <p className="text-sm text-muted">
          Свой курс заменяет курс из сети и используется при пересчёте в {to}. Старые операции не пересчитываются: у каждой остаётся
          курс на момент внесения.
        </p>
      </div>
    </Sheet>
  );
}
