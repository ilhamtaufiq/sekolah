import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { cn } from "./ui";

const STAFF = ["admin", "kepala_sekolah", "guru", "wali_kelas"];
const LEADERSHIP = ["admin", "kepala_sekolah"];
const TEACHING = ["admin", "guru", "wali_kelas"];

type NavItem = { to: string; label: string; roles: string[]; end?: boolean };
type NavGroup = { title: string; items: NavItem[] };

// Menu dikelompokkan per pekerjaan, supaya admin tidak melihat satu baris panjang.
const groups: NavGroup[] = [
  {
    title: "Ringkasan",
    items: [{ to: "/", label: "Beranda", roles: STAFF, end: true }],
  },
  {
    title: "Akademik",
    items: [
      { to: "/tahun-ajaran", label: "Tahun ajaran", roles: LEADERSHIP },
      { to: "/mapel", label: "Mapel", roles: LEADERSHIP },
      { to: "/kelas", label: "Kelas", roles: STAFF },
      { to: "/siswa", label: "Siswa", roles: STAFF },
      { to: "/staf", label: "Guru & staf", roles: LEADERSHIP },
      { to: "/jadwal", label: "Jadwal", roles: STAFF },
    ],
  },
  {
    title: "Harian",
    items: [
      { to: "/absensi", label: "Absensi", roles: STAFF },
      { to: "/jurnal", label: "Jurnal mengajar", roles: TEACHING },
      { to: "/persetujuan-jurnal", label: "Persetujuan jurnal", roles: LEADERSHIP },
      { to: "/nilai", label: "Input nilai", roles: TEACHING },
    ],
  },
  {
    title: "Raport & kelulusan",
    items: [
      { to: "/raport", label: "Raport", roles: STAFF },
      { to: "/cetak-massal", label: "Cetak massal", roles: ["admin", "wali_kelas"] },
      { to: "/kenaikan", label: "Kenaikan kelas", roles: ["admin"] },
      { to: "/pengaturan/format-raport", label: "Format raport", roles: STAFF },
    ],
  },
  {
    title: "Pembelajaran",
    items: [
      { to: "/ruang-kelas", label: "Ruang kelas", roles: [...STAFF, "siswa"] },
      { to: "/bank-soal", label: "Bank soal", roles: TEACHING },
      { to: "/ujian", label: "Ujian", roles: TEACHING },
    ],
  },
  {
    title: "Pengaturan",
    items: [{ to: "/pengaturan/profil", label: "Profil sekolah", roles: ["admin"] }],
  },
  {
    title: "Murid",
    items: [
      { to: "/ujian-saya", label: "Ujian saya", roles: ["siswa"] },
      { to: "/raport-saya", label: "Raport saya", roles: ["siswa"] },
      { to: "/sertifikat-saya", label: "Sertifikat saya", roles: ["siswa"] },
    ],
  },
];

function NavList({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  return (
    <>
      {groups.map((group) => {
        const items = group.items.filter((item) => item.roles.includes(role));
        if (items.length === 0) return null;
        return (
          <div key={group.title} className="space-y-0.5 pt-4 first:pt-0">
            <p className="px-3 pb-1 text-xs font-medium text-slate-400">{group.title}</p>
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "block rounded-md px-3 py-1.5 text-sm",
                    isActive ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const role = user?.role ?? "";

  const logoutButton = (
    <button
      type="button"
      className="w-full rounded-md px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      onClick={() => {
        logout();
        navigate("/login", { replace: true });
      }}
    >
      Keluar
    </button>
  );

  const brand = (
    <div className="flex items-center gap-2.5">
      <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="" className="size-7 object-contain" />
      <span className="font-semibold tracking-tight">SCHID</span>
    </div>
  );

  return (
    <div className="min-h-dvh bg-slate-50 lg:flex">
      {/* Sidebar tetap di layar lebar */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white">
        <div className="border-b border-slate-200 px-5 py-4">{brand}</div>
        <nav aria-label="Menu utama" className="flex-1 overflow-y-auto px-3 py-3">
          <NavList role={role} />
        </nav>
        <div className="border-t border-slate-200 px-3 py-3">
          <div className="px-3 pb-2">
            <p className="truncate text-sm font-medium text-slate-900">{user?.name}</p>
            <p className="truncate text-xs text-slate-500">
              {user?.school_name} · {user?.role}
            </p>
          </div>
          {logoutButton}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Bilah atas di layar kecil; menu terbuka sebagai panel */}
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            {brand}
            <button
              type="button"
              aria-expanded={open}
              aria-controls="main-nav"
              onClick={() => setOpen((v) => !v)}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
            >
              {open ? "Tutup" : "Menu"}
            </button>
          </div>
          <nav id="main-nav" aria-label="Menu utama seluler" className={cn("border-t border-slate-200 px-3 py-3", open ? "block" : "hidden")}>
            <NavList role={role} onNavigate={() => setOpen(false)} />
            <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="px-3 pb-1 text-sm font-medium text-slate-900">{user?.name}</p>
              {logoutButton}
            </div>
          </nav>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
