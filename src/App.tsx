import { lazy, Suspense, useMemo } from 'react';
import {
  HashRouter,
  matchPath,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
  type Location,
} from 'react-router-dom';
import { AppRoot } from '@/app/AppRoot';
import { HeaderStatus } from '@/app/HeaderStatus';
import { PageNotices } from '@/app/PageNotices';
import { canRescueExport, exportLocalBackup } from '@/app/rescueExport';
import { getDefaultClient } from '@/auth/supabaseClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { runWithoutModalAnchor } from '@/components/modalHistory';
import { ToastProvider } from '@/components/Toast';
import BudgetAlerts from '@/features/budgets/BudgetAlerts';
import AutoPostRunner from '@/features/recurring/AutoPostRunner';
import { WhatsNew } from '@/features/whatsnew/WhatsNew';
import { OnboardingGate } from '@/features/onboarding/OnboardingGate';
import { InstallPrompt } from '@/install/InstallPrompt';
import PushKeeper from '@/push/PushKeeper';
import { AppShell } from '@/layout/AppShell';
import { ADD_PATH } from '@/layout/nav';

// Страницы подгружаются лениво: на старте грузится только каркас.
const HomePage = lazy(() => import('@/features/home/HomePage'));
const TransactionsPage = lazy(() => import('@/features/transactions/TransactionsPage'));
const WalletsPage = lazy(() => import('@/features/wallets/WalletsPage'));
const WalletPage = lazy(() => import('@/features/wallets/WalletPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const CategoriesPage = lazy(() => import('@/features/categories/CategoriesPage'));
const DataCheckPage = lazy(() => import('@/features/datacheck/DataCheckPage'));
const TripsPage = lazy(() => import('@/features/trips/TripsPage'));
const TemplatesPage = lazy(() => import('@/features/templates/TemplatesPage'));
const MorePage = lazy(() => import('@/features/more/MorePage'));
// Пока заглушки «Скоро»: настоящие экраны заменят содержимое этих файлов (имена и default export остаются).
const BudgetsPage = lazy(() => import('@/features/budgets/BudgetsPage'));
const AnalyticsPage = lazy(() => import('@/features/analytics/AnalyticsPage'));
const RecurringPage = lazy(() => import('@/features/recurring/RecurringPage'));
const ShoppingPage = lazy(() => import('@/features/shopping/ShoppingPage'));
const ProductsPage = lazy(() => import('@/features/products/ProductsPage'));
const DebtsPage = lazy(() => import('@/features/debts/DebtsPage'));
const DebtDetailPage = lazy(() => import('@/features/debts/DebtDetailPage'));
const PersonDebtsPage = lazy(() => import('@/features/debts/PersonDebtsPage'));
const ConverterPage = lazy(() => import('@/features/converter/ConverterPage'));
const WeatherPage = lazy(() => import('@/features/weather/WeatherPage'));
const ImportPage = lazy(() => import('@/features/import/ImportPage'));
// Шит «Новая операция» (пока заглушка в src/layout; настоящий подключат вместо неё).
const AddTransactionSheet = lazy(() => import('@/layout/AddTransactionSheet'));
// Шит правки операции (default export с пропсами { id, onClose }).
const EditTransactionSheet = lazy(() => import('@/features/transactions/EditTransactionSheet'));

/** Шит правки открывается по адресу /edit/<id> поверх страницы, с которой его открыли (как /add). */
const EDIT_PATTERN = '/edit/:id';
const isSheetPath = (pathname: unknown): boolean =>
  typeof pathname === 'string' && (pathname === ADD_PATH || matchPath(EDIT_PATTERN, pathname) !== null);

type BackgroundState = { background?: Location } | null;

/**
 * Перевод строки (\n, \r, U+2028, U+2029) в раскодированном адресе. react-router раскодирует адрес и ищет страницу
 * регуляркой, где «.» такие символы не ловит: для «#/%0a» не находился даже запасной маршрут «*», Routes рисовал
 * пустоту, и человек видел белый экран. Такой адрес мы заранее считаем непонятным и уводим на «Главную».
 */
const LINE_BREAK = /[\n\r\u2028\u2029]/;

export function hasLineBreak(pathname: unknown): boolean {
  if (typeof pathname !== 'string') return false;
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // битое кодирование (%E0%A4%A) router сам отдаёт запасному маршруту «*» — решать нам нечего
  }
  return LINE_BREAK.test(decoded);
}

/** Номер записи в истории браузера (react-router кладёт его в history.state.idx); 0 — первая запись или неизвестно. */
function historyIndex(): number {
  try {
    const idx = (window.history.state as { idx?: unknown } | null)?.idx;
    return typeof idx === 'number' && Number.isFinite(idx) ? idx : 0;
  } catch {
    return 0;
  }
}

/**
 * Маршруты (разделы — в реестре src/app/sections.ts, плюс /more): внутри каркаса (вход показывает сборка src/app),
 * /add и /edit/:id — шиты поверх страницы, с которой их открыли (при прямом заходе — поверх «Главной»).
 */
export function AppRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();

  const stateBackground = (location.state as BackgroundState)?.background;
  const background = stateBackground && !isSheetPath(stateBackground.pathname) ? stateBackground : undefined;
  const isAdd = location.pathname === ADD_PATH;
  const editId = matchPath(EDIT_PATTERN, location.pathname)?.params.id ?? null;
  const pagesLocation = isAdd || editId !== null ? (background ?? '/') : location;

  // Назад (navigate(-1)) — только если есть куда вернуться: шит открыли переходом внутри приложения (PUSH) или перед этой
  // записью в истории есть другая (history.state.idx > 0). Иначе (дубль вкладки, восстановление сессии, прямой заход,
  // state.background без предыдущей записи) «назад» ничего не закрыл бы или увёл бы из приложения — заменяем запись на «/».
  // Поверх шита может лежать запись окна (вопрос «Закрыть без сохранения?», подтверждение): сначала снимаем её, иначе шаг назад
  // съел бы её, а не запись шита (modalHistory.ts).
  const closeAdd = () => {
    const canGoBack = navigationType === 'PUSH' || historyIndex() > 0;
    runWithoutModalAnchor(() => {
      if (background && canGoBack) navigate(-1);
      else navigate('/', { replace: true });
    });
  };

  // Непонятный адрес с переводом строки: сразу на «Главную» (иначе router показал бы пустой экран)
  if (hasLineBreak(location.pathname)) return <Navigate to="/" replace />;

  return (
    <>
      <AutoPostRunner />
      <BudgetAlerts />
      <PushKeeper />
      <InstallPrompt />
      <Routes location={pagesLocation}>
        {/* Экран входа показывает сама сборка (src/app), пока никто не вошёл; сюда попадают уже вошедшие. */}
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route element={<AppShell status={<HeaderStatus />} />}>
          <Route element={<PageNotices />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/transactions/check" element={<DataCheckPage />} />
            <Route path="/transactions/templates" element={<TemplatesPage />} />
            <Route path="/wallets" element={<WalletsPage />} />
            <Route path="/wallets/:id" element={<WalletPage />} />
            <Route path="/more" element={<MorePage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/recurring" element={<RecurringPage />} />
            <Route path="/shopping" element={<ShoppingPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/debts" element={<DebtsPage />} />
            <Route path="/debts/people/:key" element={<PersonDebtsPage />} />
            <Route path="/debts/:id" element={<DebtDetailPage />} />
            <Route path="/rates" element={<ConverterPage />} />
            <Route path="/trips" element={<TripsPage />} />
            <Route path="/weather" element={<WeatherPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/categories" element={<CategoriesPage />} />
            {/* «Проверка данных» и «Шаблоны операций» переехали в «Операции»: старые адреса (закладка, ссылка) ведут туда */}
            <Route path="/settings/data-check" element={<Navigate to="/transactions/check" replace />} />
            <Route path="/settings/templates" element={<Navigate to="/transactions/templates" replace />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {isAdd && (
        <Suspense fallback={null}>
          <AddTransactionSheet onClose={closeAdd} />
        </Suspense>
      )}
      {editId !== null && editId !== '' && (
        <Suspense fallback={null}>
          <EditTransactionSheet id={editId} onClose={closeAdd} />
        </Suspense>
      )}
    </>
  );
}

export default function App() {
  // Подсказка об обновлении здесь НЕ рисуется: она одна, снаружи приложения (UpdatePromptHost в main.tsx), чтобы пережить
  // падение самого приложения.
  // Облако настраивается переменными VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY; без них — локальный режим.
  const client = useMemo(() => getDefaultClient(), []);
  return (
    // В локальном режиме записи есть только на этом устройстве: экран сбоя предлагает сохранить их копию в файл.
    <ErrorBoundary onExport={client ? undefined : exportLocalBackup} canExport={canRescueExport}>
      <ToastProvider>
        <HashRouter>
          <AppRoot client={client}>
            <AppRoutes />
            {/* Пошаговая настройка нового человека: поверх «Главной», один раз */}
            <OnboardingGate />
            {/* После обновления: один раз коротко, что изменилось */}
            <WhatsNew />
          </AppRoot>
        </HashRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}
