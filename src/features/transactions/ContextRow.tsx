import { Glyph } from '@/components/Glyph';
import { useRef, useState } from 'react';
import { ChipPicker, type ChipOption } from '@/components/ChipPicker';
import { Floating, useDismiss } from '@/components/Floating';
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
  return wallets.map((w) => ({ value: w.id, icon: w.icon, color: w.color, label: mixed ? `${w.name} · ${w.currency}` : w.name }));
}

type Panel = 'wallet' | 'toWallet' | 'date' | null;

/** Одно из полей «куда и когда» в общей полосе: значок, название и стрелка; открытое подсвечено. */
function ContextChip({
  icon,
  color,
  label,
  ariaLabel,
  open,
  invalid,
  onClick,
}: {
  icon: string;
  color?: string;
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
        'inline-flex min-h-[48px] min-w-0 flex-1 items-center justify-center gap-2 px-3 text-base font-semibold transition-colors',
        invalid ? 'text-danger' : open ? 'bg-brand/10 text-brand' : 'text-text active:bg-surface-2',
      )}
    >
      {icon === 'calendar' ? (
        <Icon name="calendar" size={22} className="shrink-0 text-muted" />
      ) : (
        <Glyph value={icon} color={color} size={26} />
      )}
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
  const boxRef = useRef<HTMLDivElement>(null);
  useDismiss(panel !== null, () => setPanel(null), boxRef);

  const walletName = label(form.walletId) ?? 'не выбран';
  const noTarget = isTransfer && toOptions.length === 0;

  return (
    <div ref={boxRef} className="relative flex flex-col gap-2">
      <div className="flex divide-x divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_8px_18px_-14px_rgb(var(--brand)/0.5)]">
        <ContextChip
          icon={wallets.find((w) => w.id === form.walletId)?.icon ?? '👛'}
          color={wallets.find((w) => w.id === form.walletId)?.color}
          label={walletName}
          ariaLabel={`${isTransfer ? 'Откуда' : 'Кошелёк'}: ${walletName}`}
          open={show === 'wallet'}
          invalid={!!errors.wallet}
          onClick={() => toggle('wallet')}
        />
        {isTransfer && (
          <ContextChip
            icon={wallets.find((w) => w.id === form.toWalletId)?.icon ?? '👛'}
            color={wallets.find((w) => w.id === form.toWalletId)?.color}
            label={label(form.toWalletId) ?? 'не выбран'}
            ariaLabel={`Куда: ${label(form.toWalletId) ?? 'не выбран'}`}
            open={show === 'toWallet'}
            invalid={!!errors.toWallet}
            onClick={() => toggle('toWallet')}
          />
        )}
        <ContextChip
          icon="📅"
          label={dateText}
          ariaLabel={`Дата: ${dateText}`}
          open={show === 'date'}
          invalid={!!errors.date}
          onClick={() => toggle('date')}
        />
      </div>

      {noTarget && (
        <p className="text-sm font-medium text-warning">Для перевода нужен второй кошелёк. Создайте его на экране «Кошельки».</p>
      )}

      {isTransfer && errors.toWallet && show !== 'toWallet' && (
        <p role="alert" className="text-sm font-medium text-danger">
          {errors.toWallet}
        </p>
      )}

      {/* Списки открываются поверх формы, а не раздвигают её: окно не прыгает */}
      {show !== null && (
        <Floating>
          {show === 'wallet' && (
            <FieldGroup label={isTransfer ? 'Откуда' : 'Кошелёк'} error={errors.wallet} hideLabel>
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
            <FieldGroup label="Куда" error={errors.toWallet} hideLabel>
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
          {show === 'date' && (
            <DateChips value={form.date} onChange={(date) => c.set({ date })} onDone={() => setPanel(null)} error={errors.date} hideLabel />
          )}
        </Floating>
      )}
    </div>
  );
}
