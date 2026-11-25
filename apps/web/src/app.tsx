import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./features/auth/LoginPage";
import { FormatSettingsPage } from "./features/report-format/FormatSettingsPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function Home() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Selamat datang</h1>
      <p className="text-sm text-slate-600">Modul lain menyusul di fase berikutnya. Mulai dari pengaturan format raport.</p>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Home />} />
          <Route path="pengaturan/format-raport" element={<FormatSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
