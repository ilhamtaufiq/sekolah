import { useState } from "react";
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
  { to: "/bank-soal", label: "Bank soal", roles: TEACHING },
  { to: "/ujian", label: "Ujian", roles: TEACHING },
  { to: "/ujian-saya", label: "Ujian saya", roles: ["siswa"] },
  { to: "/raport-saya", label: "Raport saya", roles: ["siswa"] },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const items = nav.filter((item) => user && item.roles.includes(user.role));
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium",
      isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
    );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex shrink-0 items-center gap-2 font-semibold">
              <span className="flex size-7 items-center justify-center rounded-md bg-brand-600 text-sm text-white">S</span>
              SIMAS
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <div className="hidden text-right leading-tight sm:block">
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
            <button
              type="button"
              aria-expanded={open}
              aria-controls="main-nav"
              onClick={() => setOpen((v) => !v)}
              className="rounded-md px-2.5 py-1.5 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 lg:hidden"
            >
              {open ? "Tutup" : "Menu"}
            </button>
          </div>
        </div>
        <nav
          id="main-nav"
          aria-label="Menu utama"
          className={cn(
            "border-t border-slate-100 px-4 sm:px-6",
            open ? "block" : "hidden",
            "lg:block",
          )}
        >
          <div className="mx-auto flex max-w-7xl flex-col gap-1 py-2 lg:flex-row lg:items-center lg:gap-1 lg:overflow-x-auto">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={"end" in item && item.end}
                onClick={() => setOpen(false)}
                className={linkClass}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
