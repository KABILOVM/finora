import { Segmented } from '@/components/Segmented';
import { useThemePref, type ThemePref } from '@/theme';
import { SettingsSection } from './SettingsSection';

const OPTIONS = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Авто' },
] as const satisfies readonly { value: ThemePref; label: string }[];

/** Оформление: тема. Выбор хранится на этом устройстве. */
export function AppearanceSection() {
  const [pref, setPref] = useThemePref();
  return (
    <SettingsSection title="Оформление">
      <Segmented ariaLabel="Тема оформления" options={OPTIONS} value={pref} onChange={setPref} />
    </SettingsSection>
  );
}
