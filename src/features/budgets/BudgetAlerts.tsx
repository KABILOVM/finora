import { Component, useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/Toast';
import { useOptionalStore } from '@/db';
import { crossedThresholds, type LevelMap } from '@/domain/budgetAlerts';
import { monthKey } from '@/lib/dates';
import { useToday } from '@/recurring/useToday';
import { alertMessage, summaryMessage } from './budgetAlertText';
import { useBudgetAlertsEnabled } from './budgetAlertsPref';
import { budgetLabel } from './budgetText';
import { useBudgetsData } from './useBudgetsData';

/** Сколько подсказок показываем по отдельности; больше — одна общая. */
const INDIVIDUAL_MAX = 2;
const TOAST_MS = 7000;

/** Если наблюдатель вдруг упал, приложение не должно падать вместе с ним: подсказки просто молчат. */
class Silent extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error): void {
    console.error('Подсказки о лимитах остановлены из-за ошибки:', error);
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function Engine({ onChecked }: { onChecked?: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const enabled = useBudgetAlertsEnabled();
  const data = useBudgetsData(monthKey(useToday()));
  // Уровни при прошлой проверке и месяц, за который они сняты: смена месяца начинает проверку заново (молча)
  const last = useRef<{ month: string; levels: LevelMap } | null>(null);

  useEffect(() => {
    if (!data || 'overflow' in data || !data.progress.ok) return;
    const before = last.current?.month === data.month ? last.current.levels : null;
    const { alerts, next } = crossedThresholds(before, data.progress.items);
    last.current = { month: data.month, levels: next };
    onChecked?.();
    if (!enabled || alerts.length === 0) return;
    const open = { label: 'Бюджеты', onClick: () => navigate('/budgets') };
    if (alerts.length > INDIVIDUAL_MAX) {
      toast.show(summaryMessage(alerts.length), { durationMs: TOAST_MS, action: open });
      return;
    }
    for (const a of alerts) {
      toast.show(alertMessage(a, budgetLabel(a.categoryId, data.categories).name), { tone: a.level === 'over' ? 'error' : 'info', durationMs: TOAST_MS, action: open });
    }
  }, [data, enabled]);

  return null;
}

/**
 * Невидимый компонент: когда траты поднимают лимит бюджета через 70%, 90% или 100%, показывает подсказку («Еда»: потрачено 90% лимита…).
 * Следит за данными, а не за экраном ввода, поэтому срабатывает и для платежей «Проводить само», диктовки, импорта и правок с другого
 * устройства. Выключается на экране «Бюджеты». Без хранилища (экран входа) не делает ничего.
 * onChecked — после каждой проверки уровней (нужен только тестам, чтобы дождаться первой).
 */
export default function BudgetAlerts({ onChecked }: { onChecked?: () => void } = {}) {
  const store = useOptionalStore();
  if (!store) return null;
  return (
    <Silent key={store.userId}>
      <Engine onChecked={onChecked} />
    </Silent>
  );
}
