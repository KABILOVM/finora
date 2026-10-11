import { Glyph } from '@/components/Glyph';
import { Link } from 'react-router-dom';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { useSyncEnabled, useSyncStatus } from '@/sync/syncContext';
import { version } from '../../../package.json';
import { AppearanceSection } from './AppearanceSection';
import { AccountSection } from './AccountSection';
import { AppLockSection } from './AppLockSection';
import { BackupSection } from './BackupSection';
import { CurrencySection } from './CurrencySection';
import { RatesSection } from './RatesSection';
import { RemindersSection } from './RemindersSection';
import { SyncSection } from './SyncSection';

function NavRow({ to, icon, color, title }: { to: string; icon: string; color: string; title: string }) {
  return (
    <Link to={to} className="flex min-h-[56px] items-center gap-3 rounded-2xl px-4 py-2 transition-colors hover:bg-surface-2 active:bg-border/60">
      <Glyph value={icon} color={color} size={40} />
      <span className="min-w-0 flex-1 text-base font-medium">{title}</span>
      <Icon name="chevron" size={18} className="shrink-0 text-muted" />
    </Link>
  );
}

/** Сообщает о синхронизации только когда с ней что-то не так; в обычной жизни она идёт сама и статус виден в шапке. */
function SyncProblems() {
  const enabled = useSyncEnabled();
  const status = useSyncStatus();
  const broken = status.quarantined > 0 || status.phase === 'auth-required' || status.phase === 'error';
  return enabled && broken ? <SyncSection /> : null;
}

/** Настройки: только то, чем человек пользуется. Всё остальное (синхронизация, курсы, проверки) работает само. */
export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Настройки" />

      <Card padding="none" className="mb-6">
        <ul className="divide-y divide-border">
          <li>
            <NavRow to="/settings/categories" icon="i:tag" color="#4f46e5" title="Категории" />
          </li>
          <li>
            <NavRow to="/import" icon="i:box" color="#0891b2" title="Импорт из Zenmoney" />
          </li>
        </ul>
      </Card>

      <SyncProblems />
      <AppearanceSection />
      <CurrencySection />
      <RatesSection />
      <BackupSection />
      <AccountSection />
      <AppLockSection />
      <RemindersSection />

      <p className="pb-2 text-center text-xs text-muted">
        Finora {version} · Иконки: Solar (CC BY 4.0), Lucide (ISC) · Шрифт: Manrope (SIL OFL)
      </p>
    </>
  );
}
