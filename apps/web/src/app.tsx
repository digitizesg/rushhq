import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequireRole } from "@/auth/route-guards";
import { AppShell } from "@/components/app-shell";

import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import MfaEnrolPage from "@/pages/mfa-enrol";
import NoProfilePage from "@/pages/no-profile";
import CalendarPage from "@/pages/calendar";
import SettingsPage from "@/pages/settings";
import AdminPage from "@/pages/admin";
import BeadsIndexPage from "@/pages/beads";
import ChartEditPage from "@/pages/beads/chart-edit";
import CountPage from "@/pages/beads/count";
import MyBeadsPage from "@/pages/beads/me";
import StocksOverviewPage from "@/pages/stocks";
import BuyPage from "@/pages/stocks/buy";
import DividendPage from "@/pages/stocks/dividend";
import WithdrawalPage from "@/pages/stocks/withdrawal";
import TransactionsPage from "@/pages/stocks/transactions";
import DepositsPage from "@/pages/stocks/deposits";
import MyStocksPage from "@/pages/stocks/me";
import FinanceOverviewPage from "@/pages/finance";
import FinanceUpdatePage from "@/pages/finance/update";
import FinanceHistoryPage from "@/pages/finance/history";
import FinanceAccountsPage from "@/pages/finance/accounts";

export function App() {
  return (
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
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
