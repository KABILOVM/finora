import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import { copyText } from '@/features/settings/copyText';
import { version } from '../../package.json';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Что делает кнопка «Перезагрузить». По умолчанию — перезагрузка страницы (данные лежат на устройстве и не теряются). */
  onReload?: () => void;
  /**
   * Что делает кнопка «На главную». По умолчанию — адрес «#/» и перезагрузка: «Перезагрузить» открыл бы ту же страницу,
   * на которой всё упало, и человек остался бы на этом экране.
   */
  onGoHome?: () => void;
  /** Сохранить копию данных в файл в обход упавшего приложения. Нет — нет и кнопки «Сохранить копию данных». */
  onExport?: () => Promise<void>;
  /** Можно ли сейчас предложить копию (проверяется в момент сбоя, например: не включён ли замок). По умолчанию — да. */
  canExport?: () => boolean;
  /** Для журналирования ошибки (например, в локальный лог). */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
  /** Цепочка компонентов до места сбоя (из componentDidCatch) — для отчёта. */
  componentStack: string;
  /** Итог последнего действия («Отчёт скопирован», «Копия сохранена»); читается скринридером. */
  note: string;
  exporting: boolean;
}

/** Сколько строк стека и цепочки компонентов попадает в отчёт: дальше — внутренности React, они не помогают. */
const REPORT_LINES = 10;

function currentHash(): string {
  try {
    return typeof window.location.hash === 'string' ? window.location.hash : '';
  } catch {
    return '';
  }
}

/** Путь из адреса «#/debts/abc?x=1» → «/debts/abc». */
const routeOf = (hash: string): string => hash.replace(/^#/, '').split('?')[0] || '/';

/**
 * Маршрут для отчёта без личных данных: в адресе бывают id долга и операции и имя человека (/debts/people/<имя>) —
 * они заменяются на «:id».
 */
export function scrubRoute(hash: string): string {
  return routeOf(hash).replace(/^\/(debts\/people|debts|edit)\/[^/]+/, '/$1/:id');
}

/** По умолчанию «На главную»: адрес «#/» (без state — заодно забываем страницу «под» шитом) и перезагрузка. */
function goHomeAndReload(): void {
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', `${pathname}${search}#/`);
  window.location.reload();
}

const firstLines = (text: string | undefined): string =>
  (text ?? '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .slice(0, REPORT_LINES)
    .join('\n');

/** Ловит ошибки отрисовки и вместо белого экрана показывает понятное сообщение. Локальные данные не затрагивает. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null, componentStack: '', note: '', exporting: false };
  private details = createRef<HTMLDetailsElement>();
  private reportBox = createRef<HTMLPreElement>();

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Ошибка интерфейса:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? '' });
    this.props.onError?.(error, info);
  }

  private reload = () => {
    if (this.props.onReload) this.props.onReload();
    else window.location.reload();
  };

  private goHome = () => {
    if (this.props.onGoHome) this.props.onGoHome();
    else goHomeAndReload();
  };

  /** Текст отчёта: версия, страница, браузер, ошибка и где она случилась. Без записей и сумм человека. */
  private report(): string {
    const { error, componentStack } = this.state;
    const nav = typeof navigator === 'undefined' ? null : navigator;
    const lines = [
      `Sumoima ${version}`,
      `Страница: ${scrubRoute(currentHash())}`,
      `Браузер: ${nav?.userAgent ?? 'неизвестно'}`,
      `Сеть: ${nav?.onLine === false ? 'нет' : 'есть'}`,
      `Ошибка: ${error ? `${error.name}: ${error.message}` : 'неизвестно'}`,
    ];
    const stack = firstLines(error?.stack);
    if (stack) lines.push('', 'Стек:', stack);
    const components = firstLines(componentStack);
    if (components) lines.push('', 'Компоненты:', components);
    return lines.join('\n');
  }

  private copyReport = async () => {
    if (await copyText(this.report())) {
      this.setState({ note: 'Отчёт скопирован. Его можно вставить в сообщение.' });
      return;
    }
    // Буфер обмена недоступен (нет разрешения, старый браузер): раскрываем отчёт и выделяем его — останется «Копировать».
    if (this.details.current) this.details.current.open = true;
    const box = this.reportBox.current;
    try {
      if (box) window.getSelection()?.selectAllChildren(box);
    } catch {
      // выделить не получилось — текст всё равно виден
    }
    this.setState({ note: 'Скопировать не получилось: отчёт выделен ниже, скопируйте его вручную.' });
  };

  private saveCopy = async () => {
    const { onExport } = this.props;
    if (!onExport) return;
    this.setState({ exporting: true, note: '' });
    try {
      await onExport();
      this.setState({ note: 'Копия данных сохранена в файл.' });
    } catch (e) {
      console.error('Не удалось сохранить копию данных:', e);
      this.setState({ note: 'Не удалось сохранить копию. Перезагрузите приложение и сохраните её в Настройках.' });
    } finally {
      this.setState({ exporting: false });
    }
  };

  render(): ReactNode {
    const { error, note, exporting } = this.state;
    if (!error) return this.props.children;
    const { onExport, canExport } = this.props;
    // На «Главной» (или при сбое самого каркаса) «На главную» ничего бы не изменила — кнопки нет.
    const atHome = routeOf(currentHash()) === '/';
    let exportShown = false;
    try {
      exportShown = !!onExport && (canExport?.() ?? true);
    } catch {
      exportShown = false;
    }
    return (
      <div role="alert" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4">
        <EmptyState
          icon="alert"
          title="Что-то пошло не так"
          text="Ваши записи сохранены на устройстве и не пропали. Перезагрузите приложение — обычно этого достаточно."
          action={
            <div className="flex flex-col gap-2">
              <Button onClick={this.reload}>Перезагрузить</Button>
              {!atHome && (
                <Button variant="secondary" onClick={this.goHome}>
                  На главную
                </Button>
              )}
              {exportShown && (
                <Button variant="secondary" loading={exporting} onClick={() => void this.saveCopy()}>
                  Сохранить копию данных
                </Button>
              )}
              <Button variant="ghost" onClick={() => void this.copyReport()}>
                Скопировать отчёт
              </Button>
            </div>
          }
        />
        <p role="status" className="max-w-xs pb-2 text-center text-sm text-muted">
          {note}
        </p>
        <details ref={this.details} className="w-full pb-8 text-sm text-muted">
          <summary className="min-h-[44px] cursor-pointer py-2">Технические подробности</summary>
          <pre ref={this.reportBox} className="select-text whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-3">
            {this.report()}
          </pre>
        </details>
      </div>
    );
  }
}
