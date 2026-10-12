import { Glyph } from '@/components/Glyph';
import { useRef, useState } from 'react';
import { ChipPicker, type ChipOption } from '@/components/ChipPicker';
import { Floating, useDismiss } from '@/components/Floating';
import { Icon } from '@/components/Icon';
import type { LocalRow, Wallet } from '@/domain/types';
import { cn } from '@/lib/cn';
import { CategoryPicker } from './CategoryPicker';
import { FieldGroup } from './FieldGroup';
import type { TxFormController } from './useTxFormController';

/** Подпись чипа кошелька. Если кошельки в разных валютах — с кодом валюты, чтобы не перепутать «Карта» и «Карта». */
export function walletOptions(wallets: readonly LocalRow<Wallet>[]): ChipOption[] {
  const mixed = new Set(wallets.map((w) => w.currency)).size > 1;
  return wallets.map((w) => ({ value: w.id, icon: w.icon, color: w.color, label: mixed ? `${w.name} · ${w.currency}` : w.name }));
}

type Panel = 'wallet' | 'toWallet' | 'category' | null;

/** Плитка поля: маленькая подпись сверху, значение крупно, стрелка; открытая подсвечена. */
function Tile({
  caption,
  icon,
  color,
  label,
  ariaLabel,
  open,
  invalid,
  onClick,
}: {
  caption: string;
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
        'flex min-h-[60px] min-w-0 items-center gap-2.5 rounded-2xl border px-3 text-left transition-colors',
        invalid ? 'border-danger bg-danger/5' : open ? 'border-brand bg-brand/10' : 'border-border bg-surface active:bg-surface-2',
      )}
    >
      <Glyph value={icon} color={color} size={30} />
      <span className="min-w-0 flex-1">
        <span className={cn('block text-xs font-semibold', invalid ? 'text-danger' : 'text-muted')}>{caption}</span>
        <span className={cn('block truncate text-base font-bold', invalid ? 'text-danger' : open ? 'text-brand' : 'text-text')}>
          {label}
        </span>
      </span>
      <Icon name="chevron" size={14} className={cn('shrink-0 text-muted transition-transform', open ? '-rotate-90' : 'rotate-90')} />
    </button>
  );
}

export interface ContextRowProps {
  c: TxFormController;
  wallets: readonly LocalRow<Wallet>[];
  /** Категории вида операции, самые частые первыми; у перевода их нет. */
  categories: readonly ChipOption[];
}

/**
 * Две плитки «куда пойдут деньги»: категория и счёт (у перевода — «Откуда» и «Куда»). Подставляются сами, видны над клавиатурой;
 * нажатие открывает список поверх формы. Дата — в шапке окна (DateChip).
 */
export function ContextRow({ c, wallets, categories }: ContextRowProps) {
  const { form, errors } = c;
  const [panel, setPanel] = useState<Panel>(null);
  const isTransfer = form.kind === 'transfer';
  const options = walletOptions(wallets);
  const label = (id: string | null) => options.find((o) => o.value === id)?.label;
  const toOptions = options.filter((o) => o.value !== form.walletId);
  const category = categories.find((o) => o.value === form.categoryId);

  // Ошибка у скрытого списка не должна теряться: панель с ошибкой раскрыта сама
  const show: Panel = errors.wallet ? 'wallet' : errors.toWallet ? 'toWallet' : errors.category ? 'category' : panel;
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const boxRef = useRef<HTMLDivElement>(null);
  useDismiss(panel !== null, () => setPanel(null), boxRef);

  const walletName = label(form.walletId) ?? 'не выбран';
  const noTarget = isTransfer && toOptions.length === 0;
  const wallet = wallets.find((w) => w.id === form.walletId);
  const toWallet = wallets.find((w) => w.id === form.toWalletId);

  return (
    <div ref={boxRef} className="relative flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {isTransfer ? (
          <>
            <Tile
              caption="Откуда"
              icon={wallet?.icon ?? '👛'}
              color={wallet?.color}
              label={walletName}
              ariaLabel={`Откуда: ${walletName}`}
              open={show === 'wallet'}
              invalid={!!errors.wallet}
              onClick={() => toggle('wallet')}
            />
            <Tile
              caption="Куда"
              icon={toWallet?.icon ?? '👛'}
              color={toWallet?.color}
              label={label(form.toWalletId) ?? 'не выбран'}
              ariaLabel={`Куда: ${label(form.toWalletId) ?? 'не выбран'}`}
              open={show === 'toWallet'}
              invalid={!!errors.toWallet}
              onClick={() => toggle('toWallet')}
            />
          </>
        ) : (
          <>
            <Tile
              caption="Категория"
              icon={category?.icon ?? '🏷️'}
              color={category?.color}
              label={category?.label ?? 'Выбрать'}
              ariaLabel={`Категория: ${category?.label ?? 'не выбрана'}`}
              open={show === 'category'}
              invalid={!!errors.category}
              onClick={() => toggle('category')}
            />
            <Tile
              caption="Счёт"
              icon={wallet?.icon ?? '👛'}
              color={wallet?.color}
              label={walletName}
              ariaLabel={`Кошелёк: ${walletName}`}
              open={show === 'wallet'}
              invalid={!!errors.wallet}
              onClick={() => toggle('wallet')}
            />
          </>
        )}
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
          {show === 'category' && (
            <CategoryPicker
              options={categories}
              kind={form.kind === 'income' ? 'income' : 'expense'}
              value={form.categoryId}
              onChange={(id) => {
                c.set({ categoryId: id });
                if (id !== null) setPanel(null);
              }}
              error={errors.category}
              expanded
            />
          )}
        </Floating>
      )}
    </div>
  );
}
