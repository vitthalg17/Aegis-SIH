import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./auth";
import { AppShell } from "./components/AppShell";
import { Spinner } from "./components/ui";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Nodes } from "./pages/Nodes";
import { NodeDetail } from "./pages/NodeDetail";
import { Alerts } from "./pages/Alerts";
import { Settings } from "./pages/Settings";

function RequireAuth({ children }: { children: ReactNode }) {
  const { email, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner label="Checking your session" />;
  if (!email) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <AppShell>{children}</AppShell>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/app" element={<RequireAuth><Nodes /></RequireAuth>} />
      <Route path="/app/nodes/:nodeId" element={<RequireAuth><NodeDetail /></RequireAuth>} />
      <Route path="/app/alerts" element={<RequireAuth><Alerts /></RequireAuth>} />
      <Route path="/app/settings" element={<RequireAuth><Settings /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
