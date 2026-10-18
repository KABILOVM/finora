import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@/components/testUtils';
import SettingsPage, { SETTINGS_BLOCKS } from './SettingsPage';

vi.mock('./AccountSection', () => ({ AccountSection: () => <p>account</p> }));
vi.mock('./AppLockSection', () => ({ AppLockSection: () => <p>lock</p> }));
vi.mock('./RemindersSection', () => ({ RemindersSection: () => <p>reminders</p> }));
vi.mock('./CurrencySection', () => ({ CurrencySection: () => <p>currency</p> }));
vi.mock('./RatesSection', () => ({ RatesSection: () => <p>rates</p> }));
vi.mock('./BackupSection', () => ({ BackupSection: () => <p>backup</p> }));
vi.mock('./AppearanceSection', () => ({ AppearanceSection: () => <p>appearance</p> }));
vi.mock('./SyncSection', () => ({ SyncSection: () => <p>sync</p> }));
vi.mock('@/sync/syncContext', () => ({
  useSyncEnabled: () => false,
  useSyncStatus: () => ({ quarantined: 0, phase: 'idle' }),
}));

afterEach(() => vi.restoreAllMocks());

const open = (query: string) =>
  render(
    <MemoryRouter initialEntries={[`/settings${query}`]}>
      <SettingsPage />
    </MemoryRouter>,
  );

describe('Настройки: блоки и адрес ?section=', () => {
  it('блоки идут по порядку: аккаунт, безопасность, учёт, данные, оформление, о приложении', () => {
    open('');
    const ids = Array.from(document.querySelectorAll('[id^="settings-"]')).map((el) => el.id.replace('settings-', ''));
    expect(ids).toEqual([...SETTINGS_BLOCKS]);
  });

  it('?section=security прокручивает к своему блоку', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    open('?section=security');
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('settings-security'));
  });

  it('неизвестный блок и отсутствие параметра ничего не прокручивают', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    open('?section=нет-такого');
    open('');
    expect(scroll).not.toHaveBeenCalled();
  });
});
