import { useLiveQuery } from 'dexie-react-hooks';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { defaultId, useOptionalStore, type Store } from '@/db';
import { decide, doneProgress, initialProgress, type DataSnapshot } from './onboardingLogic';
import { useOnboardingProgress } from './onboardingStorage';

const OnboardingWizard = lazy(() => import('./OnboardingWizard'));

/** Снимок данных, по которому решаем, новый ли это человек. Обновляется сам при любой записи в базу. */
async function readSnapshot(store: Store): Promise<DataSnapshot> {
  const { db } = store;
  const [settings, wallets, txCount, budgets, debts, rules] = await Promise.all([
    store.settings.get(),
    db.wallets.toArray(),
    db.transactions.count(),
    db.budgets.filter((b) => b.deletedAt === null).count(),
    db.debts.filter((d) => d.deletedAt === null).count(),
    db.recurring_rules.filter((r) => r.deletedAt === null).count(),
  ]);
  return {
    settingsReady: settings !== null,
    wallets: wallets.map((w) => ({
      id: w.id,
      name: w.name,
      kind: w.kind,
      currency: w.currency,
      openingBalanceMinor: w.openingBalanceMinor,
      createdAt: w.createdAt,
      clientUpdatedAt: w.clientUpdatedAt,
      deletedAt: w.deletedAt,
      archivedAt: w.archivedAt,
    })),
    hasTransactions: txCount > 0,
    hasPlans: budgets + debts + rules > 0,
  };
}

/** Мастер виден только на «Главной»: адреса вроде /add, /import, /settings работают как обычно. */
const WIZARD_PATH = '/';

function Gate({ store }: { store: Store }) {
  const { pathname } = useLocation();
  const [progress, update] = useOnboardingProgress(store.userId);
  const snap = useLiveQuery(() => readSnapshot(store), [store]);
  const [seedId, setSeedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void defaultId(store.userId, 'wallet:cash').then((id) => {
      if (alive) setSeedId(id);
    });
    return () => {
      alive = false;
    };
  }, [store.userId]);

  const decision = decide(progress, snap, seedId);

  // Показывать не нужно, и это запоминаем: старый аккаунт, перенос состоялся, у человека уже есть операции.
  useEffect(() => {
    if (decision === 'complete') update(() => doneProgress(false));
  }, [decision, update]);

  if (decision !== 'show' || pathname !== WIZARD_PATH) return null;
  return (
    <Suspense fallback={null}>
      <OnboardingWizard progress={progress ?? initialProgress()} update={update} />
    </Suspense>
  );
}

/**
 * Пошаговая настройка для нового человека. Ставится внутри приложения (после входа, замка и первой загрузки данных),
 * поэтому до синхронизации не мигает. Без хранилища (простые тесты экранов) ничего не рисует.
 */
export function OnboardingGate() {
  const store = useOptionalStore();
  return store ? <Gate store={store} /> : null;
}
