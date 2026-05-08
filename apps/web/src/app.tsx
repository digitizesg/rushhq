import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequireRole } from "@/auth/route-guards";
import { AppShell } from "@/components/app-shell";
import { LoadingScreen } from "@/components/loading-screen";

// Auth pages — small, but lazy so the initial bundle is the
// post-login app (since most users are already logged in).
const LoginPage = lazy(() => import("@/pages/login"));
const ForgotPasswordPage = lazy(() => import("@/pages/forgot-password"));
const ResetPasswordPage = lazy(() => import("@/pages/reset-password"));
const MfaEnrolPage = lazy(() => import("@/pages/mfa-enrol"));
const NoProfilePage = lazy(() => import("@/pages/no-profile"));

// Calendar lives at the index. Keeping it eager so the homepage
// renders without a flash; the rest of the modules code-split.
import CalendarPage from "@/pages/calendar";

const TasksPage = lazy(() => import("@/pages/tasks"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const AdminPage = lazy(() => import("@/pages/admin"));
const BeadsIndexPage = lazy(() => import("@/pages/beads"));
const ChartEditPage = lazy(() => import("@/pages/beads/chart-edit"));
const CountPage = lazy(() => import("@/pages/beads/count"));
const MyBeadsPage = lazy(() => import("@/pages/beads/me"));
const StocksOverviewPage = lazy(() => import("@/pages/stocks"));
const BuyPage = lazy(() => import("@/pages/stocks/buy"));
const DividendPage = lazy(() => import("@/pages/stocks/dividend"));
const WithdrawalPage = lazy(() => import("@/pages/stocks/withdrawal"));
const TransactionsPage = lazy(() => import("@/pages/stocks/transactions"));
const DepositsPage = lazy(() => import("@/pages/stocks/deposits"));
const MyStocksPage = lazy(() => import("@/pages/stocks/me"));
const FinanceOverviewPage = lazy(() => import("@/pages/finance"));
const FinanceUpdatePage = lazy(() => import("@/pages/finance/update"));
const FinanceHistoryPage = lazy(() => import("@/pages/finance/history"));
const FinanceAccountsPage = lazy(() => import("@/pages/finance/accounts"));
const PropertiesPage = lazy(() => import("@/pages/finance/properties"));

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
