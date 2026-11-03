import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Icon } from '@/components/Icon';
import { setSkinIconPack, skinIconMarkup } from '@/components/skinIconStore';
import { render, waitFor } from '@/components/testUtils';
import { applySkin } from '../theme';

// Файлы наборов не загружаются: нет сети, а в кеше браузера их нет (в офлайн-кэш приложения они намеренно не входят).
vi.mock('./registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./registry')>()),
  loadPackGroup: () => Promise.reject(new Error('нет сети')),
}));

const reset = () => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-skin');
  setSkinIconPack(null, null);
};
beforeEach(reset);
afterEach(reset);

describe('набор значков не загрузился', () => {
  it('значки остаются обычными, а набор прежнего образа не остаётся под новым', async () => {
    setSkinIconPack({ home: '<svg viewBox="0 0 24 24"><path d="M0 0h1"/></svg>' }, 'прежний-образ');
    const { container } = render(<Icon name="home" />);
    expect(container.querySelector('svg svg')).not.toBeNull();
    applySkin('shinobi'); // набор Anime не придёт
    await waitFor(() => expect(skinIconMarkup('home')).toBeNull());
    expect(container.querySelector('svg svg')).toBeNull();
    expect(document.documentElement.getAttribute('data-skin')).toBe('shinobi'); // сам образ (цвета) применён
  });
});
