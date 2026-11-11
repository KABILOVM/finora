import { Link } from 'react-router-dom';
import { Glyph } from '@/components/Glyph';
import type { LocalRow, Minor, UUID, Wallet } from '@/domain/types';
import { walletOpsQuery } from '@/features/transactions/txFilters';
import { useGoals } from '@/features/wallets/useGoals';
import { HomeMoney } from './hideAmounts';

export interface WalletChipsProps {
  wallets: readonly LocalRow<Wallet>[];
  balances: ReadonlyMap<UUID, Minor>;
}

/**
 * Кошельки лентой небольших карточек (значок, название, остаток), листается пальцем. Карточка ведёт в операции этого кошелька и слегка
 * подсвечена цветом кошелька (--w, см. .wallet-card в look.css). У накопления с целью — тонкая полоска прогресса внизу.
 * Карточки появляются по очереди с пружиной, остатки «набегают».
 */
export function WalletChips({ wallets, balances }: WalletChipsProps) {
  const goals = useGoals();
  const goalPercent = new Map(goals?.map((g) => [g.wallet.id, g.progress.percent]));
  return (
    <section aria-labelledby="home-wallets">
      <h2 id="home-wallets" className="sr-only">
        Кошельки
      </h2>
      <ul className="scroll-x-quiet -mx-4 flex snap-x scroll-px-4 gap-2.5 px-4 pb-2 pt-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {wallets.map((w, i) => {
          const balance = balances.get(w.id) ?? 0;
          const percent = goalPercent.get(w.id);
          return (
            <li key={w.id} style={{ '--i': i } as React.CSSProperties} className="pop-spring shrink-0 snap-start">
              <Link
                to={`/transactions?${walletOpsQuery(w.id)}`}
                style={{ '--w': w.color } as React.CSSProperties}
                className="wallet-card press card relative flex min-h-[88px] min-w-[9.5rem] flex-col justify-between gap-2 overflow-hidden rounded-2xl p-3 shadow-card hover:bg-surface-2"
              >
                <span className="flex items-center gap-2">
                  <Glyph value={w.icon} color={w.color} size={32} />
                  <span className="block max-w-[8rem] truncate text-[13px] font-medium leading-tight text-muted">{w.name}</span>
                </span>
                <HomeMoney
                  minor={balance}
                  currency={w.currency}
                  tone={balance < 0 ? 'expense' : 'none'}
                  animated
                  className="block text-[17px] font-bold leading-tight tracking-tight"
                />
                {percent !== undefined && (
                  <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-2">
                    <span className="bar-grow block h-full rounded-r-full bg-income" style={{ width: `${Math.max(2, percent)}%` }} />
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
