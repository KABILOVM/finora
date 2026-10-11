import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Что делает кнопка «Перезагрузить». По умолчанию — перезагрузка страницы (данные лежат на устройстве и не теряются). */
  onReload?: () => void;
  /** Для журналирования ошибки (например, в локальный лог). */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/** Ловит ошибки отрисовки и вместо белого экрана показывает понятное сообщение. Локальные данные не затрагивает. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Ошибка интерфейса:', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private reload = () => {
    if (this.props.onReload) this.props.onReload();
    else window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4">
        <EmptyState
          icon="alert"
          title="Что-то пошло не так"
          text="Ваши записи сохранены на устройстве и не пропали. Перезагрузите приложение — обычно этого достаточно."
          action={<Button onClick={this.reload}>Перезагрузить</Button>}
        />
        <details className="w-full pb-8 text-sm text-muted">
          <summary className="min-h-[44px] cursor-pointer py-2">Подробности для разработчика</summary>
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-3">{error.message}</pre>
        </details>
      </div>
    );
  }
}
