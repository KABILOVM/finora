import type { ReactNode } from 'react';
import type { AuthUser } from '@/auth/config';

/**
 * Заглушка «замка» приложения: настоящий замок (Face ID / отпечаток) подменит содержимое. Оборачивает сеанс пользователя,
 * пока замок закрыт — закрывает экран непрозрачной заслонкой, а приложение под ней продолжает работать (синхронизация не прерывается).
 */
export function LockGate({ children }: { user: AuthUser; children?: ReactNode }) {
  return <>{children}</>;
}
