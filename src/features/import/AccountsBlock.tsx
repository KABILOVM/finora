import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { inputClasses } from '@/components/Field';
import { SectionHeader } from '@/components/SectionHeader';
import { formatMinor } from '@/domain/money';
import type { Minor, UUID } from '@/domain/types';
import type { PlanWallet, WalletChoice } from '@/import/types';
import { opsWord, walletNote } from './importText';
import type { WalletImpact } from './impact';

const NEW = 'new';

function selectValue(w: PlanWallet): string {
  const t = w.target;
  if (t.kind === 'create') return NEW;
  if (t.kind === 'existing') return t.id;
  return '';
}

/** Что произойдёт с остатком кошелька, который уже есть у вас: «Остаток изменится: 800 с. → −142,06 с. (+37 операций)». */
function BalanceChange({ w, balance, impact }: { w: PlanWallet; balance: Minor; impact: WalletImpact }) {
  if (impact.deltaMinor === null) return null;
  const after = balance + impact.deltaMinor;
  if (!Number.isSafeInteger(after)) return null;
  const negative = after < 0 && balance >= 0;
  return (
    <p className={negative ? 'text-sm font-medium text-warning' : 'text-sm text-muted'} data-testid={`impact-${w.key}`}>
      Остаток изменится: {formatMinor(balance, w.currency)} → {formatMinor(after, w.currency)} ({impact.count} {opsWord(impact.count)}).
      {negative ? ' Остаток уйдёт в минус: возможно, счёт стоит завести отдельным кошельком.' : ''}
    </p>
  );
}

export interface AccountsBlockProps {
  wallets: readonly PlanWallet[];
  onChoose: (key: string, choice: WalletChoice) => void;
  /** Текущие остатки кошельков и сдвиг от импорта — чтобы показать, как изменится остаток кошелька, найденного у вас по названию. */
  balances?: ReadonlyMap<UUID, Minor>;
  impacts?: ReadonlyMap<UUID, WalletImpact>;
}

function AccountRow({
  w,
  onChoose,
  balances,
  impacts,
}: { w: PlanWallet; onChoose: (key: string, choice: WalletChoice) => void } & Pick<AccountsBlockProps, 'balances' | 'impacts'>) {
  const id = useId();
  const t = w.target;
  const label = `Кошелёк для счёта «${w.name}»`;
  const value = selectValue(w);
  // «Создать новый» предлагаем, только если он правда создастся: когда кошелёк прошлого импорта уже есть (живой, в архиве или
  // удалён), «новый» был бы тем же самым кошельком, а выбор ничего бы не менял
  const offerNew = w.canCreate;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-semibold">{w.name}</span>
        <Badge tone="neutral">{w.currency}</Badge>
        <span className="text-sm text-muted">
          {w.rowCount} {opsWord(w.rowCount)}
        </span>
      </div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        aria-label={label}
        className={`${inputClasses(t.kind === 'blocked')} min-h-[48px]`}
        value={value}
        onChange={(e) => onChoose(w.key, e.target.value as WalletChoice)}
      >
        {value === '' && (
          <option value="" disabled>
            Выберите кошелёк
          </option>
        )}
        {offerNew && <option value={NEW}>Создать новый кошелёк «{w.name}»</option>}
        {w.candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <p className={t.kind === 'blocked' ? 'text-sm font-medium text-danger' : 'text-sm text-muted'}>{walletNote(t)}</p>
      {t.kind === 'blocked' && w.candidates.length === 0 && !offerNew && (
        <p className="text-sm text-muted">
          Подходящих кошельков в {w.currency} нет. Заведите кошелёк в этой валюте в разделе{' '}
          <Link to="/wallets?new=1" className="font-semibold text-brand underline">
            «Кошельки»
          </Link>{' '}
          и загрузите файл ещё раз: то, что уже добавлено, не повторится.
        </p>
      )}
      {t.kind === 'existing' && balances && impacts && (
        <ExistingBalance w={w} id={t.id} balances={balances} impacts={impacts} />
      )}
    </li>
  );
}

function ExistingBalance({ w, id, balances, impacts }: { w: PlanWallet; id: UUID } & Required<Pick<AccountsBlockProps, 'balances' | 'impacts'>>) {
  const balance = balances.get(id);
  const impact = impacts.get(id);
  if (balance === undefined || impact === undefined || impact.count === 0) return null;
  return <BalanceChange w={w} balance={balance} impact={impact} />;
}

/** Сопоставление счетов Дзен-мани с кошельками: автоподбор по названию и валюте, можно выбрать свой или создать новый. */
export function AccountsBlock({ wallets, onChoose, balances, impacts }: AccountsBlockProps) {
  if (wallets.length === 0) return null;
  return (
    <section aria-labelledby="accounts-h" className="flex flex-col gap-2">
      <SectionHeader id="accounts-h" className="mb-0">
        Счета и кошельки
      </SectionHeader>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {wallets.map((w) => (
            <AccountRow key={w.key} w={w} onChoose={onChoose} balances={balances} impacts={impacts} />
          ))}
        </ul>
      </Card>
    </section>
  );
}
