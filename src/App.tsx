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
import { getDefaultClient } from '@/auth/supabaseClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/Toast';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { AppShell } from '@/layout/AppShell';
import { ADD_PATH } from '@/layout/nav';

// Страницы подгружаются лениво: на старте грузится только каркас.
const HomePage = lazy(() => import('@/features/home/HomePage'));
const TransactionsPage = lazy(() => import('@/features/transactions/TransactionsPage'));
const WalletsPage = lazy(() => import('@/features/wallets/WalletsPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const CategoriesPage = lazy(() => import('@/features/categories/CategoriesPage'));
// Шит «Новая операция» (пока заглушка в src/layout; настоящий подключат вместо неё).
const AddTransactionSheet = lazy(() => import('@/layout/AddTransactionSheet'));
// Шит правки операции (default export с пропсами { id, onClose }).
const EditTransactionSheet = lazy(() => import('@/features/transactions/EditTransactionSheet'));

/** Шит правки открывается по адресу /edit/<id> поверх страницы, с которой его открыли (как /add). */
const EDIT_PATTERN = '/edit/:id';
const isSheetPath = (pathname: unknown): boolean =>
  typeof pathname === 'string' && (pathname === ADD_PATH || matchPath(EDIT_PATTERN, pathname) !== null);

type BackgroundState = { background?: Location } | null;

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
 * Маршруты: / /transactions /wallets /settings /settings/categories внутри каркаса (вход показывает сборка src/app),
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
  const closeAdd = () => {
    const canGoBack = navigationType === 'PUSH' || historyIndex() > 0;
    if (background && canGoBack) navigate(-1);
    else navigate('/', { replace: true });
  };

  return (
    <>
      <Routes location={pagesLocation}>
        {/* Экран входа показывает сама сборка (src/app), пока никто не вошёл; сюда попадают уже вошедшие. */}
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route element={<AppShell status={<HeaderStatus />} />}>
          <Route element={<PageNotices />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/wallets" element={<WalletsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/categories" element={<CategoriesPage />} />
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
  // Облако настраивается переменными VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY; без них — локальный режим.
  const client = useMemo(() => getDefaultClient(), []);
  return (
    <ErrorBoundary>
      <ToastProvider>
        <HashRouter>
          <AppRoot client={client}>
            <AppRoutes />
          </AppRoot>
        </HashRouter>
        <UpdatePrompt />
      </ToastProvider>
    </ErrorBoundary>
  );
}
