import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { Button } from "./kit";
import { Header } from "./layout-header";
import { Main } from "./layout-main";
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
  SidebarRail,
} from "@/components/ui/sidebar";

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
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="" className="size-8 object-contain" />
            <div className="grid min-w-0 flex-1 text-start leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-semibold">SCHID</span>
              <span className="truncate text-xs text-muted-foreground">{user?.school_name}</span>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
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

        <SidebarFooter>
          <div className="px-2 py-1 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.role}</p>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start group-data-[collapsible=icon]:justify-center"
            onClick={() => {
              logout();
              navigate("/login", { replace: true });
            }}
          >
            Keluar
          </Button>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <Header fixed>
          <span className="truncate text-sm text-muted-foreground">{user?.school_name}</span>
        </Header>
        <Main>
          <div className="mx-auto w-full max-w-5xl">
            <Outlet />
          </div>
        </Main>
      </SidebarInset>
    </SidebarProvider>
  );
}
