import type { SupabaseClient } from '@supabase/supabase-js';
import { getDefaultClient } from './supabaseClient';

export const DELETE_ACCOUNT_FUNCTION = 'delete-account';

/**
 * Показывать ли «Удалить аккаунт…» в настройках. ВЫКЛЮЧЕНО: проект Supabase общий с другим приложением (ERP), а функция удаляет
 * пользователя из общей таблицы входа — вместе с каскадом его профилей в ERP. Включать только после переезда Sumoima в отдельный проект.
 */
export const ACCOUNT_DELETION_ENABLED = false;

type Invoker = Pick<SupabaseClient, 'functions'>;

const statusOf = (e: unknown): number | undefined => {
  const ctx = (e as { context?: { status?: unknown } } | null)?.context;
  return typeof ctx?.status === 'number' ? ctx.status : undefined;
};

/** Ошибка удаления аккаунта: текст можно показывать человеку как есть. */
export class DeleteAccountError extends Error {}

/**
 * Просит сервер удалить аккаунт и все его данные в облаке (Edge Function «delete-account»). Почту нужно прислать ту же, что у аккаунта.
 * Успех — функция вернула ok: true; дальше вызывающий выходит из аккаунта и стирает данные устройства.
 */
export async function deleteAccountOnServer(confirmEmail: string, client: Invoker | null = getDefaultClient()): Promise<void> {
  if (!client) throw new DeleteAccountError('Аккаунт есть только в облачном режиме: здесь удалять нечего.');
  let res: { data: unknown; error: unknown };
  try {
    res = (await client.functions.invoke(DELETE_ACCOUNT_FUNCTION, { body: { confirmEmail } })) as { data: unknown; error: unknown };
  } catch {
    throw new DeleteAccountError('Нет связи с сервером. Проверьте интернет и повторите.');
  }
  if (res.error) {
    const st = statusOf(res.error);
    if ((res.error as { name?: unknown }).name === 'FunctionsFetchError') throw new DeleteAccountError('Нет связи с сервером. Проверьте интернет и повторите.');
    if (st === 401) throw new DeleteAccountError('Войдите в аккаунт заново и повторите.');
    if (st === 400) throw new DeleteAccountError('Почта не совпала с почтой аккаунта.');
    if (st === 404) throw new DeleteAccountError('Удаление аккаунта ещё не установлено на сервере: владельцу приложения нужно развернуть функцию delete-account. Ничего не удалено.');
    if (st === 500) throw new DeleteAccountError('Удаление аккаунта не настроено на сервере. Ничего не удалено.');
    throw new DeleteAccountError('Не получилось удалить аккаунт. Ничего не удалено, попробуйте ещё раз.');
  }
  const data = res.data as { ok?: unknown } | null;
  if (!data || data.ok !== true) throw new DeleteAccountError('Не получилось удалить аккаунт. Ничего не удалено, попробуйте ещё раз.');
}
