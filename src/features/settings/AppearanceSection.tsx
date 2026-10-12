import { Segmented } from '@/components/Segmented';
import { useAccentPref, useThemePref, type ThemePref } from '@/theme';
import { AccentPicker } from './AccentPicker';
import { SettingsSection } from './SettingsSection';

const OPTIONS = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Авто' },
] as const satisfies readonly { value: ThemePref; label: string }[];

/** Оформление: тема и цвет акцента. Выбор хранится на этом устройстве. */
export function AppearanceSection() {
  const [pref, setPref] = useThemePref();
  const [accent, setAccent] = useAccentPref();
  return (
    <SettingsSection title="Оформление">
      <Segmented ariaLabel="Тема оформления" options={OPTIONS} value={pref} onChange={setPref} />
      <AccentPicker value={accent} onChange={setAccent} />
    </SettingsSection>
  );
}
