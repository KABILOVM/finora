import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { Notice } from '@/components/Notice';
import { useSettings, useWallets } from '@/db';
import { currencyInfo } from '@/domain/currency';
import { formatDayInline } from '@/lib/dates';
import { EnteredRatesList } from '@/rates/EnteredRatesList';
import { enteredLabel } from '@/rates/enteredText';
import { useRates } from '@/rates/hooks';
import { ManualRateSheet } from './ManualRateSheet';
import { formatRate, rateSourceLabel } from './rateInput';
import { SettingsSection } from './SettingsSection';
import { formatDateTime } from './syncText';

/** Курсы валют: когда обновлены, откуда, обновить, задать свой курс. Показываем валюты ваших кошельков. */
export function RatesSection() {
  const toast = useToast();
  const settings = useSettings();
  const wallets = useWallets();
  const { getRate, refresh, refreshing, lastRefreshAt, lastError } = useRates();
  const [editing, setEditing] = useState<string | null>(null);

  const base = settings?.baseCurrency;
  const currencies = useMemo(() => {
    if (!base || !wallets) return [];
    return [...new Set(wallets.map((w) => w.currency))].filter((c) => c !== base).sort();
  }, [wallets, base]);

  const doRefresh = async () => {
    const result = await refresh();
    if (result.aborted) return;
    if (result.ok) {
      toast.success('Курсы обновлены');
    } else {
      const why = result.failures[0]?.message;
      toast.error(`Не удалось обновить курсы${why ? `: ${why}` : ''}. Остались прежние.`);
    }
  };

  const rows = base
    ? currencies.map((from) => ({ from, lookup: getRate(from, base) }))
    : [];
  // Все кошельки в основной валюте — курсы не нужны, раздел не показываем
  if (!base || currencies.length === 0) return null;
  const anyStale = rows.some((r) => r.lookup?.stale);

  return (
    <SettingsSection title="Курсы валют">
      <p className="text-sm text-muted">Обновлены: {lastRefreshAt ? formatDateTime(lastRefreshAt) : 'ещё нет'}</p>
      {lastError && (
        <p className="text-sm text-warning">
          Последняя попытка не удалась: {lastError}
        </p>
      )}
      {anyStale && (
        <Notice tone="warning" role="note">
          Курс устарел. Обновите курсы или задайте свой.
        </Notice>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-border">
          {rows.map(({ from, lookup }) => (
            <li key={from} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="font-semibold">
                  {lookup ? `1 ${from} = ${formatRate(lookup.rate)} ${currencyInfo(base).symbol}` : `${from}: курса нет`}
                </div>
                <div className={lookup?.stale ? 'text-sm text-warning' : 'text-sm text-muted'}>
                  {lookup
                    ? lookup.entered
                      ? `${enteredLabel(lookup.asOf)} · в операции`
                      : `${rateSourceLabel(lookup.source)} · на ${formatDayInline(lookup.asOf)}${lookup.stale ? ' · устарел' : ''}`
                    : 'Обновите или задайте свой — иначе кошелёк не войдёт в «Всего»'}
                </div>
              </div>
              <Button variant="secondary" aria-label={`Свой курс ${from}`} onClick={() => setEditing(from)}>
                Свой курс
              </Button>
            </li>
          ))}
        </ul>
      )}

      <EnteredRatesList />

      <Button variant="secondary" icon="refresh" loading={refreshing} onClick={() => void doRefresh()}>
        Обновить курсы
      </Button>

      {editing && base && (
        <ManualRateSheet from={editing} to={base} current={getRate(editing, base)} onClose={() => setEditing(null)} />
      )}
    </SettingsSection>
  );
}
