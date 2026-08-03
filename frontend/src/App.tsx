import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { WelcomePage } from "./pages/WelcomePage";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { DiscoverPage } from "./pages/DiscoverPage";
import { SurprisePage } from "./pages/SurprisePage";
import { LoadingPage } from "./pages/LoadingPage";
import { ManualSelectPage, CategoryRoomsPage } from "./pages/ManualSelectPage";
import { RoomDetailPage } from "./pages/RoomDetailPage";
import { SuccessPage } from "./pages/SuccessPage";
import { ProfilePage } from "./pages/ProfilePage";
import { PointsPage } from "./pages/PointsPage";
import { PremiumPage } from "./pages/PremiumPage";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import { InvitePage } from "./pages/InvitePage";

function BootGate({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();
  if (loading) {
    return (
      <div className="screen boot-screen">
        <div className="logo logo--lg">
          <span className="logo__text">GOT URS</span>
          <span className="logo__heart">♡</span>
        </div>
        <p>טוענים את החוויה...</p>
      </div>
    );
  }
  return children;
}

export function App() {
  return (
    <BootGate>
      <div className="viewport">
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/app/home" element={<HomePage />} />
          <Route path="/app/discover" element={<DiscoverPage />} />
          <Route path="/app/surprise" element={<SurprisePage />} />
          <Route path="/app/loading" element={<LoadingPage />} />
          <Route path="/app/manual" element={<ManualSelectPage />} />
          <Route path="/app/rooms/:categoryId" element={<CategoryRoomsPage />} />
          <Route path="/app/room/:roomId" element={<RoomDetailPage />} />
          <Route path="/app/success" element={<SuccessPage />} />
          <Route path="/app/profile" element={<ProfilePage />} />
          <Route path="/app/points" element={<PointsPage />} />
          <Route path="/app/premium" element={<PremiumPage />} />
          <Route path="/app/chat" element={<ChatPage />} />
          <Route path="/app/settings" element={<SettingsPage />} />
          <Route path="/app/invite" element={<InvitePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BootGate>
  );
}
