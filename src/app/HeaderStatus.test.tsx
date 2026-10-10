import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@/components/testUtils';
import { SyncProvider } from '@/sync/syncContext';
import type { SyncEngineApi, SyncStatus } from '@/sync/transport';
import { HeaderStatus } from './HeaderStatus';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HeaderStatus: «Офлайн» не дублирует «Без сети»', () => {
  function engineWith(phase: SyncStatus['phase']): SyncEngineApi {
    const status: SyncStatus = { phase, pending: 2, quarantined: 0, lastSyncedAt: null, lastError: null };
    return { getStatus: () => status, subscribe: () => () => undefined, syncNow: async () => undefined, start: () => undefined, stop: () => undefined };
  }
  const setOnline = (v: boolean) => vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(v);
  const show = (engine: SyncEngineApi | null) =>
    render(
      <MemoryRouter>
        <SyncProvider engine={engine}>
          <HeaderStatus />
        </SyncProvider>
      </MemoryRouter>,
    );

  it('облако включено, движок говорит «Без сети»: один индикатор', () => {
    setOnline(false);
    show(engineWith('offline'));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Без сети');
    expect(screen.queryByText('Офлайн')).toBeNull();
  });

  it('облако включено, у устройства нет сети, а движок ещё не заметил: «Офлайн» нужен, «Синхронизировано» не врёт', () => {
    setOnline(false);
    show(engineWith('error'));
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getByText('Офлайн')).toBeInTheDocument();
  });

  it('локальный режим без сети: «Только на устройстве» и «Офлайн» рядом', () => {
    setOnline(false);
    show(null);
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getByText('Только на устройстве')).toBeInTheDocument();
    expect(screen.getByText('Офлайн')).toBeInTheDocument();
  });

  it('с сетью «Офлайн» нет', async () => {
    setOnline(true);
    show(engineWith('idle'));
    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(1));
    expect(screen.queryByText('Офлайн')).toBeNull();
  });
});
