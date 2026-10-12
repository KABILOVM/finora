import type { SupabaseClient } from '@supabase/supabase-js';
import { getDefaultClient } from '@/auth/supabaseClient';
import { MAX_AI_TEXT, normalizeAiItems, type ParsedItem } from '@/domain/shoppingAi';
import type { Recording } from './recorder';

export const PARSE_FUNCTION = 'parse-shopping';

/** Понятная человеку ошибка разбора списка (текст можно показывать как есть). */
export class AiListError extends Error {}

export type Invoker = Pick<SupabaseClient, 'functions'>;

const statusOf = (e: unknown): number | undefined => {
  const ctx = (e as { context?: { status?: unknown } } | null)?.context;
  return typeof ctx?.status === 'number' ? ctx.status : undefined;
};

/** Запись длиннее этого сервер не примет (4 000 000 знаков base64 ≈ 3 МБ). */
export const MAX_AUDIO_BYTES = 2_900_000;

export interface AiListResult {
  items: ParsedItem[];
  /** Расшифровка записи (только для голоса). */
  transcript: string;
}

/** Вызов облачной функции с ИИ; what — «списка»/«расходов» для текста ошибок. Возвращает data при ok: true. */
export async function invokeAi(
  client: Invoker | null,
  fn: string,
  body: Record<string, unknown>,
  what = 'списка',
): Promise<Record<string, unknown>> {
  if (!client) throw new AiListError(`Разбор ${what} работает после входа в аккаунт: облако в этом приложении не подключено.`);
  let res: { data: unknown; error: unknown };
  try {
    res = (await client.functions.invoke(fn, { body })) as { data: unknown; error: unknown };
  } catch (e) {
    console.error('Разбор: сбой запроса', e);
    throw new AiListError('Нет связи с сервером. Проверьте интернет и повторите.');
  }
  if (res.error) {
    console.error('Разбор: ошибка функции', res.error);
    const st = statusOf(res.error);
    const name = (res.error as { name?: unknown }).name;
    if (name === 'FunctionsFetchError') throw new AiListError('Нет связи с сервером. Проверьте интернет и повторите.');
    if (st === 401) throw new AiListError('Войдите в аккаунт заново и повторите.');
    if (st === 404) throw new AiListError(`Разбор ${what} ещё не установлен на сервере. Обратитесь к владельцу приложения.`);
    if (st === 429) throw new AiListError('Слишком часто. Подождите минуту и повторите.');
    if (st === 500) throw new AiListError(`Разбор ${what} не настроен на сервере (нет ключа ИИ).`);
    throw new AiListError(`Не получилось разобрать ${what === 'списка' ? 'список' : what}. Попробуйте ещё раз.`);
  }
  const data = res.data as Record<string, unknown> | null;
  if (!data || data.ok !== true) throw new AiListError(`Не получилось разобрать ${what === 'списка' ? 'список' : what}. Попробуйте ещё раз.`);
  return data;
}

async function call(client: Invoker | null, body: Record<string, unknown>): Promise<AiListResult> {
  const data = await invokeAi(client, PARSE_FUNCTION, body);
  return { items: normalizeAiItems(data.items), transcript: typeof data.transcript === 'string' ? data.transcript.trim() : '' };
}

/**
 * Отправляет текст в облачную функцию parse-shopping (Gemini) и возвращает позиции списка.
 * Нужен вход в аккаунт: без облака (локальный режим) ИИ недоступен.
 */
export async function parseListWithAi(
  text: string,
  known: readonly string[],
  client: Invoker | null = getDefaultClient(),
): Promise<ParsedItem[]> {
  if (!client) throw new AiListError('Разбор списка работает после входа в аккаунт: облако в этом приложении не подключено.');
  const body = text.trim();
  if (body === '') return [];
  if (body.length > MAX_AI_TEXT)
    throw new AiListError(`Слишком длинный текст: не больше ${MAX_AI_TEXT} символов за раз. Разбейте список на части.`);
  return (await call(client, { text: body, known: known.slice(0, 200) })).items;
}

export const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('read'));
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.readAsDataURL(blob);
  });

/** Отправляет запись голоса: функция сама слушает её, возвращает расшифровку и позиции. */
export async function listenToListWithAi(
  rec: Recording,
  known: readonly string[],
  client: Invoker | null = getDefaultClient(),
): Promise<AiListResult> {
  if (!client) throw new AiListError('Разбор списка работает после входа в аккаунт: облако в этом приложении не подключено.');
  if (rec.blob.size > MAX_AUDIO_BYTES) throw new AiListError('Запись слишком длинная. Продиктуйте список частями.');
  let audio: string;
  try {
    audio = await toBase64(rec.blob);
  } catch {
    throw new AiListError('Не удалось прочитать запись. Повторите.');
  }
  return call(client, { audio, mime: rec.mime, known: known.slice(0, 200) });
}
