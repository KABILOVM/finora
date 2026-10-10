import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
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

/** Заметная, но не навязчивая плашка локального режима. */
export function LocalModeBanner() {
  return (
    <Card role="note" className="mb-4 flex items-start gap-3 border-warning/40 bg-warning/5" data-testid="local-mode-banner">
      <Icon name="info" size={22} className="mt-0.5 shrink-0 text-warning" />
      <p className="min-w-0 text-base">
        <strong className="font-semibold">Облако не подключено:</strong> данные хранятся только на этом устройстве.
        Делайте резервную копию.
      </p>
    </Card>
  );
}
