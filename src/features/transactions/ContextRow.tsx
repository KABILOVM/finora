import { useState } from 'react';
import { ChipPicker, type ChipOption } from '@/components/ChipPicker';
import { Icon } from '@/components/Icon';
import type { LocalRow, Wallet } from '@/domain/types';
import { cn } from '@/lib/cn';
import { formatDayLabel, isValidIsoDate, todayLocal } from '@/lib/dates';
import { DateChips } from './DateChips';
import { FieldGroup } from './FieldGroup';
import { resolveDate } from './txForm';
import type { TxFormController } from './useTxFormController';

/** Подпись чипа кошелька. Если кошельки в разных валютах — с кодом валюты, чтобы не перепутать «Карта» и «Карта». */
export function walletOptions(wallets: readonly LocalRow<Wallet>[]): ChipOption[] {
  const mixed = new Set(wallets.map((w) => w.currency)).size > 1;
  return wallets.map((w) => ({ value: w.id, icon: w.icon, label: mixed ? `${w.name} · ${w.currency}` : w.name }));
}

type Panel = 'wallet' | 'toWallet' | 'date' | null;

function ContextChip({
  icon,
  label,
  ariaLabel,
  open,
  invalid,
  onClick,
}: {
  icon: string;
  label: string;
  ariaLabel: string;
  open: boolean;
  invalid?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-[44px] max-w-full items-center gap-1.5 rounded-full border px-3.5 text-base font-medium transition-colors',
        invalid ? 'border-danger text-danger' : open ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text hover:bg-surface-2',
      )}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="truncate">{label}</span>
      <Icon name="chevron" size={14} className={cn('shrink-0 text-muted transition-transform', open ? '-rotate-90' : 'rotate-90')} />
    </button>
  );
}

export interface ContextRowProps {
  c: TxFormController;
  wallets: readonly LocalRow<Wallet>[];
}

/**
 * Строка «куда пойдут деньги и когда»: кошелёк и дата подставляются сами и всегда видны над клавиатурой,
 * сменить — касанием по чипу (список раскрывается тут же). У перевода — «Откуда», «Куда» и дата.
 */
export function ContextRow({ c, wallets }: ContextRowProps) {
  const { form, errors } = c;
  const [panel, setPanel] = useState<Panel>(null);
  const isTransfer = form.kind === 'transfer';
  const options = walletOptions(wallets);
  const label = (id: string | null) => options.find((o) => o.value === id)?.label;
  const toOptions = options.filter((o) => o.value !== form.walletId);

  const resolved = resolveDate(form.date);
  const today = todayLocal();
  const dateText = isValidIsoDate(resolved) ? formatDayLabel(resolved, today) : 'Дата не указана';

  // Ошибка у скрытого списка не должна теряться: панель с ошибкой раскрыта сама
  const show: Panel = errors.date ? 'date' : errors.wallet ? 'wallet' : errors.toWallet ? 'toWallet' : panel;
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  const walletName = label(form.walletId) ?? 'не выбран';
  const noTarget = isTransfer && toOptions.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <ContextChip
          icon={wallets.find((w) => w.id === form.walletId)?.icon ?? '👛'}
          label={walletName}
          ariaLabel={`${isTransfer ? 'Откуда' : 'Кошелёк'}: ${walletName}`}
          open={show === 'wallet'}
          invalid={!!errors.wallet}
          onClick={() => toggle('wallet')}
        />
        {isTransfer && (
          <ContextChip
            icon={wallets.find((w) => w.id === form.toWalletId)?.icon ?? '👛'}
            label={label(form.toWalletId) ?? 'не выбран'}
            ariaLabel={`Куда: ${label(form.toWalletId) ?? 'не выбран'}`}
            open={show === 'toWallet'}
            invalid={!!errors.toWallet}
            onClick={() => toggle('toWallet')}
          />
        )}
        <ContextChip icon="📅" label={dateText} ariaLabel={`Дата: ${dateText}`} open={show === 'date'} invalid={!!errors.date} onClick={() => toggle('date')} />
      </div>

      {noTarget && (
        <p className="text-sm font-medium text-warning">Для перевода нужен второй кошелёк. Создайте его на экране «Кошельки».</p>
      )}

      {show === 'wallet' && (
        <FieldGroup label={isTransfer ? 'Откуда' : 'Кошелёк'} error={errors.wallet}>
          <ChipPicker
            ariaLabel={isTransfer ? 'Откуда' : 'Кошелёк'}
            options={options}
            value={form.walletId}
            onChange={(id) => {
              c.setWallet(id);
              setPanel(null);
            }}
          />
        </FieldGroup>
      )}
      {show === 'toWallet' && (
        <FieldGroup label="Куда" error={errors.toWallet}>
          <ChipPicker
            ariaLabel="Куда"
            options={toOptions}
            value={form.toWalletId}
            onChange={(id) => {
              c.setToWallet(id);
              setPanel(null);
            }}
          />
        </FieldGroup>
      )}
      {isTransfer && errors.toWallet && show !== 'toWallet' && (
        <p role="alert" className="text-sm font-medium text-danger">
          {errors.toWallet}
        </p>
      )}
      {show === 'date' && (
        <DateChips value={form.date} onChange={(date) => c.set({ date })} onDone={() => setPanel(null)} error={errors.date} />
      )}
    </div>
  );
}
