import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { Button } from "./kit";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

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


/** Item menu yang menandai halaman aktif. */
function NavItem({ to, end, label }: { to: string; end?: boolean; label: string }) {
  const { pathname } = useLocation();
  const active = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  return (
    <SidebarMenuButton isActive={active} render={<NavLink to={to} end={end} />}>
      {label}
    </SidebarMenuButton>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const role = user?.role ?? "";

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="" className="size-7 object-contain" />
            <span className="font-semibold tracking-tight group-data-[collapsible=icon]:hidden">SCHID</span>
          </div>
        </SidebarHeader>

        <SidebarContent className="min-h-0 overflow-y-auto">
          {groups.map((group) => {
            const items = group.items.filter((item) => item.roles.includes(role));
            if (items.length === 0) return null;
            return (
              <SidebarGroup key={group.title} className="py-1">
                <SidebarGroupLabel className="h-7">{group.title}</SidebarGroupLabel>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <NavItem to={item.to} end={item.end} label={item.label} />
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            );
          })}
        </SidebarContent>

        <SidebarFooter className="border-t p-3">
          <div className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {user?.school_name} · {user?.role}
            </p>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              logout();
              navigate("/login", { replace: true });
            }}
          >
            Keluar
          </Button>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b bg-background px-4 md:hidden">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">SCHID</span>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
