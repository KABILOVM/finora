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
 * Кошельки одной лентой чипов (значок, название, остаток), листается пальцем. Чип ведёт в операции этого кошелька. У накопления с целью —
 * тонкая полоска прогресса внизу чипа. Чипы появляются по очереди с пружиной, остатки «набегают».
 */
export function WalletChips({ wallets, balances }: WalletChipsProps) {
  const goals = useGoals();
  const goalPercent = new Map(goals?.map((g) => [g.wallet.id, g.progress.percent]));
  return (
    <section aria-labelledby="home-wallets">
      <h2 id="home-wallets" className="sr-only">
        Кошельки
      </h2>
      <ul className="scroll-x-quiet -mx-4 flex snap-x scroll-px-4 gap-2 px-4 pb-1 pt-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {wallets.map((w, i) => {
          const balance = balances.get(w.id) ?? 0;
          const percent = goalPercent.get(w.id);
          return (
            <li key={w.id} style={{ '--i': i } as React.CSSProperties} className="pop-spring shrink-0 snap-start">
              <Link
                to={`/transactions?${walletOpsQuery(w.id)}`}
                className="press relative flex min-h-[52px] items-center gap-2 overflow-hidden rounded-2xl border border-border/70 bg-surface/85 py-2 pl-2 pr-3.5 shadow-card hover:bg-surface-2"
              >
                <Glyph value={w.icon} color={w.color} size={28} />
                <span className="min-w-0">
                  <span className="block max-w-[7.5rem] truncate text-xs leading-tight text-muted">{w.name}</span>
                  <HomeMoney
                    minor={balance}
                    currency={w.currency}
                    tone={balance < 0 ? 'expense' : 'none'}
                    animated
                    className="block text-[15px] font-bold leading-tight"
                  />
                </span>
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
