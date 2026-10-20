import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

const HIDE_KEY = 'finora-hide-balance';

interface HideValue {
  hidden: boolean;
  toggle: () => void;
  /** Есть ли над этим местом переключатель (иначе — значение по умолчанию: суммы видны). */
  provided: boolean;
}

const HideContext = createContext<HideValue>({ hidden: false, toggle: () => undefined, provided: false });

/**
 * «Скрыть суммы» — выбор хранится на устройстве: удобно открывать приложение при посторонних. Провайдер стоит в каркасе приложения,
 * поэтому действует на всех экранах, где суммы рисует MoneyText. Вложенный провайдер (на «Главной», в тестах) ничего не меняет:
 * состояние одно, над ним.
 */
export function HideAmountsProvider({ children }: { children: ReactNode }) {
  const parent = useContext(HideContext);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (parent.provided) return;
    try {
      localStorage.setItem(HIDE_KEY, hidden ? '1' : '0');
    } catch {
      /* не сохранилось — работает до перезагрузки */
    }
  }, [hidden, parent.provided]);
  const toggle = useCallback(() => setHidden((v) => !v), []);
  const value = useMemo(() => ({ hidden, toggle, provided: true }), [hidden, toggle]);
  if (parent.provided) return <>{children}</>;
  return <HideContext.Provider value={value}>{children}</HideContext.Provider>;
}

export function useHideAmounts(): Pick<HideValue, 'hidden' | 'toggle'> {
  const { hidden, toggle } = useContext(HideContext);
  return { hidden, toggle };
}

/** Точки вместо суммы; для скринридера — «Сумма скрыта». */
export function Masked({ className, dots = '••••' }: { className?: string; dots?: string }) {
  return (
    <span className={cn('money', className)} role="img" aria-label="Сумма скрыта">
      {dots}
    </span>
  );
}
