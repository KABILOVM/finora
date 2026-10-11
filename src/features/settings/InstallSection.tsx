import { SettingsSection } from './SettingsSection';

/** Как поставить Finora на телефон как обычное приложение. */
export function InstallSection() {
  return (
    <SettingsSection title="Установка на телефон">
      <div>
        <p className="font-semibold">iPhone (Safari)</p>
        <p className="text-muted">Нажмите «Поделиться» (квадрат со стрелкой) → «На экран Домой» → «Добавить».</p>
      </div>
      <div>
        <p className="font-semibold">Android (Chrome)</p>
        <p className="text-muted">Откройте меню ⋮ → «Установить приложение» или «Добавить на главный экран».</p>
      </div>
      <p className="text-sm text-muted">Установленное приложение открывается быстрее, работает без интернета и надёжнее хранит данные.</p>
    </SettingsSection>
  );
}
