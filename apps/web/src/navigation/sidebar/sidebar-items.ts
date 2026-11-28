import {
  BadgeCheck,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  Award,
  FileText,
  GraduationCap,
  LayoutDashboard,
  type LucideIcon,
  NotebookPen,
  School,
  Settings,
  Shield,
  Users,
  Wallet,
} from "lucide-react";

export type NavBadge = "new" | "updated" | "soon";

export interface NavSubItem {
  id: string;
  title: string;
  url: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

interface NavItemBase {
  id: string;
  title: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

export interface NavMainLinkItem extends NavItemBase {
  url: string;
  subItems?: never;
}

export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

/** Peran yang bisa melihat sebuah menu. */
const STAFF = ["admin", "kepala_sekolah", "guru", "wali_kelas"];
const LEADERSHIP = ["admin", "kepala_sekolah"];
const TEACHING = ["admin", "guru", "wali_kelas"];

type RoleItem = NavMainLinkItem & { roles: string[] };
type RoleGroup = { id: number; label: string; items: RoleItem[] };

const link = (id: string, title: string, url: string, icon: LucideIcon, roles: string[]): RoleItem => ({
  id,
  title,
  url,
  icon,
  roles,
});

/** Menu SCHID, dikelompokkan seperti sebelumnya. */
const schoolGroups: RoleGroup[] = [
  {
    id: 1,
    label: "Ringkasan",
    items: [link("beranda", "Beranda", "/", LayoutDashboard, [...STAFF, "siswa"])],
  },
  {
    id: 2,
    label: "Akademik",
    items: [
      link("tahun-ajaran", "Tahun ajaran", "/tahun-ajaran", CalendarClock, LEADERSHIP),
      link("mapel", "Mapel", "/mapel", BookOpen, LEADERSHIP),
      link("kelas", "Kelas", "/kelas", School, STAFF),
      link("siswa", "Siswa", "/siswa", Users, STAFF),
      link("staf", "Guru & staf", "/staf", GraduationCap, LEADERSHIP),
      link("jadwal", "Jadwal", "/jadwal", CalendarClock, STAFF),
    ],
  },
  {
    id: 3,
    label: "Harian",
    items: [
      link("absensi", "Absensi", "/absensi", ClipboardCheck, STAFF),
      link("jurnal", "Jurnal mengajar", "/jurnal", NotebookPen, TEACHING),
      link("persetujuan-jurnal", "Persetujuan jurnal", "/persetujuan-jurnal", BadgeCheck, LEADERSHIP),
      link("nilai", "Input nilai", "/nilai", FileText, TEACHING),
    ],
  },
  {
    id: 4,
    label: "Raport & kelulusan",
    items: [
      link("raport", "Raport", "/raport", FileText, STAFF),
      link("cetak-massal", "Cetak massal", "/cetak-massal", Wallet, ["admin", "wali_kelas"]),
      link("kenaikan", "Kenaikan kelas", "/kenaikan", Award, ["admin"]),
      link("format-raport", "Format raport", "/pengaturan/format-raport", Settings, STAFF),
    ],
  },
  {
    id: 5,
    label: "Pembelajaran",
    items: [
      link("ruang-kelas", "Ruang kelas", "/ruang-kelas", BookOpen, [...STAFF, "siswa"]),
      link("bank-soal", "Bank soal", "/bank-soal", FileText, TEACHING),
      link("ujian", "Ujian", "/ujian", ClipboardCheck, TEACHING),
    ],
  },
  {
    id: 6,
    label: "Pengaturan",
    items: [link("profil", "Profil sekolah", "/pengaturan/profil", Shield, ["admin"])],
  },
  {
    id: 7,
    label: "Murid",
    items: [
      link("ujian-saya", "Ujian saya", "/ujian-saya", ClipboardCheck, ["siswa"]),
      link("raport-saya", "Raport saya", "/raport-saya", FileText, ["siswa"]),
      link("sertifikat-saya", "Sertifikat saya", "/sertifikat-saya", Award, ["siswa"]),
    ],
  },
];

/** Menu untuk satu peran. Grup yang kosong untuk peran itu tidak ditampilkan. */
export function sidebarItemsFor(role: string): NavGroup[] {
  return schoolGroups
    .map((g) => ({
      id: g.id,
      label: g.label,
      items: g.items.filter((item) => item.roles.includes(role)).map(({ roles: _roles, ...item }) => item),
    }))
    .filter((g) => g.items.length > 0);
}
