import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="state">בודקים התחברות...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function RequireManager() {
  const { user, loading } = useAuth();
  if (loading) return <div className="state">בודקים הרשאות...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_manager) return <Navigate to="/" replace />;
  return <Outlet />;
}
