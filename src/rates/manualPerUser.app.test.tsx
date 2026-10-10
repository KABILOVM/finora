import { describe, expect, it } from 'vitest';
import { ALICE, BOB, fakeAuthClient, makeTestDeps, renderAppRoot } from '@/app/testkit';
import { screen, user, waitFor } from '@/components/testUtils';
import { useRateService, useRates } from './hooks';
import { createRateService } from './service';
import { createMemoryRateStorage } from './storage';

/**
 * Сквозная проверка на настоящей сборке приложения (AppRoot → сеанс пользователя → курсы): на общем телефоне
 * ручной курс Алисы не становится курсом Боба. Хранилище курсов общее на устройство, сервис создаётся на каждый сеанс заново.
 */

function Probe() {
  const { getRate } = useRates();
  const service = useRateService();
  const hit = getRate('USD', 'TJS');
  return (
    <div>
      <p role="status" aria-label="Курс USD">{hit ? `${hit.rate} ${hit.manual ? 'ручной' : 'сеть'}` : 'курса нет'}</p>
      <button type="button" onClick={() => service.setManualRate('USD', 'TJS', 11)}>
        Задать 11
      </button>
      <button type="button" onClick={() => service.clearManualRate('USD', 'TJS')}>
        Убрать
      </button>
    </div>
  );
}

async function openAs(account: typeof ALICE, shared: ReturnType<typeof createMemoryRateStorage>) {
  const td = makeTestDeps();
  td.deps.createRates = () => createRateService({ providers: [], storage: shared });
  const view = renderAppRoot(<Probe />, { client: fakeAuthClient({ session: account }).client, deps: td.deps });
  await waitFor(() => expect(screen.getByRole('status', { name: 'Курс USD' })).toBeInTheDocument());
  return view;
}

describe('ручные курсы на общем телефоне (весь путь приложения)', () => {
  it('Алиса задала курс; Боб его не видит и не затирает; Алиса видит свой после «перезагрузки»', async () => {
    const shared = createMemoryRateStorage();

    const alice = await openAs(ALICE, shared);
    expect(screen.getByRole('status', { name: 'Курс USD' })).toHaveTextContent('курса нет');
    await user.click(screen.getByRole('button', { name: 'Задать 11' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Курс USD' })).toHaveTextContent('11 ручной'));
    alice.unmount();

    const bob = await openAs(BOB, shared);
    expect(screen.getByRole('status', { name: 'Курс USD' })).toHaveTextContent('курса нет');
    await user.click(screen.getByRole('button', { name: 'Убрать' })); // Боб «убирает» курс, которого у него нет
    expect(screen.getByRole('status', { name: 'Курс USD' })).toHaveTextContent('курса нет');
    bob.unmount();

    const alice2 = await openAs(ALICE, shared);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Курс USD' })).toHaveTextContent('11 ручной'));
    alice2.unmount();
  });

  it('старый общий ручной курс достаётся тому, кто открыл приложение первым после обновления', async () => {
    const shared = createMemoryRateStorage({
      v: 1,
      tables: [],
      manual: { 'USD>TJS': { rate: 10.5, setAt: '2026-10-01T08:00:00.000Z' } },
      lastRefreshAt: null,
      lastAttemptAt: null,
      lastError: null,
    });
    const bob = await openAs(BOB, shared);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Курс USD' })).toHaveTextContent('10.5 ручной'));
    bob.unmount();
    const alice = await openAs(ALICE, shared);
    expect(screen.getByRole('status', { name: 'Курс USD' })).toHaveTextContent('курса нет');
    alice.unmount();
  });
});
