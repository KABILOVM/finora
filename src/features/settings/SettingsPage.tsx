import { Glyph } from '@/components/Glyph';
import { Link } from 'react-router-dom';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { version } from '../../../package.json';
import { AppearanceSection } from './AppearanceSection';
import { AccountSection } from './AccountSection';
import { BackupSection } from './BackupSection';
import { CloudCheckSection } from './CloudCheckSection';
import { CurrencySection } from './CurrencySection';
import { DataCheckSection } from './DataCheckSection';
import { InstallSection } from './InstallSection';
import { RatesSection } from './RatesSection';
import { SettingsSection } from './SettingsSection';
import { StorageSection } from './StorageSection';
import { SyncSection } from './SyncSection';

/** Настройки: аккаунт, синхронизация, проверка облака, валюта, курсы, копия, проверка данных, хранилище, установка, версия. */
export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Настройки" />

      <Card padding="none" className="mb-6">
        <Link
          to="/settings/categories"
          className="flex min-h-[56px] items-center gap-3 rounded-2xl px-4 py-2 transition-colors hover:bg-surface-2 active:bg-border/60"
        >
          <Glyph value="i:tag" color="#4f46e5" size={40} />
          <span className="min-w-0 flex-1 text-base font-medium">Категории</span>
          <Icon name="chevron" size={18} className="shrink-0 text-muted" />
        </Link>
      </Card>

      <AppearanceSection />
      <AccountSection />
      <CurrencySection />
      <BackupSection />

      {/* Технические разделы свёрнуты: в обычной жизни они не нужны, но остаются под рукой. */}
      <details className="group mb-6">
        <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-border/70 bg-surface/70 px-4 text-base font-semibold shadow-card backdrop-blur-xl [&::-webkit-details-marker]:hidden">
          Дополнительно
          <Icon name="chevron" size={18} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
        </summary>
        <div className="mt-4">
          <SyncSection />
          <RatesSection />
          <CloudCheckSection />
          <DataCheckSection />
          <StorageSection />
          <InstallSection />
        </div>
      </details>

      <SettingsSection title="О приложении">
        <p>Finora — личный учёт денег. Версия {version}.</p>
        <p className="text-xs text-muted">Иконки: Solar (CC BY 4.0), Lucide (ISC). Шрифт: Manrope (SIL OFL).</p>
      </SettingsSection>
    </>
  );
}
