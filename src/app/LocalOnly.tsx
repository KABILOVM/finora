import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';

/**
 * Нейтральный индикатор вместо «Синхронизировано»: в локальном режиме синхронизации нет. Нажатие ведёт в «Настройки» — к резервной
 * копии (отдельной плашки «Облако не подключено» над страницей больше нет: она повторяла этот значок).
 */
export function LocalOnlyBadge() {
  return (
    <Badge tone="neutral" role="status" title="Облако не подключено: данные хранятся только на этом устройстве. Нажмите, чтобы сделать копию">
      <Link to="/settings" className="press -m-1.5 inline-flex min-h-[44px] items-center gap-1 rounded-full p-1.5">
        <Icon name="lock" size={14} />
        <span>Только на устройстве</span>
      </Link>
    </Badge>
  );
}
