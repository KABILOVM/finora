import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useCategories, useSettings, useWallets } from '@/db';
import { pluralRu } from '@/lib/plural';
import type { Wants } from './onboardingLogic';
import { WizardFrame } from './WizardFrame';

export interface FinishStepProps {
  wants: Wants;
  onBack: () => void;
  onFirstOperation: () => void;
  onHome: () => void;
  onSettings: () => void;
}

/** Шаг 5: «Готово!» — краткая сводка и два выхода. */
export function FinishStep({ wants, onBack, onFirstOperation, onHome, onSettings }: FinishStepProps) {
  const settings = useSettings();
  const wallets = useWallets();
  const categories = useCategories();
  const walletCount = wallets?.length ?? 0;
  const catCount = categories?.length ?? 0;
  const later = [wants.reminders && 'напоминания', wants.lock && 'замок Face ID'].filter(Boolean) as string[];

  return (
    <WizardFrame
      step="finish"
      title="Готово!"
      lead="Всё настроено. Можно вносить первую операцию."
      footer={
        <div className="flex flex-col gap-2">
          <Button size="lg" fullWidth onClick={onFirstOperation}>
            Внести первую операцию
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onBack} className="shrink-0">
              Назад
            </Button>
            <Button variant="secondary" fullWidth onClick={onHome}>
              На главную
            </Button>
          </div>
        </div>
      }
    >
      <Card>
        <dl className="flex flex-col gap-2 text-base">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Основная валюта</dt>
            <dd className="font-semibold">{settings?.baseCurrency ?? '…'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Кошельки</dt>
            <dd className="font-semibold" data-testid="onb-wallet-count">
              {wallets ? `${walletCount} ${pluralRu(walletCount, 'кошелёк', 'кошелька', 'кошельков')}` : '…'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Категории</dt>
            <dd className="font-semibold" data-testid="onb-category-count">
              {categories ? `${catCount} ${pluralRu(catCount, 'категория', 'категории', 'категорий')}` : '…'}
            </dd>
          </div>
        </dl>
      </Card>
      {later.length > 0 && (
        <Card className="flex flex-col gap-2">
          <p className="text-base">
            Ещё включите в Настройках: <b>{later.join(' и ')}</b>.
          </p>
          <Button variant="secondary" onClick={onSettings}>
            Открыть Настройки
          </Button>
        </Card>
      )}
    </WizardFrame>
  );
}
