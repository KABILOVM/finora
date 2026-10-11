import { useMemo, useState } from 'react';
import type { CurrencyCode } from '@/domain/types';
import { fxSourceOf, parseRateText } from '@/features/transactions/txForm';
import type { FxView } from '@/features/transactions/useTxFormController';
import { useRateService, useRates } from '@/rates/hooks';

export type FxResolution =
  | { ok: true; fx: { rate: number; source: string } | undefined; remember: () => void }
  | { ok: false; error: string };

export interface WalletFx {
  view: FxView;
  rateText: string;
  setRateText: (text: string) => void;
  /** Курс для операции: курс из сервиса, ручной ввод или «не нужен». Ошибка — понятным текстом для поля «Курс». */
  resolve: () => FxResolution;
}

const NOTHING: FxResolution = { ok: true, fx: undefined, remember: () => undefined };

/**
 * Курс для движения денег по долгу, когда кошелёк не в основной валюте (как в форме операции): снимок курса сохраняется в операции
 * и задним числом не пересчитывается. Курса нет совсем — человек вводит его сам (ввод денег от сети не зависит).
 */
export function useWalletFx(walletCurrency: CurrencyCode | undefined, base: CurrencyCode | null): WalletFx {
  const { getRate } = useRates();
  const rateService = useRateService();
  const [typed, setTyped] = useState<{ currency: CurrencyCode | undefined; text: string }>({ currency: walletCurrency, text: '' });
  // ручной курс относится к валюте, для которой его набрали: сменили кошелёк в другой валюте — поле пустое
  const rateText = typed.currency === walletCurrency ? typed.text : '';

  const view = useMemo((): FxView => {
    if (!walletCurrency || !base || walletCurrency === base) return { kind: 'none' };
    const lookup = getRate(walletCurrency, base);
    return lookup ? { kind: 'rate', lookup, from: walletCurrency, to: base } : { kind: 'missing', from: walletCurrency, to: base };
  }, [walletCurrency, base, getRate]);

  const resolve = (): FxResolution => {
    if (view.kind === 'none' || view.kind === 'keep') return NOTHING;
    const remember = (rate: number) => () => {
      try {
        rateService.rememberEnteredRate(view.from, view.to, rate);
      } catch (err) {
        console.error('Введённый курс не запомнен (операция сохранена):', err);
      }
    };
    if (view.kind === 'rate') {
      const { lookup } = view;
      if (lookup.entered === true && rateText.trim() !== '') {
        const rate = parseRateText(rateText);
        if (rate === null) return { ok: false, error: 'Курс — число больше нуля, например 10,9' };
        if (rate !== lookup.rate) return { ok: true, fx: { rate, source: 'manual' }, remember: remember(rate) };
      }
      return { ok: true, fx: { rate: lookup.rate, source: fxSourceOf(lookup) }, remember: () => undefined };
    }
    const rate = parseRateText(rateText);
    if (rate === null) {
      return {
        ok: false,
        error:
          rateText.trim() === ''
            ? 'Курса пока нет — введите его, чтобы пересчитать сумму в основную валюту'
            : 'Курс — число больше нуля, например 10,9',
      };
    }
    return { ok: true, fx: { rate, source: 'manual' }, remember: remember(rate) };
  };

  return { view, rateText, setRateText: (text) => setTyped({ currency: walletCurrency, text }), resolve };
}
