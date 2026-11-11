import { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useHideAmounts } from '@/components/hideAmounts';
import { Icon } from '@/components/Icon';
import { Segmented } from '@/components/Segmented';
import { Switch } from '@/components/Switch';
import { readActiveCustomSkin } from '@/customSkin';
import { paletteFromHex } from '@/lib/palette';
import { CUSTOM_SKIN, isBaseSkin } from '@/skinCore';
import { skinById } from '@/skins';
import { SKIN_THUMBS } from '@/skinThumbs';
import { readCustomPalette, saveCustomAccent, useAccentPref, useCustomAccent, useFxPref, useSkinPref, useThemePref, type ThemePref } from '@/theme';
import { AccentPicker } from './AccentPicker';
import { SettingsSection } from './SettingsSection';

const OPTIONS = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Авто' },
] as const satisfies readonly { value: ThemePref; label: string }[];

/**
 * Оформление: тема, образ (строка ведёт на витрину образов), цвет акцента (готовые цвета и «Свой цвет»), живой фон и скрытие сумм.
 * Цвет акцента виден только у «Классики» и «Классики (прежней)»: остальные образы задают цвета сами.
 */
export function AppearanceSection() {
  const [pref, setPref] = useThemePref();
  const [accent, setAccent] = useAccentPref();
  const [skin] = useSkinPref();
  const [fx, setFx] = useFxPref();
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
  // у своего образа название хранится вместе с ним, значка-картинки у него нет
  const skinLabel = skin === CUSTOM_SKIN ? (readActiveCustomSkin()?.name ?? 'Свой образ') : (skinById(skin)?.label ?? 'Классика');
  const thumb = skin === CUSTOM_SKIN ? undefined : SKIN_THUMBS[skin];
  return (
    <SettingsSection title="Оформление">
      <Segmented ariaLabel="Тема оформления" options={OPTIONS} value={pref} onChange={setPref} />
      <Link
        to="/settings/skins"
        data-testid="skin-current"
        aria-label={`Образ: ${skinLabel}. Выбрать другой`}
        className="press flex min-h-[72px] items-center gap-3 rounded-2xl border border-border bg-surface-2/50 p-3 transition-colors hover:bg-surface-2"
      >
        {thumb !== undefined ? (
          // картинки образов в офлайн-кэш не входят: значок грузится, только когда до него долистали (без сети страница открывается без ошибок)
          <img src={thumb} alt="" width={48} height={48} loading="lazy" decoding="async" className="h-12 w-12 shrink-0 rounded-xl border border-border bg-surface-2 object-contain p-0.5" />
        ) : (
          <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-accent text-brand-fg">
            <Icon name="stars" size={24} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-muted">Образ</span>
          <span className="block truncate font-semibold text-text">{skinLabel}</span>
          <span className="block text-sm text-muted">Все образы, поиск и свой образ</span>
        </span>
        <Icon name="chevron" size={18} className="shrink-0 text-muted" />
      </Link>
      {isBaseSkin(skin) ? (
        <AccentPicker value={accent} onChange={setAccent} customHex={customHex} onCustomChange={setCustomHex} />
      ) : (
        <p data-testid="skin-colors-note" className="text-sm text-muted">
          Цвета задаёт образ «{skinLabel}». Выбранный цвет акцента сохранён и вернётся с образом «Классика».
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p id="fx-label" className="font-medium">
            Живой фон и эффекты
          </p>
          <p className="text-sm text-muted">Снег, лепестки, огни и другие украшения образов. Выключите, если отвлекают или телефон греется.</p>
        </div>
        <Switch checked={fx} onChange={() => setFx(!fx)} labelledBy="fx-label" />
      </div>
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
