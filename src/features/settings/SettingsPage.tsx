import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { version } from '../../../package.json';
import { AccountSection } from './AccountSection';
import { BackupSection } from './BackupSection';
import { CurrencySection } from './CurrencySection';
import { DataCheckSection } from './DataCheckSection';
import { InstallSection } from './InstallSection';
import { RatesSection } from './RatesSection';
import { SettingsSection } from './SettingsSection';
import { StorageSection } from './StorageSection';
import { SyncSection } from './SyncSection';

/** Настройки: аккаунт, синхронизация, валюта, курсы, копия, проверка, хранилище, установка, версия. */
export default function SettingsPage() {
  const { cloud } = useAuth();
  return (
    <>
      <PageHeader title="Настройки" />

      <Card padding="none" className="mb-6">
        <Link
          to="/settings/categories"
          className="flex min-h-[56px] items-center gap-3 rounded-2xl px-4 py-2 transition-colors hover:bg-surface-2 active:bg-border/60"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center text-xl" aria-hidden="true">
            🏷️
          </span>
          <span className="min-w-0 flex-1 text-base font-medium">Категории</span>
          <Icon name="chevron" size={18} className="shrink-0 text-muted" />
        </Link>
      </Card>

      <AccountSection />
      <SyncSection />
      <CurrencySection />
      <RatesSection />
      <BackupSection />
      <DataCheckSection />
      <StorageSection />
      <InstallSection />

      <SettingsSection title="О приложении">
        <p>Finora — личный учёт денег. Версия {version}.</p>
        <p className="text-sm text-muted">{cloud ? 'Режим: с облаком (данные синхронизируются).' : 'Режим: только на этом устройстве.'}</p>
      </SettingsSection>
    </>
  );
}
