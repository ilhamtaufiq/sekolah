import { NavLink, Outlet, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { cn } from "./ui";

const STAFF = ["admin", "kepala_sekolah", "guru", "wali_kelas"];
const LEADERSHIP = ["admin", "kepala_sekolah"];
const TEACHING = ["admin", "guru", "wali_kelas"];

const nav = [
  { to: "/", label: "Beranda", roles: STAFF, end: true },
  { to: "/tahun-ajaran", label: "Tahun ajaran", roles: LEADERSHIP },
  { to: "/mapel", label: "Mapel", roles: LEADERSHIP },
  { to: "/kelas", label: "Kelas", roles: STAFF },
  { to: "/siswa", label: "Siswa", roles: STAFF },
  { to: "/staf", label: "Guru & staf", roles: LEADERSHIP },
  { to: "/jadwal", label: "Jadwal", roles: STAFF },
  { to: "/absensi", label: "Absensi", roles: STAFF },
  { to: "/nilai", label: "Input nilai", roles: TEACHING },
  { to: "/raport", label: "Raport", roles: STAFF },
  { to: "/pengaturan/format-raport", label: "Format raport", roles: STAFF },
  { to: "/ruang-kelas", label: "Ruang kelas", roles: [...STAFF, "siswa"] },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2 font-semibold">
              <span className="flex size-7 items-center justify-center rounded-md bg-brand-600 text-sm text-white">S</span>
              SIMAS
            </span>
            <nav className="flex gap-1">
              {nav
                .filter((item) => user && item.roles.includes(user.role))
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={"end" in item && item.end}
                    className={({ isActive }) =>
                      cn(
                        "rounded-md px-3 py-1.5 text-sm font-medium",
                        isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="text-right leading-tight">
              <p className="font-medium">{user?.name}</p>
              <p className="text-xs text-slate-500">
                {user?.school_name} · {user?.role}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md px-2.5 py-1.5 text-slate-600 hover:bg-slate-100"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
            >
              Keluar
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
