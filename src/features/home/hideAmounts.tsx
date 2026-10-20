import { CountUpMoney } from '@/components/CountUpMoney';
import { MoneyText, type MoneyTextProps } from '@/components/MoneyText';
import { Masked, useHideAmounts } from '@/components/hideAmounts';

export { HideAmountsProvider, Masked, useHideAmounts } from '@/components/hideAmounts';

/** Сумма на главной: прячется глазом, иначе обычная или «набегающая». */
export function HomeMoney({ animated = false, ...props }: MoneyTextProps & { animated?: boolean }) {
  const { hidden } = useHideAmounts();
  if (hidden) return <Masked className={props.className} />;
  return animated ? <CountUpMoney {...props} /> : <MoneyText {...props} />;
}
