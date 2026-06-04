import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "../../components/layout/AppLayout";
import { DashboardPage } from "../../features/dashboard/pages/DashboardPage";
import { DrawHistoryPage } from "../../features/draws/pages/DrawHistoryPage";
import { NumberFrequencyPage } from "../../features/frequency/pages/NumberFrequencyPage";
import { SystemHealthPage } from "../../features/health/pages/SystemHealthPage";
import { PairAnalysisPage } from "../../features/pairs/pages/PairAnalysisPage";
import { SnapshotManagementPage } from "../../features/snapshots/pages/SnapshotManagementPage";
import { StrongNumberPage } from "../../features/strong-number/pages/StrongNumberPage";
import { appPaths } from "../routes/paths";

export function AppRouter() {
  return (
    <Routes>
      <Route path={appPaths.root} element={<Navigate to={appPaths.dashboard} replace />} />
      <Route element={<AppLayout />}>
        <Route path={appPaths.dashboard} element={<DashboardPage />} />
        <Route path={appPaths.draws} element={<DrawHistoryPage />} />
        <Route path={appPaths.frequency} element={<NumberFrequencyPage />} />
        <Route path={appPaths.strongNumber} element={<StrongNumberPage />} />
        <Route path={appPaths.pairs} element={<PairAnalysisPage />} />
        <Route path={appPaths.snapshots} element={<SnapshotManagementPage />} />
        <Route path={appPaths.health} element={<SystemHealthPage />} />
      </Route>
      <Route path="*" element={<Navigate to={appPaths.dashboard} replace />} />
    </Routes>
  );
}

