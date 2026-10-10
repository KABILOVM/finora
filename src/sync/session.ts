import { TransportError, type SyncTransport } from './transport';

/**
 * Защита от «чужого токена». Движок работает с базой пользователя A, а токен для запросов supabase-js берёт из общего
 * хранилища браузера. Если в соседней вкладке вошёл другой человек (B), следующий запрос этой вкладки уйдёт с токеном B:
 * данные A окажутся в аккаунте B, а данные B — в базе A. Поэтому перед КАЖДЫМ запросом сверяем, чей сейчас токен.
 */

/** Транспорт, который умеет сказать, под чьим токеном уйдёт следующий запрос (боевой и сервер в памяти умеют). */
export interface SessionAwareTransport extends SyncTransport {
  /** id пользователя в токене. null — сессии нет. undefined — узнать нельзя (проверка пропускается). */
  currentUserId(): Promise<string | null | undefined>;
}

export const SESSION_MISMATCH_MESSAGE = 'В этом браузере вошёл другой пользователь. Данные этого устройства не отправлены';

/** В токене не тот пользователь, чья это локальная база. Повтор и обновление сессии не помогут. */
export class SessionMismatchError extends Error {
  constructor() {
    super(SESSION_MISMATCH_MESSAGE);
    this.name = 'SessionMismatchError';
  }
}

export function isSessionAware(t: SyncTransport): t is SessionAwareTransport {
  return typeof (t as Partial<SessionAwareTransport>).currentUserId === 'function';
}

/**
 * Транспорт, который перед каждым запросом убеждается, что токен принадлежит userId.
 * Нет сессии — 'auth' (как просроченный токен); чужая сессия — SessionMismatchError. Не умеет сказать — без проверки.
 */
export function guardSession(transport: SyncTransport, userId: string): SyncTransport {
  if (!isSessionAware(transport)) return transport;
  const expected = userId.toLowerCase();
  async function verify(): Promise<void> {
    const actual = await (transport as SessionAwareTransport).currentUserId();
    if (actual === undefined) return;
    if (actual === null) throw new TransportError('auth', 'Нет активной сессии');
    if (actual.toLowerCase() !== expected) throw new SessionMismatchError();
  }
  return {
    async pull(table, afterSeq, limit) {
      await verify();
      return transport.pull(table, afterSeq, limit);
    },
    async push(table, rows) {
      if (Array.isArray(rows) && rows.length === 0) return; // пустая пачка запроса не делает
      await verify();
      return transport.push(table, rows);
    },
  };
}
