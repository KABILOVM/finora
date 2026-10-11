import { Link, useLocation } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';

/** Нейтральный индикатор вместо «Синхронизировано»: в локальном режиме синхронизации нет. */
export function LocalOnlyBadge() {
  return (
    <Badge tone="neutral" role="status" title="Облако не подключено: данные хранятся только на этом устройстве">
      <Icon name="lock" size={14} />
      <span>Только на устройстве</span>
    </Badge>
  );
}

/**
 * Плашка локального режима: ОДНА строка — что не так («Облако не подключено») и что делать («Сделать копию» → Настройки).
 * Полная фраза для скринридера и подсказки скрыта визуально. В самих «Настройках» ссылка не нужна: копия там же, ниже.
 */
export function LocalModeBanner() {
  const { pathname } = useLocation();
  const inSettings = pathname === '/settings' || pathname.startsWith('/settings/');
  return (
    <div
      role="note"
      data-testid="local-mode-banner"
      className="mb-2 flex min-h-[44px] items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 pl-3 pr-1 text-[13px] leading-tight"
    >
      <Icon name="info" size={18} className="shrink-0 text-warning" />
      <p className="min-w-0 flex-1 py-1.5">
        <strong className="font-semibold">Облако не подключено</strong>
        <span className="sr-only">: данные хранятся только на этом устройстве. Делайте резервную копию.</span>
      </p>
      {!inSettings && (
        <Link
          to="/settings"
          className="inline-flex min-h-[44px] shrink-0 items-center gap-0.5 rounded-lg px-2 font-semibold text-brand"
        >
          Сделать копию
          <Icon name="chevron" size={14} />
        </Link>
      )}
    </div>
  );
}
