import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { MoneyText } from '@/components/MoneyText';
import { useToast } from '@/components/Toast';
import { useStore, useUpcoming, ValidationError, type UpcomingItem } from '@/db';
import type { IsoDate } from '@/domain/types';
import { useRates } from '@/rates/hooks';
import { needsFx, pickAutoRate } from '@/recurring/fx';
import { viewRule } from '@/recurring/ruleView';
import { itemKey, overdueText, whenText, widgetRows, WIDGET_DAYS } from '@/recurring/upcoming';
import { useToday } from '@/recurring/useToday';
import { PostSheet } from './PostSheet';
import { RuleIcon } from './RuleIcon';
import { useRecurringLookups, type RecurringLookups } from './useRecurringData';

function WidgetRow({
  item,
  lookups,
  today,
  busy,
  onPost,
}: {
  item: UpcomingItem;
  lookups: RecurringLookups;
  today: IsoDate;
  busy: boolean;
  onPost: () => void;
}) {
  const v = viewRule(item.rule, lookups.wallets, lookups.categories, lookups.base);
  const when = whenText(item.date, today);
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <RuleIcon view={v} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium text-text">{v.title}</p>
        <p className="truncate text-sm">
          {item.status === 'overdue' ? (
            <span className="font-semibold text-danger">{overdueText(item.date, today)}</span>
          ) : (
            <span className={item.status === 'due' ? 'font-semibold text-text' : 'text-muted'}>{when}</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <MoneyText
          minor={v.signedMinor}
          currency={v.currency}
          tone={v.tone}
          sign={v.tone === 'income' ? 'always' : 'auto'}
          className="text-base font-semibold"
        />
        <Button
          variant="ghost"
          loading={busy}
          className="-mr-3 !min-h-[44px] !px-3"
          aria-label={`Провести: ${v.title}, ${when}`}
          onClick={onPost}
        >
          Провести
        </Button>
      </div>
    </li>
  );
}

/**
 * «Ближайшие платежи» для «Главной»: просроченные и ближайшие 7 дней, до 4 строк (остальное — «Ещё N»), кнопка «Провести».
 * Если курс не нужен — платёж записывается в одно касание; если нужен (кошелёк в чужой валюте) — открывается окно, где его
 * можно ввести. Нет платежей — виджет ничего не рисует.
 */
export default function UpcomingWidget() {
  const store = useStore();
  const toast = useToast();
  const { getRate } = useRates();
  const today = useToday();
  const items = useUpcoming(WIDGET_DAYS, { today });
  const lookups = useRecurringLookups();
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const [posting, setPosting] = useState<{ ruleId: string; date: IsoDate } | null>(null);

  if (!items || !lookups) return null;
  const { rows, more } = widgetRows(items, today);
  if (rows.length === 0) return null;

  const post = async (item: UpcomingItem) => {
    const key = itemKey(item);
    if (busyRef.current.has(key)) return;
    const wallet = lookups.wallets.get(item.rule.walletId);
    const toWallet = item.rule.toWalletId === null ? undefined : lookups.wallets.get(item.rule.toWalletId);
    let fx: { rate: number; source: string } | undefined;
    if (wallet && needsFx(item.rule, wallet, toWallet, lookups.base)) {
      // Курс нужен: в одно касание можно, только если он надёжный (свежий или «Свой курс»). Иначе — окно, где курс виден и его можно ввести.
      const pick = pickAutoRate(getRate(wallet.currency, lookups.base));
      if (!pick.ok) {
        setPosting({ ruleId: item.rule.id, date: item.date });
        return;
      }
      fx = pick.fx;
    }
    busyRef.current.add(key);
    setBusyKeys(new Set(busyRef.current));
    try {
      const tx = await store.transactions.createFromRule(item.rule.id, item.date, fx ? { fx } : {});
      if (tx.deletedAt !== null) {
        toast.error('Этот платёж уже пропущен или удалён. Верните его в разделе «Регулярные платежи».');
      } else {
        toast.success(`Платёж проведён: ${viewRule(item.rule, lookups.wallets, lookups.categories, lookups.base).title}`);
      }
    } catch (e) {
      if (e instanceof ValidationError) toast.error(e.message);
      else {
        console.error('Не удалось провести платёж:', e);
        toast.error('Не удалось провести платёж. Данные не изменены — попробуйте ещё раз.');
      }
    } finally {
      busyRef.current.delete(key);
      setBusyKeys(new Set(busyRef.current));
    }
  };

  const postingRule = posting ? items.find((i) => i.rule.id === posting.ruleId)?.rule : undefined;

  return (
    <section aria-labelledby="home-upcoming">
      <div className="-mb-1 -mt-1 flex items-center justify-between gap-3 px-1">
        <h2 id="home-upcoming" className="text-lg font-bold">
          Ближайшие платежи
        </h2>
        <Link to="/recurring" className="inline-flex min-h-[44px] shrink-0 items-center text-base font-semibold text-brand">
          Все платежи
        </Link>
      </div>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {rows.map((item) => (
            <WidgetRow
              key={itemKey(item)}
              item={item}
              lookups={lookups}
              today={today}
              busy={busyKeys.has(itemKey(item))}
              onPost={() => void post(item)}
            />
          ))}
        </ul>
        {more > 0 && (
          <Link
            to="/recurring"
            className="flex min-h-[44px] items-center justify-center border-t border-border px-4 text-base font-semibold text-brand"
          >
            Ещё {more}
          </Link>
        )}
      </Card>
      {posting && postingRule && (
        <PostSheet rule={postingRule} date={posting.date} today={today} lookups={lookups} onClose={() => setPosting(null)} />
      )}
    </section>
  );
}
