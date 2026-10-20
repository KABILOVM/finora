import { Glyph } from '@/components/Glyph';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { IconButton } from '@/components/IconButton';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { MoneyText } from '@/components/MoneyText';
import { Notice } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { BALANCES_OVERFLOW_MESSAGE, useBalancesState, useRecurringRules, useSettings, useStore, useWallets } from '@/db';
import { addMinor, formatMinor } from '@/domain/money';
import type { CurrencyCode, LocalRow, Minor, Wallet } from '@/domain/types';
import { walletOpsQuery } from '@/features/transactions/txFilters';
import { formatDayInline } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { enteredNote } from '@/rates/enteredText';
import { useRates } from '@/rates/hooks';
import { GoalLine } from './GoalLine';
import { ReconcileSheet } from './ReconcileSheet';
import { computeWalletsTotal } from './walletTotals';
import { WALLET_KIND_LABELS } from './walletUi';
import { useGoals } from './useGoals';
import { WalletSheet } from './WalletSheet';

/** «Интернет, Свет и ещё 2»: до трёх названий регулярных платежей, остальные числом. */
function rulesList(rules: readonly { note: string }[]): string {
  const names = rules.slice(0, 3).map((r) => (r.note.trim() === '' ? 'без названия' : r.note.trim()));
  const rest = rules.length - names.length;
  return rest > 0 ? `${names.join(', ')} и ещё ${rest}` : names.join(', ');
}

type SheetState = { kind: 'new' } | { kind: 'edit'; wallet: LocalRow<Wallet> };

function WalletIcon({ wallet }: { wallet: Wallet }) {
  return <Glyph value={wallet.icon} color={wallet.color} size={40} />;
}

