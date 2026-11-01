import { useCallback, useEffect } from 'react';
import { useHideAmounts } from '@/components/hideAmounts';
import { Segmented } from '@/components/Segmented';
import { Switch } from '@/components/Switch';
import { paletteFromHex } from '@/lib/palette';
import { readCustomPalette, saveCustomAccent, useAccentPref, useCustomAccent, useThemePref, type ThemePref } from '@/theme';
import { AccentPicker } from './AccentPicker';
import { SettingsSection } from './SettingsSection';

const OPTIONS = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Авто' },
] as const satisfies readonly { value: ThemePref; label: string }[];

/** Оформление: тема и цвет акцента (готовые цвета и «Свой цвет»). Выбор хранится на этом устройстве. */
export function AppearanceSection() {
  const [pref, setPref] = useThemePref();
  const [accent, setAccent] = useAccentPref();
  const customHex = useCustomAccent();
  // Палитру «своего цвета» строит генератор (он грузится только здесь) и сохраняет вместе с цветом: основному файлу он при запуске не нужен
  const setCustomHex = useCallback((hex: string): boolean => {
    const palette = paletteFromHex(hex);
    return palette !== null && saveCustomAccent(hex, palette);
  }, []);
  // Цвет есть, а палитры для него нет (хранилище почистили частично): досчитываем, пока человек в настройках
  useEffect(() => {
    if (accent === 'custom' && customHex !== null && readCustomPalette(customHex) === null) setCustomHex(customHex);
  }, [accent, customHex, setCustomHex]);
  const { hidden, toggle } = useHideAmounts();
  return (
    <SettingsSection title="Оформление">
      <Segmented ariaLabel="Тема оформления" options={OPTIONS} value={pref} onChange={setPref} />
      <AccentPicker value={accent} onChange={setAccent} customHex={customHex} onCustomChange={setCustomHex} />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p id="hide-amounts-label" className="font-medium">
            Скрывать суммы
          </p>
          <p className="text-sm text-muted">Точки вместо цифр на всех экранах. Глаз на «Главной» делает то же. Выбор хранится на этом устройстве.</p>
        </div>
        <Switch checked={hidden} onChange={() => toggle()} labelledBy="hide-amounts-label" />
      </div>
    </SettingsSection>
  );
}
