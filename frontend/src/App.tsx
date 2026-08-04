import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { InvestorsPage } from "./pages/InvestorsPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { QuotesPage } from "./pages/QuotesPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="investors" element={<InvestorsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
