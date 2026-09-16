import { AnimatePresence } from "framer-motion";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { PageTransition } from "./components/motion/PageTransition";
import { RequireAuth, RequireManager } from "./components/RequireAuth";
import { WelcomeSplash } from "./components/WelcomeSplash";
import { AuthProvider } from "./context/AuthContext";
import { ActivityPage } from "./pages/ActivityPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { InvestorsPage } from "./pages/InvestorsPage";
import { LoginPage } from "./pages/LoginPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { PersonalAreaPage } from "./pages/PersonalAreaPage";
import { QuotesPage } from "./pages/QuotesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/UsersPage";

export function App() {
  return (
    <AuthProvider>
      <WelcomeSplash />
      <AnimatedRoutes />
    </AuthProvider>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  const isPublicAuth =
    location.pathname === "/login" || location.pathname === "/forgot-password";

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={isPublicAuth ? location.pathname : "app"}>
        <Route
          path="/login"
          element={
            <PageTransition>
              <LoginPage />
            </PageTransition>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PageTransition>
              <ForgotPasswordPage />
            </PageTransition>
          }
        />

        <Route element={<RequireAuth />}>
          <Route path="change-password" element={<ChangePasswordPage />} />
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="investors" element={<InvestorsPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="account" element={<PersonalAreaPage />} />
            <Route element={<RequireManager />}>
              <Route path="activity" element={<ActivityPage />} />
              <Route path="quotes" element={<QuotesPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  );
}
