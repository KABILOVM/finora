import type { SupabaseClient } from '@supabase/supabase-js';
import { getDefaultClient } from '@/auth/supabaseClient';
import { MAX_AI_TEXT, normalizeAiItems, type ParsedItem } from '@/domain/shoppingAi';

export const PARSE_FUNCTION = 'parse-shopping';

/** Понятная человеку ошибка разбора списка (текст можно показывать как есть). */
export class AiListError extends Error {}

type Invoker = Pick<SupabaseClient, 'functions'>;

const statusOf = (e: unknown): number | undefined => {
  const ctx = (e as { context?: { status?: unknown } } | null)?.context;
  return typeof ctx?.status === 'number' ? ctx.status : undefined;
};

/**
 * Отправляет текст в облачную функцию parse-shopping (Gemini) и возвращает позиции списка.
 * Нужен вход в аккаунт: без облака (локальный режим) ИИ недоступен.
 */
export async function parseListWithAi(text: string, known: readonly string[], client: Invoker | null = getDefaultClient()): Promise<ParsedItem[]> {
  if (!client) throw new AiListError('Разбор списка работает после входа в аккаунт: облако в этом приложении не подключено.');
  const body = text.trim();
  if (body === '') return [];
  if (body.length > MAX_AI_TEXT) throw new AiListError(`Слишком длинный текст: не больше ${MAX_AI_TEXT} символов за раз. Разбейте список на части.`);
  let res: { data: unknown; error: unknown };
  try {
    res = (await client.functions.invoke(PARSE_FUNCTION, { body: { text: body, known: known.slice(0, 200) } })) as { data: unknown; error: unknown };
  } catch (e) {
    console.error('Разбор списка: сбой запроса', e);
    throw new AiListError('Нет связи с сервером. Проверьте интернет и повторите.');
  }
  if (res.error) {
    console.error('Разбор списка: ошибка функции', res.error);
    const st = statusOf(res.error);
    const name = (res.error as { name?: unknown }).name;
    if (name === 'FunctionsFetchError') throw new AiListError('Нет связи с сервером. Проверьте интернет и повторите.');
    if (st === 401) throw new AiListError('Войдите в аккаунт заново и повторите.');
    if (st === 404) throw new AiListError('Разбор списка ещё не установлен на сервере. Обратитесь к владельцу приложения.');
    if (st === 429) throw new AiListError('Слишком часто. Подождите минуту и повторите.');
    if (st === 500) throw new AiListError('Разбор списка не настроен на сервере (нет ключа ИИ).');
    throw new AiListError('Не получилось разобрать список. Попробуйте ещё раз.');
  }
  const data = res.data as { ok?: unknown; items?: unknown } | null;
  if (!data || data.ok !== true) throw new AiListError('Не получилось разобрать список. Попробуйте ещё раз.');
  return normalizeAiItems(data.items);
}
