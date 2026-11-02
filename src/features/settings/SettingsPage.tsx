import { useEffect, useState, type ReactNode } from 'react';
import { Glyph } from '@/components/Glyph';
import { Link, useSearchParams } from 'react-router-dom';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { RELEASES } from '@/features/whatsnew/releases';
import { WhatsNewSheet } from '@/features/whatsnew/WhatsNewSheet';
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

/** Блок настроек с адресом: `/settings?section=security` прокручивает страницу к нему. */
function Block({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={`settings-${id}`} className="scroll-mt-[calc(4rem+env(safe-area-inset-top))] md:scroll-mt-4">
      {children}
    </div>
  );
}

/** Адреса блоков в `?section=`. */
export const SETTINGS_BLOCKS = ['account', 'security', 'accounting', 'data', 'appearance', 'about'] as const;

/**
 * Настройки: только то, чем человек пользуется. Блоки по порядку: аккаунт → безопасность и уведомления → учёт (валюта, курсы,
 * категории) → данные (копия, импорт) → оформление → о приложении. Синхронизация показывается сверху только когда с ней что-то не так.
 */
export default function SettingsPage() {
  const [news, setNews] = useState(false);
  const latest = RELEASES[0];
  const [params] = useSearchParams();
  const wanted = params.get('section');
  useEffect(() => {
    if (!wanted || !(SETTINGS_BLOCKS as readonly string[]).includes(wanted)) return;
    document.getElementById(`settings-${wanted}`)?.scrollIntoView?.({ block: 'start' });
  }, [wanted]);
  return (
    <>
      <PageHeader title="Настройки" />

      <SyncProblems />

      <Block id="account">
        <AccountSection />
      </Block>

      <Block id="security">
        <AppLockSection />
        <RemindersSection />
      </Block>

      <Block id="accounting">
        <CurrencySection />
        <RatesSection />
        <Card padding="none" className="mb-6">
          <NavRow to="/settings/categories" icon="i:tag" color="#4f46e5" title="Категории" />        </Card>
      </Block>

      <Block id="data">
        <BackupSection />
        <Card padding="none" className="mb-6">
          <NavRow to="/import" icon="i:box" color="#0891b2" title="Импорт из Дзен-мани" />        </Card>
      </Block>

      <Block id="appearance">
        <AppearanceSection />
      </Block>

      <Block id="about">
        {latest && (
          <Card padding="none" className="mb-6">
            <button
              type="button"
              onClick={() => setNews(true)}
              className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-4 py-2 text-left transition-colors hover:bg-surface-2 active:bg-border/60"
            >
              <Glyph value="i:stars" color="#d97706" size={40} />
              <span className="min-w-0 flex-1 text-base font-medium">Что нового</span>
              <Icon name="chevron" size={18} className="shrink-0 text-muted" />
            </button>
          </Card>
        )}
        <p className="pb-2 text-center text-xs text-muted">
          Sumoima {version} · Иконки: Solar (CC BY 4.0), Lucide (ISC) · Шрифт: Manrope (SIL OFL)
        </p>
      </Block>

      {news && latest && <WhatsNewSheet releases={[latest]} onClose={() => setNews(false)} />}

    </>
  );
}
