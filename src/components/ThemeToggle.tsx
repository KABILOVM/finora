import { resolveTheme, useThemePref } from '@/theme';
import { IconButton } from './IconButton';

/** Кнопка в шапке: светлая ↔ тёмная. Значок показывает тему, на которую переключит нажатие. */
export function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useThemePref();
  const next = resolveTheme(pref) === 'dark' ? 'light' : 'dark';
  return (
    <IconButton
      icon={next === 'dark' ? 'moon' : 'sun'}
      label={next === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему'}
      onClick={() => setPref(next)}
      className={className}
    />
  );
}
