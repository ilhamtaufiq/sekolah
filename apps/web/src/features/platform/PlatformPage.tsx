import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, EmptyState, Input, PageHeader, StatStrip, Table, TableCell, TableRow } from "../../components/kit";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "../../lib/auth";
import { useApiQuery } from "../../lib/hooks";

type SchoolSummary = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  admins: number;
  teachers: number;
  students: number;
  classes: number;
  pending_journals: number;
  last_attendance: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Status aktivitas dari tanggal absensi terakhir. */
function activity(last: string | null): { label: string; variant: "default" | "secondary" | "outline" | "destructive" } {
  if (!last) return { label: "Belum ada absensi", variant: "outline" };
  const days = Math.floor((Date.now() - new Date(`${last}T00:00:00`).getTime()) / DAY_MS);
  if (days <= 7) return { label: "Aktif", variant: "default" };
  return { label: `Tidak aktif · ${days} hari`, variant: "destructive" };
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Dashboard super admin: semua sekolah (tenant) dalam satu tampilan. */
export function PlatformPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const schools = useApiQuery<SchoolSummary[]>(["platform", "schools"], "/platform/schools");
  const [query, setQuery] = useState("");

  const rows = schools.data ?? [];
  const totals = useMemo(
    () =>
      rows.reduce(
        (t, s) => ({
          students: t.students + s.students,
          teachers: t.teachers + s.teachers,
          classes: t.classes + s.classes,
          pending: t.pending + s.pending_journals,
        }),
        { students: 0, teachers: 0, classes: 0, pending: 0 },
      ),
    [rows],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="flex items-center justify-between border-b bg-background px-4 py-3 sm:px-8">
        <div className="flex items-center gap-2.5">
          <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="" className="size-7 object-contain" />
          <span className="font-semibold tracking-tight">SCHID</span>
          <Badge variant="secondary">Super admin</Badge>
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
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-8">
        <PageHeader
          title="Semua sekolah"
          description={`${rows.length} sekolah terdaftar di SCHID. Data diambil langsung dari setiap tenant.`}
        />

        {schools.isPending && <p className="text-sm text-muted-foreground">Memuat daftar sekolah…</p>}
        {schools.isError && <p className="text-sm text-destructive">Gagal memuat daftar sekolah.</p>}

        {schools.data && (
          <>
            <StatStrip
              items={[
                { label: "Sekolah", value: rows.length },
                { label: "Siswa aktif", value: totals.students },
                { label: "Guru & wali kelas", value: totals.teachers },
                { label: "Kelas aktif", value: totals.classes, hint: `${totals.pending} jurnal menunggu persetujuan` },
              ]}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Input
                className="max-w-xs"
                placeholder="Cari nama atau slug sekolah"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {filtered.length === 0 ? (
              <EmptyState title="Tidak ada sekolah yang cocok." />
            ) : (
              <Table head={["Sekolah", "Siswa", "Guru", "Kelas", "Jurnal menunggu", "Absensi terakhir", "Status"]}>
                {filtered.map((s) => {
                  const act = activity(s.last_attendance);
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">{s.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{s.slug}</div>
                      </TableCell>
                      <TableCell className="tabular-nums">{s.students}</TableCell>
                      <TableCell className="tabular-nums">{s.teachers}</TableCell>
                      <TableCell className="tabular-nums">{s.classes}</TableCell>
                      <TableCell className="tabular-nums">{s.pending_journals}</TableCell>
                      <TableCell>{formatDate(s.last_attendance)}</TableCell>
                      <TableCell>
                        <Badge variant={act.variant}>{act.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </Table>
            )}
          </>
        )}
      </main>
    </div>
  );
}
