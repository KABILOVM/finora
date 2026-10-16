import { MoneyText, type MoneyTextProps } from './MoneyText';
import { useCountUp } from './useCountUp';

/**
 * Сумма, которая плавно «набегает» до нового значения. Живёт отдельным маленьким компонентом: покадровая перерисовка касается
 * только этого числа, а не всей карточки вокруг. Без движения (тесты, «уменьшить движение») сразу показывает итоговое значение.
 */
export function CountUpMoney({ minor, ...rest }: MoneyTextProps) {
  const shown = useCountUp(Number.isSafeInteger(minor) ? minor : 0);
  return <MoneyText minor={Number.isSafeInteger(minor) ? shown : minor} {...rest} />;
}
