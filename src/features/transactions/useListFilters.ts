import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { IsoDate } from '@/domain/types';
import { defaultFilters, filtersFromParams, filtersToParams, useDebounced, type ListFilters } from './txFilters';

export const SEARCH_DELAY_MS = 300;
const MAX_SEARCH = 100;

export interface UseListFilters {
  /** Всё, что видно на экране; поиск — ровно то, что набрано. */
  filters: ListFilters;
  /** Набранное в поиске после паузы в наборе: по нему считается список. */
  search: string;
  change: (patch: Partial<ListFilters>) => void;
  /** «Показать всё»: весь срок, остальное выключено. */
  showAll: () => void;
}

/**
 * Фильтры списка операций. Период, кошелёк, вид и категория живут в адресе (`?period=…&wallet=…`): так их не теряет возврат на
 * страницу «Назад», а ссылки с других экранов открывают готовый список. Меняем адрес с replace — шаги фильтров не засоряют
 * историю. Поиск — просто набранный текст: в адрес он не пишется (идёт каждая буква, а шаг назад не должен его «стирать»).
 */
export function useListFilters(today: IsoDate): UseListFilters {
  const [params, setParams] = useSearchParams();
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed, SEARCH_DELAY_MS);
  const fromUrl = useMemo(() => ({ ...defaultFilters(today), ...filtersFromParams(params, today) }), [params, today]);
  const filters = useMemo(() => ({ ...fromUrl, search: typed }), [fromUrl, typed]);

  const change = useCallback(
    (patch: Partial<ListFilters>) => {
      const { search: nextSearch, ...rest } = patch;
      if (nextSearch !== undefined) setTyped(nextSearch.slice(0, MAX_SEARCH));
      if (Object.keys(rest).length === 0) return;
      setParams(filtersToParams({ ...fromUrl, ...rest }), { replace: true });
    },
    [fromUrl, setParams],
  );

  const showAll = useCallback(() => {
    setTyped('');
    setParams(filtersToParams({ ...defaultFilters(today), period: 'all' }), { replace: true });
  }, [setParams, today]);

  return { filters, search, change, showAll };
}
