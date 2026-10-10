import { lazy, Suspense } from 'react';
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
  type Location,
} from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { OnlineBadge } from '@/components/OnlineBadge';
import { ToastProvider } from '@/components/Toast';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { AppShell, PageFallback } from '@/layout/AppShell';
import { ADD_PATH } from '@/layout/nav';

// Страницы подгружаются лениво: на старте грузится только каркас.
const HomePage = lazy(() => import('@/features/home/HomePage'));
const TransactionsPage = lazy(() => import('@/features/transactions/TransactionsPage'));
const WalletsPage = lazy(() => import('@/features/wallets/WalletsPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
// Шит «Новая операция» (пока заглушка в src/layout; настоящий подключат вместо неё).
const AddTransactionSheet = lazy(() => import('@/layout/AddTransactionSheet'));

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
 * Маршруты: / /transactions /wallets /settings внутри каркаса, /login без каркаса,
 * /add — шит поверх страницы, с которой его открыли (при прямом заходе — поверх «Главной»).
 */
export function AppRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();

  const stateBackground = (location.state as BackgroundState)?.background;
  const background = stateBackground && stateBackground.pathname !== ADD_PATH ? stateBackground : undefined;
  const isAdd = location.pathname === ADD_PATH;
  const pagesLocation = isAdd ? (background ?? '/') : location;

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
        <Route
          path="/login"
          element={
            <Suspense fallback={<PageFallback />}>
              <LoginPage />
            </Suspense>
          }
        />
        <Route element={<AppShell status={<OnlineBadge hideWhenOnline />} />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/wallets" element={<WalletsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {isAdd && (
        <Suspense fallback={null}>
          <AddTransactionSheet onClose={closeAdd} />
        </Suspense>
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
        <UpdatePrompt />
      </ToastProvider>
    </ErrorBoundary>
  );
}
