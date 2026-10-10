import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/Toast';
import { useBalances, useSettings, useStore, useWallets } from '@/db';
import { formatMinor } from '@/domain/money';
import type { LocalRow, Wallet } from '@/domain/types';
import { formatDayLabel } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { useRates } from '@/rates/hooks';
import { ReconcileSheet } from './ReconcileSheet';
import { computeWalletsTotal } from './walletTotals';
import { WALLET_KIND_LABELS } from './walletUi';
import { WalletSheet } from './WalletSheet';

type SheetState = { kind: 'new' } | { kind: 'edit'; wallet: LocalRow<Wallet> };

function WalletIcon({ wallet }: { wallet: Wallet }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 items-center justify-center rounded-full text-xl"
      style={{ backgroundColor: `${wallet.color}26` }}
    >
      {wallet.icon}
    </span>
  );
}

/** Кошельки: остатки в их валюте, итог «Всего» в базовой, создание и правка, архив, сверка. */
export default function WalletsPage() {
  const store = useStore();
  const toast = useToast();
  const wallets = useWallets({ includeArchived: true });
  const balances = useBalances();
  const settings = useSettings();
  const { getRate } = useRates();

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [reconciling, setReconciling] = useState<LocalRow<Wallet> | null>(null);
  const [archiving, setArchiving] = useState<LocalRow<Wallet> | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const active = useMemo(() => (wallets ?? []).filter((w) => w.archivedAt === null), [wallets]);
  const archived = useMemo(() => (wallets ?? []).filter((w) => w.archivedAt !== null), [wallets]);
  const base = settings?.baseCurrency;

  const total = useMemo(
    () => (base && balances ? computeWalletsTotal(active, balances, base, getRate) : undefined),
    [active, balances, base, getRate],
  );

  if (wallets === undefined || balances === undefined || settings === undefined) {
    return (
      <>
        <PageHeader title="Кошельки" />
        <p role="status" className="py-10 text-center text-muted">
          Загрузка…
        </p>
      </>
    );
  }

  const report = (e: unknown, fallback: string) => {
    console.error(fallback, e);
    toast.error(e instanceof Error && e.name === 'ValidationError' ? e.message : fallback);
  };

  const archive = async (w: LocalRow<Wallet>) => {
    if (busy) return;
    setBusy(true);
    try {
      await store.wallets.archive(w.id);
      // Кошелёк по умолчанию в архиве выбрать нельзя — сбрасываем, чтобы шит добавления не предлагал скрытый кошелёк.
      if (settings?.defaultWalletId === w.id) await store.settings.update({ defaultWalletId: null });
      toast.success(`Кошелёк «${w.name}» убран в архив`);
      setArchiving(null);
    } catch (e) {
      report(e, 'Не удалось убрать кошелёк в архив');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (w: LocalRow<Wallet>) => {
    if (busy) return;
    setBusy(true);
    try {
      await store.wallets.restore(w.id);
      toast.success(`Кошелёк «${w.name}» возвращён`);
    } catch (e) {
      report(e, 'Не удалось вернуть кошелёк');
    } finally {
      setBusy(false);
    }
  };

  const balanceOf = (w: Wallet) => balances.get(w.id) ?? 0;
  const archivingBalance = archiving ? balanceOf(archiving) : 0;

  return (
    <>
      <PageHeader
        title="Кошельки"
        actions={
          <Button icon="plus" onClick={() => setSheet({ kind: 'new' })} disabled={!base}>
            Добавить
          </Button>
        }
      />

      {base && total !== undefined && (
        <Card className="mb-4">
          <div className="text-sm font-semibold text-muted">Всего</div>
          {total === null ? (
            <div className="text-lg text-muted">Сумма слишком велика для расчёта</div>
          ) : (
            <>
              <div className="text-3xl font-bold" data-testid="wallets-total">
                {total.approximate && <span title="Приблизительно, по курсу">≈ </span>}
                <MoneyText minor={total.totalMinor} currency={base} tone="none" />
              </div>
              {total.approximate && <p className="mt-1 text-sm text-muted">Итог пересчитан по курсам и поэтому приблизительный.</p>}
              {total.stale.length > 0 && (
                <p role="alert" className="mt-1 text-sm text-warning">
                  Курс устарел:{' '}
                  {total.stale.map((s) => `${s.currency} (от ${formatDayLabel(s.asOf)})`).join(', ')}. Обновите курсы в Настройках.
                </p>
              )}
              {total.missing.length > 0 && (
                <p role="alert" className="mt-1 text-sm text-warning">
                  Нет курса, в итог не вошли: {total.missing.join(', ')}. Задайте курс в Настройках.
                </p>
              )}
              <p className="mt-1 text-sm text-muted">Архивные кошельки в итог не входят.</p>
            </>
          )}
        </Card>
      )}

      {active.length === 0 ? (
        <EmptyState
          icon="wallet"
          title="Пока нет кошельков"
          text="Добавьте кошелёк: наличные, карту или счёт в банке."
          action={base ? <Button onClick={() => setSheet({ kind: 'new' })}>Добавить кошелёк</Button> : undefined}
        />
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-border">
            {active.map((w) => {
              const bal = balanceOf(w);
              return (
                <li key={w.id} className="flex items-center pr-2">
                  <ListRow
                    className="min-w-0 flex-1"
                    leading={<WalletIcon wallet={w} />}
                    title={w.name}
                    subtitle={`${WALLET_KIND_LABELS[w.kind]} · ${w.currency}`}
                    trailing={<MoneyText minor={bal} currency={w.currency} tone={bal < 0 ? 'expense' : 'none'} className="font-semibold" />}
                    onClick={() => setSheet({ kind: 'edit', wallet: w })}
                  />
                  <Button variant="ghost" aria-label={`Сверка: ${w.name}`} onClick={() => setReconciling(w)}>
                    Сверка
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {archived.length > 0 && (
        <section className="mt-6">
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-1 text-left font-semibold text-muted"
          >
            <span>
              Архив · {archived.length} {pluralRu(archived.length, 'кошелёк', 'кошелька', 'кошельков')}
            </span>
            <Icon name="chevron" size={18} className={showArchived ? 'rotate-90' : ''} />
          </button>
          {showArchived && (
            <Card padding="none" className="mt-1">
              <ul className="divide-y divide-border">
                {archived.map((w) => (
                  <li key={w.id} className="flex items-center pr-2">
                    <ListRow
                      className="min-w-0 flex-1"
                      leading={<WalletIcon wallet={w} />}
                      title={w.name}
                      subtitle={`${WALLET_KIND_LABELS[w.kind]} · ${w.currency}`}
                      trailing={<MoneyText minor={balanceOf(w)} currency={w.currency} tone="none" />}
                    />
                    <Button variant="secondary" aria-label={`Вернуть: ${w.name}`} disabled={busy} onClick={() => void restore(w)}>
                      Вернуть
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}

      {wallets.length > 0 && (
        <p className="mt-6 flex items-start gap-2 text-sm text-muted">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" />
          <span>Остаток нигде не хранится: он считается из начального остатка и операций, поэтому не может «разъехаться».</span>
        </p>
      )}

      {sheet && base && (
        <WalletSheet
          key={sheet.kind === 'edit' ? sheet.wallet.id : 'new'}
          wallet={sheet.kind === 'edit' ? sheet.wallet : null}
          defaultCurrency={base}
          otherNames={wallets.filter((w) => sheet.kind !== 'edit' || w.id !== sheet.wallet.id).map((w) => w.name)}
          onClose={() => setSheet(null)}
          onArchive={
            sheet.kind === 'edit'
              ? () => {
                  setArchiving(sheet.wallet);
                  setSheet(null);
                }
              : undefined
          }
        />
      )}
      {/* берём кошелёк из живого списка, а не снимок на момент нажатия: правка с другого устройства не должна давать ложное «не совпадает» */}
      {reconciling && (
        <ReconcileSheet wallet={wallets.find((w) => w.id === reconciling.id) ?? reconciling} onClose={() => setReconciling(null)} />
      )}

      <ConfirmDialog
        open={archiving !== null}
        danger
        loading={busy}
        title={archiving ? `Убрать «${archiving.name}» в архив?` : ''}
        confirmLabel="В архив"
        message={
          archiving ? (
            <>
              <p>Кошелёк пропадёт из выбора, но все операции по нему и остаток сохранятся. Его можно вернуть из архива.</p>
              {archivingBalance !== 0 && (
                <p className="mt-2 font-medium text-warning">
                  В кошельке остаток {formatMinor(archivingBalance, archiving.currency)}: в «Всего» он учитываться не будет. Если деньги
                  переехали — сначала внесите перевод.
                </p>
              )}
            </>
          ) : undefined
        }
        onConfirm={() => archiving && void archive(archiving)}
        onCancel={() => !busy && setArchiving(null)}
      />
    </>
  );
}
