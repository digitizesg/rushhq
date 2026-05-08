import { lazy, Suspense, type ComponentType } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequireRole } from "@/auth/route-guards";
import { AppShell } from "@/components/app-shell";
import { LoadingScreen } from "@/components/loading-screen";

/**
 * Wraps React.lazy with a chunk-load-error catcher. The most common
 * way this fires: a deploy ships, Vercel renames the JS chunks, and a
 * tab that's still holding the old index.html tries to import() a
 * filename that's now 404. Without this, the page goes blank and the
 * user has to manually reload. With this, we reload for them once.
 *
 * A sessionStorage guard prevents an infinite reload loop if the
 * import is genuinely broken (e.g. the developer deleted the file).
 */
function lazyWithReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      const msg = String((err as Error)?.message ?? err);
      const looksLikeStaleChunk =
        /Loading chunk/i.test(msg) ||
        /Failed to fetch dynamically imported module/i.test(msg) ||
        /error loading dynamically imported module/i.test(msg) ||
        /Importing a module script failed/i.test(msg);
      if (looksLikeStaleChunk) {
        const key = "rushhq.lastChunkReload";
        const last = Number(sessionStorage.getItem(key) ?? 0);
        if (Date.now() - last > 10_000) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
          // Return a promise that never resolves — the page is reloading,
          // and we don't want React to render the error fallback first.
          return new Promise<{ default: T }>(() => {});
        }
      }
      throw err;
    }),
  );
}

// Auth pages — small, but lazy so the initial bundle is the
// post-login app (since most users are already logged in).
const LoginPage = lazyWithReload(() => import("@/pages/login"));
const ForgotPasswordPage = lazyWithReload(() => import("@/pages/forgot-password"));
const ResetPasswordPage = lazyWithReload(() => import("@/pages/reset-password"));
const MfaEnrolPage = lazyWithReload(() => import("@/pages/mfa-enrol"));
const NoProfilePage = lazyWithReload(() => import("@/pages/no-profile"));

// Calendar lives at the index. Keeping it eager so the homepage
// renders without a flash; the rest of the modules code-split.
import CalendarPage from "@/pages/calendar";

const TasksPage = lazyWithReload(() => import("@/pages/tasks"));
const SettingsPage = lazyWithReload(() => import("@/pages/settings"));
const AdminPage = lazyWithReload(() => import("@/pages/admin"));
const BeadsIndexPage = lazyWithReload(() => import("@/pages/beads"));
const ChartEditPage = lazyWithReload(() => import("@/pages/beads/chart-edit"));
const CountPage = lazyWithReload(() => import("@/pages/beads/count"));
const MyBeadsPage = lazyWithReload(() => import("@/pages/beads/me"));
const StocksOverviewPage = lazyWithReload(() => import("@/pages/stocks"));
const BuyPage = lazyWithReload(() => import("@/pages/stocks/buy"));
const DividendPage = lazyWithReload(() => import("@/pages/stocks/dividend"));
const WithdrawalPage = lazyWithReload(() => import("@/pages/stocks/withdrawal"));
const TransactionsPage = lazyWithReload(() => import("@/pages/stocks/transactions"));
const DepositsPage = lazyWithReload(() => import("@/pages/stocks/deposits"));
const MyStocksPage = lazyWithReload(() => import("@/pages/stocks/me"));
const FinanceOverviewPage = lazyWithReload(() => import("@/pages/finance"));
const FinanceUpdatePage = lazyWithReload(() => import("@/pages/finance/update"));
const FinanceHistoryPage = lazyWithReload(() => import("@/pages/finance/history"));
const FinanceAccountsPage = lazyWithReload(() => import("@/pages/finance/accounts"));
const PropertiesPage = lazyWithReload(() => import("@/pages/finance/properties"));

export function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/no-profile" element={<NoProfilePage />} />

        <Route element={<RequireAuth />}>
          <Route path="/mfa" element={<MfaEnrolPage />} />
          <Route element={<AppShell />}>
            <Route index element={<CalendarPage />} />
            <Route path="/calendar" element={<Navigate to="/" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/beads/me" element={<MyBeadsPage />} />
            <Route path="/stocks/me" element={<MyStocksPage />} />
            <Route element={<RequireRole role="parent" />}>
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/beads" element={<BeadsIndexPage />} />
              <Route path="/beads/charts/:childId" element={<ChartEditPage />} />
              <Route path="/beads/count/:childId" element={<CountPage />} />
              <Route path="/stocks" element={<StocksOverviewPage />} />
              <Route path="/stocks/buy" element={<BuyPage />} />
              <Route path="/stocks/dividend" element={<DividendPage />} />
              <Route path="/stocks/withdrawal" element={<WithdrawalPage />} />
              <Route path="/stocks/transactions" element={<TransactionsPage />} />
              <Route path="/stocks/deposits" element={<DepositsPage />} />
              <Route path="/finance" element={<FinanceOverviewPage />} />
              <Route path="/finance/update/:month" element={<FinanceUpdatePage />} />
              <Route path="/finance/history" element={<FinanceHistoryPage />} />
              <Route path="/finance/accounts" element={<FinanceAccountsPage />} />
              <Route path="/finance/properties" element={<PropertiesPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
