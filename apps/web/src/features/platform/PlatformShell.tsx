import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { Button } from "../../components/kit";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "../../lib/auth";
import { cn } from "cn";

/** Kerangka dashboard super admin: header dengan navigasi dan keluar. */
export function PlatformShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) =>
    cn("rounded-md px-3 py-1.5 text-sm", isActive ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground");
  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-6">
            <Link to="/platform" className="flex items-center gap-2.5">
              <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="" className="size-7 object-contain" />
              <span className="font-semibold tracking-tight">SCHID</span>
              <Badge variant="secondary">Super admin</Badge>
            </Link>
            <nav className="flex items-center gap-1" aria-label="Menu platform">
              <NavLink to="/platform" end className={link}>Sekolah</NavLink>
              <NavLink to="/platform/audit" className={link}>Audit</NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user?.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                logout();
                navigate("/platform/login", { replace: true });
              }}
            >
              Keluar
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
