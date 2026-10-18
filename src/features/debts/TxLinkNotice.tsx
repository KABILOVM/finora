import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import type { Transaction } from '@/domain/types';
import { useDebtTxRole, type DebtTxLink } from './useDebtTxRole';

type Linked = DebtTxLink & Pick<Transaction, 'recurringRuleId'>;

/**
 * Пояснение в шите правки операции, которая связана с долгом или с регулярным платежом: что связь есть, что она сохранится
 * и какие правки репозиторий не пропустит (кошелёк только в валюте долга, перевод из такой операции сделать нельзя).
 * Саму связь форма не меняет — поля для неё нет, поэтому потерять или подменить её случайно нельзя.
 * У выдачи (исходная операция или «добавить ещё») отдельная оговорка: сумма долга хранится в самом долге, правка операции
 * меняет только кошелёк и «Выдано деньгами».
 */
export function TxLinkNotice({ tx }: { tx: Linked }) {
  const debtId = tx.debtId;
  // «долга нет» (debt: null) отличается от «ещё читается» (undefined)
  const found = useDebtTxRole(tx);
  if (!debtId && !tx.recurringRuleId) return null;

  return (
    <div className="mb-3 flex flex-col gap-2" data-testid="tx-link-notice">
      {debtId && (
        <p className="flex items-start gap-2 rounded-xl bg-brand/10 px-3 py-2 text-sm text-text">
          <Icon name="banknote" size={18} className="mt-0.5 shrink-0 text-brand" />
          <span className="min-w-0 break-words">
            {found?.debt ? (
              <>
                Эта операция относится к долгу «{found.debt.counterparty}». Связь сохранится; кошелёк — только в валюте долга (
                {found.debt.currency}).{' '}
                {found.role === 'entry' && 'Сумма долга хранится в самом долге: правка здесь изменит только кошелёк и «Выдано деньгами». '}
                <Link to={`/debts/${debtId}`} className="inline-flex min-h-[44px] items-center font-semibold text-brand">
                  Открыть долг
                </Link>
              </>
            ) : found ? (
              'Эта операция относится к долгу, которого уже нет в списке. Связь с ним сохранится.'
            ) : (
              'Эта операция относится к долгу. Связь с ним сохранится.'
            )}
          </span>
        </p>
      )}
      {tx.recurringRuleId && (
        <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-text">
          <Icon name="repeat" size={18} className="mt-0.5 shrink-0 text-muted" />
          <span>Операция создана регулярным платежом. Связь с ним сохранится при правке.</span>
        </p>
      )}
    </div>
  );
}
