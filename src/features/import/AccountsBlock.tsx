import { useId } from 'react';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { inputClasses } from '@/components/Field';
import type { PlanWallet, WalletChoice } from '@/import/types';
import { opsWord, walletNote } from './importText';

const NEW = 'new';

function selectValue(w: PlanWallet): string {
  const t = w.target;
  if (t.kind === 'create') return NEW;
  if (t.kind === 'existing') return t.id;
  return '';
}

function AccountRow({ w, onChoose }: { w: PlanWallet; onChoose: (key: string, choice: WalletChoice) => void }) {
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
    </li>
  );
}

/** Сопоставление счетов Zenmoney с кошельками: автоподбор по названию и валюте, можно выбрать свой или создать новый. */
export function AccountsBlock({ wallets, onChoose }: { wallets: readonly PlanWallet[]; onChoose: (key: string, choice: WalletChoice) => void }) {
  if (wallets.length === 0) return null;
  return (
    <section aria-labelledby="accounts-h" className="flex flex-col gap-2">
      <h2 id="accounts-h" className="px-1 text-sm font-bold uppercase tracking-wide text-muted">
        Счета и кошельки
      </h2>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {wallets.map((w) => (
            <AccountRow key={w.key} w={w} onChoose={onChoose} />
          ))}
        </ul>
      </Card>
    </section>
  );
}
