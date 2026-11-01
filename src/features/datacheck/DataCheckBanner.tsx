import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useStore } from '@/db';
import { useDismissedKeys } from '@/lib/dismissedKeys';
import { pluralRu } from '@/lib/plural';
import { useToday } from '@/recurring/useToday';
import { DATACHECK_NAMESPACE, DATACHECK_PATH } from './constants';
import { openCount, openFindings, openKinds } from './dataCheck';
import { useDataCheck } from './useDataCheck';

/**
 * Плашка наверху «Операций»: «Проверка данных» и «N пунктов: дубли, без категории…». Показывается, только когда есть что проверить (то, что отмечено «Это
 * нормально», не считается — число то же, что на самом экране). Своя живая выборка за год живёт здесь, а не в списке операций: список
 * не перерисовывается из-за неё. Постоянный вход — значок в шапке «Операций», так что при чистых данных плашка просто не мешает.
 */
export function DataCheckBanner() {
  const store = useStore();
  const today = useToday();
  const state = useDataCheck(today);
  const { hidden } = useDismissedKeys(DATACHECK_NAMESPACE, store.userId);
  if (!state) return null;
  const found = openFindings(state.check, hidden);
  const count = openCount(found);
  if (count === 0) return null;
  return (
    <Link
      to={DATACHECK_PATH}
      data-testid="datacheck-banner"
      className="mb-4 flex min-h-[56px] items-center gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-2 transition-colors hover:bg-warning/15 active:bg-warning/20"
    >
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-warning/15 text-warning">
        <Icon name="alert" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium">Проверка данных</span>
        <span className="block truncate text-sm text-muted">
          {count} {pluralRu(count, 'пункт', 'пункта', 'пунктов')}: {openKinds(found).join(', ')}
        </span>
      </span>
      <Icon name="chevron" size={18} className="shrink-0 text-muted" />
    </Link>
  );
}
