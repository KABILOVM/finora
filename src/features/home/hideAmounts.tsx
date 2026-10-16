import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CountUpMoney } from '@/components/CountUpMoney';
import { MoneyText, type MoneyTextProps } from '@/components/MoneyText';
import { cn } from '@/lib/cn';

const HIDE_KEY = 'finora-hide-balance';

interface HideValue {
  hidden: boolean;
  toggle: () => void;
}

const HideContext = createContext<HideValue>({ hidden: false, toggle: () => undefined });

/** «Скрыть суммы» — выбор хранится на устройстве: удобно открывать приложение при посторонних. Действует на всей главной. */
export function HideAmountsProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(HIDE_KEY, hidden ? '1' : '0');
    } catch {
      /* не сохранилось — работает до перезагрузки */
    }
  }, [hidden]);
  const toggle = useCallback(() => setHidden((v) => !v), []);
  const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle]);
  return <HideContext.Provider value={value}>{children}</HideContext.Provider>;
}

export function useHideAmounts(): HideValue {
  return useContext(HideContext);
}

/** Точки вместо суммы; для скринридера — «Сумма скрыта». */
export function Masked({ className, dots = '••••' }: { className?: string; dots?: string }) {
  return (
    <span className={cn('money', className)} role="img" aria-label="Сумма скрыта">
      {dots}
    </span>
  );
}

/** Сумма на главной: прячется глазом, иначе обычная или «набегающая». */
export function HomeMoney({ animated = false, ...props }: MoneyTextProps & { animated?: boolean }) {
  const { hidden } = useHideAmounts();
  if (hidden) return <Masked className={props.className} />;
  return animated ? <CountUpMoney {...props} /> : <MoneyText {...props} />;
}
