import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Glyph } from '@/components/Glyph';
import { MoneyText } from '@/components/MoneyText';
import { Segmented } from '@/components/Segmented';
import { percentOf } from '@/domain/budgetLevels';
import type { CurrencyCode } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import type { SpendGroup } from './spendGroups';
import { walletSpendQuery } from './spendGroups';
import type { AnalyticsData } from './useAnalyticsData';

/** Сколько строк показываем сразу; остальные — по «Показать ещё». */
export const WHERE_ROWS = 8;

type By = 'note' | 'wallet' | 'tag';

const TABS = [
  { value: 'note', label: 'Заметки' },
  { value: 'wallet', label: 'Кошельки' },
  { value: 'tag', label: 'Метки' },
] as const;

const EMPTY: Record<By, string> = {
  note: 'Здесь появятся повторяющиеся траты, например «такси» или «базар»: заметка должна встретиться в месяце хотя бы дважды.',
  wallet: 'В этом месяце расходов нет.',
  tag: 'Меток пока нет. Добавьте в заметку метку, например «#Самарканд», чтобы собрать траты из разных категорий.',
};

const NOTE: Record<By, string | null> = {
  note: 'Одинаковые заметки сложены вместе; траты без заметки и единичные сюда не входят.',
  wallet: null,
  tag: 'Метки могут пересекаться: трата с двумя метками входит в обе, поэтому вместе они могут дать больше расходов месяца.',
};

export interface WhereMoneyGoesProps {
  where: AnalyticsData['where'];
  wallets: AnalyticsData['wallets'];
  base: CurrencyCode;
  /** 'ГГГГ-ММ': на него ведут строки кошельков. */
  month: string;
}

function Row({ group, by, base, totalMinor, wallets, month }: { group: SpendGroup; by: By; base: CurrencyCode; totalMinor: number } & Pick<WhereMoneyGoesProps, 'wallets' | 'month'>) {
  const share = percentOf(group.totalMinor, totalMinor);
  const wallet = by === 'wallet' ? wallets.get(group.key) : undefined;
  const body = (
    <>
      {by === 'wallet' && <Glyph value={wallet?.icon ?? '👛'} color={wallet?.color} size={32} />}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-medium">{group.label}</span>
          <span className="shrink-0 text-xs text-muted" data-testid={`where-share-${by}`}>
            {share === 0 ? '<1%' : `${share}%`}
          </span>
        </span>
        <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-pill bg-surface-2">
          <span className="block h-full rounded-pill bg-brand/70" style={{ width: `${Math.max(share, 2)}%` }} />
        </span>
        <span className="mt-0.5 block text-xs text-muted">
          {group.count} {pluralRu(group.count, 'операция', 'операции', 'операций')}
        </span>
      </span>
      <MoneyText minor={group.totalMinor} currency={base} tone="none" className="shrink-0 font-semibold" />
    </>
  );
  const cls = 'flex min-h-[56px] items-center gap-3 py-2';
  return (
    <li>
      {by === 'wallet' ? (
        // начало адреса фиксировано, из данных — только закодированный хвост (так требует статический аудит e2e/sec)
        <Link to={`/transactions?${walletSpendQuery(month, group.key)}`} className={`${cls} transition-colors hover:bg-surface-2/60`}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/**
 * «Куда уходят деньги»: расходы месяца, сложенные по заметке («такси», «базар»), по кошельку и по метке (#Самарканд). Строка кошелька — ссылка на
 * его расходы за месяц. Сначала видна первая вкладка, где что-то есть. Больше восьми строк — остальные по «Показать ещё».
 */
export function WhereMoneyGoes({ where, wallets, base, month }: WhereMoneyGoesProps) {
  const first: By = where.note.length > 0 ? 'note' : where.wallet.length > 0 ? 'wallet' : 'tag';
  const [picked, setPicked] = useState<By | null>(null);
  const [all, setAll] = useState(false);
  const by = picked ?? first;
  const groups = where[by];
  const shown = all ? groups : groups.slice(0, WHERE_ROWS);
  const rest = groups.length - WHERE_ROWS;
  // про пересечение меток — только когда меток больше одной: при единственной пояснять нечего
  const note = by === 'tag' && groups.length < 2 ? null : NOTE[by];  return (
    <>
      <Segmented
        ariaLabel="Группировка расходов"
        options={TABS}
        value={by}
        onChange={(v) => {
          setPicked(v);
          setAll(false);
        }}
        compact
        className="mb-3"
      />
      {note !== null && groups.length > 0 && <p className="mb-1 text-sm text-muted">{note}</p>}
      {groups.length === 0 ? (
        <p className="text-muted" data-testid="where-empty">
          {EMPTY[by]}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border" aria-label={`Расходы: ${TABS.find((t) => t.value === by)?.label.toLowerCase() ?? ''}`}>
          {shown.map((g) => (
            <Row key={g.key} group={g} by={by} base={base} totalMinor={where.totalMinor} wallets={wallets} month={month} />
          ))}
        </ul>
      )}
      {rest > 0 && (
        <Button variant="ghost" fullWidth className="mt-1" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Свернуть' : `Показать ещё ${rest}`}
        </Button>
      )}
    </>
  );
}
