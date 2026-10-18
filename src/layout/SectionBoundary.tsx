import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';

/**
 * Не скачался кусок кода страницы (нет сети, после выпуска новой версии старого файла уже нет). Тексты браузеров:
 * Chrome и Firefox — «…dynamically imported module…», Safari — «Importing a module script failed», Vite — «Unable to preload CSS».
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(message);
}

/** Без сети и без service worker'а перезагрузка открыла бы страницу браузера «Нет подключения» вместо приложения. */
function reloadWouldFail(): boolean {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return false;
  return !navigator.serviceWorker?.controller;
}

function SectionError({ chunk, onRetry }: { chunk: boolean; onRetry: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [offline, setOffline] = useState(false);
  const retry = () => {
    // Сбой отрисовки: рисуем раздел заново. Сбой загрузки: React.lazy запомнил отказ до перезагрузки страницы.
    if (!chunk) return onRetry();
    if (reloadWouldFail()) return setOffline(true);
    window.location.reload();
  };
  return (
    <div role="alert" data-section-error="">
      <EmptyState
        icon="alert"
        title="Раздел не загрузился"
        text={
          chunk
            ? 'Часть приложения не скачалась. Проверьте интернет и нажмите «Повторить». Ваши записи на месте.'
            : 'В этом разделе что-то сломалось. Ваши записи на месте: можно повторить или перейти в другой раздел через меню.'
        }
        action={
          <div className="flex flex-col gap-2">
            <Button onClick={retry}>Повторить</Button>
            {pathname !== '/' && (
              <Button variant="secondary" onClick={() => navigate('/')}>
                На главную
              </Button>
            )}
          </div>
        }
      />
      {offline && <p className="pb-6 text-center text-sm text-muted">Нет интернета. Дождитесь связи и нажмите «Повторить» ещё раз.</p>}
    </div>
  );
}

/**
 * Граница одного раздела (страницы) внутри каркаса: упала или не скачалась страница — вместо неё карточка «Раздел не загрузился»,
 * а меню и шапка остаются, и можно уйти в другой раздел. Сбрасывается при переходе: каркас пересоздаёт её по адресу страницы.
 * Экран «Что-то пошло не так» на всё окно остаётся для сбоев самого каркаса и шитов.
 */
export class SectionBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Раздел не загрузился:', error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <SectionError chunk={isChunkLoadError(error)} onRetry={this.retry} />;
  }
}