/** Кошельки: остатки в их валюте, итог «Всего» в базовой, создание и правка, архив, сверка. */
export default function WalletsPage() {
  const store = useStore();
  const toast = useToast();
  const wallets = useWallets({ includeArchived: true });
  const balancesState = useBalancesState();
  const balances = balancesState?.ok ? balancesState.balances : undefined;
  const settings = useSettings();
  const rules = useRecurringRules();
  const [params, setParams] = useSearchParams();
  const { getRate } = useRates();
  const goals = useGoals();

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [reconciling, setReconciling] = useState<LocalRow<Wallet> | null>(null);
  const [archiving, setArchiving] = useState<LocalRow<Wallet> | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const active = useMemo(() => (wallets ?? []).filter((w) => w.archivedAt === null), [wallets]);
  const archived = useMemo(() => (wallets ?? []).filter((w) => w.archivedAt !== null), [wallets]);
  const base = settings?.baseCurrency;

  const goalById = useMemo(() => new Map((goals ?? []).map((g) => [g.wallet.id, g])), [goals]);

  const total = useMemo(
    () => (base && balances ? computeWalletsTotal(active, balances, base, getRate) : undefined),
    [active, balances, base, getRate],
  );
  // Остатки по валютам (активные кошельки): «TJS 3 500 с. · USD 120 $» — видно, из чего сложилось «Всего»
  const byCurrency = useMemo(() => {
    if (!balances) return [];
    const sums = new Map<CurrencyCode, Minor>();
    try {
      for (const w of active) sums.set(w.currency, addMinor(sums.get(w.currency) ?? 0, balances.get(w.id) ?? 0));
    } catch (e) {
      if (e instanceof RangeError) return [];
      throw e;
    }
    return [...sums.entries()];
  }, [active, balances]);
  // Остаток в архиве: фразу «в итог не входят» показываем, только когда там есть что не учесть
  const archivedHasMoney = !!balances && archived.some((w) => (balances.get(w.id) ?? 0) !== 0);
  // Регулярные платежи, привязанные к кошельку в архивной очереди: после архивации они перестанут проводиться
  const archivingRules = useMemo(
    () => (archiving && rules ? rules.filter((r) => r.walletId === archiving.id || r.toWalletId === archiving.id) : []),
    [archiving, rules],
  );

  // Ссылка «Создать кошелёк» (/wallets?new=1) открывает форму сразу; параметр убираем, чтобы «Назад» и обновление её не открывали снова
  const wantsNew = params.get('new') === '1';
  const canAdd = !!base && wallets !== undefined;
  useEffect(() => {
    if (!wantsNew || !canAdd) return;
    setSheet({ kind: 'new' });
    setParams({}, { replace: true });
  }, [wantsNew, canAdd, setParams]);

  if (wallets === undefined || balancesState === undefined || settings === undefined) {
    return (
      <>
        <PageHeader title="Кошельки" />
        <div role="status" aria-busy="true">
          <span className="sr-only">Загрузка…</span>
          <div aria-hidden="true" className="flex flex-col gap-4">
            <Skeleton className="h-28 !rounded-card" />
            <Skeleton className="h-52 !rounded-card" />
          </div>
        </div>
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

  const balanceOf = (w: Wallet): Minor => balances?.get(w.id) ?? 0;
  const archivingBalance = archiving ? balanceOf(archiving) : 0;
  const overflow = balancesState.ok === false;

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

      {overflow && (
        <Notice tone="danger" className="mb-4">
          {BALANCES_OVERFLOW_MESSAGE}. Откройте операции кошелька: среди них есть слишком большая сумма.
        </Notice>
      )}

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
              {byCurrency.length > 1 && (
                <p className="mt-1 text-sm text-muted" data-testid="wallets-by-currency">
                  {byCurrency.map(([currency, minor]) => formatMinor(minor, currency)).join(' · ')}
                </p>
              )}
              {total.approximate && total.viaOtherRates && (
                <p className="mt-1 text-sm text-muted">Итог пересчитан по курсам и поэтому приблизительный.</p>
              )}
              {total.entered.length > 0 && (
                <p className="mt-1 text-sm text-muted" data-testid="wallets-total-entered">
                  {enteredNote(total.entered)} Итог приблизительный.
                </p>
              )}
              {total.stale.length > 0 && (
                <Notice tone="warning" role="alert" className="mt-2">
                  Курс устарел: {total.stale.map((s) => `${s.currency} (от ${formatDayInline(s.asOf)})`).join(', ')}. Обновите курсы в
                  Настройках.
                </Notice>
              )}
              {total.missing.length > 0 && (
                <Notice tone="warning" role="alert" className="mt-2">
                  Нет курса, в итог не вошли: {total.missing.join(', ')}. Задайте курс в Настройках.
                </Notice>
              )}
              {archivedHasMoney && <p className="mt-1 text-sm text-muted">Архивные кошельки в итог не входят.</p>}
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
              const goal = goalById.get(w.id);
              return (
                <li key={w.id}>
                  <div className="flex items-center pr-2">
                    {/* вся строка — ссылка на историю кошелька (период «Всё время»), правка — отдельная кнопка-карандаш */}
                    <ListRow
                      className="min-w-0 flex-1"
                      to={`/transactions?${walletOpsQuery(w.id)}`}
                      leading={<WalletIcon wallet={w} />}
                      title={w.name}
                      subtitle={`${WALLET_KIND_LABELS[w.kind]} · ${w.currency}`}
                      trailing={
                        overflow ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <MoneyText minor={bal} currency={w.currency} tone={bal < 0 ? 'expense' : 'none'} className="font-semibold" />
                        )
                      }
                    />
                    <IconButton icon="edit" label={`Изменить: ${w.name}`} onClick={() => setSheet({ kind: 'edit', wallet: w })} />
                  </div>
                  {goal && <GoalLine item={goal} />}
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
          onReconcile={
            sheet.kind === 'edit'
              ? () => {
                  setReconciling(sheet.wallet);
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
              {archivingRules.length > 0 && (
                <p className="mt-2 font-medium text-warning">
                  К кошельку привязаны регулярные платежи: {rulesList(archivingRules)}. После архивации они перестанут проводиться — перенесите
                  их на другой кошелёк в «Регулярных платежах» или уберите в архив.
                </p>
              )}
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
