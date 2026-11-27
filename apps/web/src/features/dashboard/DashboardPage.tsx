import { Link } from "react-router";
import { BookOpen, GraduationCap, School, Users } from "lucide-react";
import { Card, EmptyState, PageHeader } from "../../components/kit";
import { Progress } from "@/components/ui/progress";
import { Card as ShadCard, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useApiQuery } from "../../lib/hooks";
import { formatDate, type Summary } from "../academic/types";

type JournalRow = { id: string };

type Task = { label: string; count: number; detail: string; to: string };

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint: string;
  icon: typeof Users;
}) {
  return (
    <ShadCard className="gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
        <CardDescription className="text-xs font-medium">{label}</CardDescription>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </ShadCard>
  );
}

export function DashboardPage() {
  const summary = useApiQuery<Summary>(["summary"], "/dashboard/summary");
  const pending = useApiQuery<JournalRow[]>(["jurnal", "menunggu"], "/jurnal?status=menunggu");

  if (summary.isPending) return <p className="text-sm text-muted-foreground">Memuat ringkasan…</p>;
  if (summary.isError) return <p className="text-sm text-destructive">Gagal memuat ringkasan.</p>;
  const s = summary.data;

  // Hanya tugas yang benar-benar menunggu tindakan yang ditampilkan.
  const tasks: Task[] = [];
  if (!s.active_year) {
    tasks.push({ label: "Tahun ajaran belum aktif", count: 1, detail: "Aktifkan satu tahun ajaran agar kelas dan absensi bisa dicatat.", to: "/tahun-ajaran" });
  }
  const pendingJournals = pending.data?.length ?? 0;
  if (pendingJournals > 0) {
    tasks.push({ label: "Jurnal menunggu persetujuan", count: pendingJournals, detail: "Setujui atau kembalikan dengan catatan.", to: "/persetujuan-jurnal" });
  }
  const unrecorded = s.classes - s.today.classes_recorded;
  if (s.active_year && s.classes > 0 && unrecorded > 0) {
    tasks.push({ label: "Kelas belum dicatat absensinya", count: unrecorded, detail: "Hari ini, dari seluruh kelas aktif.", to: "/absensi" });
  }

  const rate = s.today.present_rate;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={formatDate(s.today.date)}
        title="Ringkasan"
        description={s.active_year ? `Tahun ajaran aktif ${s.active_year}.` : "Belum ada tahun ajaran aktif."}
      />

      <section aria-labelledby="perlu-tindakan" className="space-y-3">
        <h2 id="perlu-tindakan" className="text-sm font-semibold">
          Perlu tindakan
        </h2>
        {tasks.length === 0 ? (
          <EmptyState title="Tidak ada yang menunggu tindakan.">Jurnal, absensi, dan tahun ajaran sudah beres.</EmptyState>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {tasks.map((t) => (
              <li key={t.label}>
                <Link to={t.to} className="flex items-center gap-4 px-5 py-4 hover:bg-muted/50">
                  <span className="w-12 shrink-0 text-2xl font-semibold tabular-nums">{t.count}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{t.label}</span>
                    <span className="block text-sm text-muted-foreground">{t.detail}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-primary">Buka →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ringkasan-angka" className="space-y-3">
        <h2 id="ringkasan-angka" className="text-sm font-semibold">
          Sekolah saat ini
        </h2>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Siswa aktif" value={s.active_students} hint="Akun siswa aktif" icon={GraduationCap} />
          <StatCard label="Kelas" value={s.classes} hint="Tahun ajaran aktif" icon={School} />
          <StatCard label="Guru & wali kelas" value={s.teachers} hint="Akun aktif" icon={Users} />
          <StatCard label="Penugasan" value={s.assignments} hint="Mapel per kelas" icon={BookOpen} />
        </div>
      </section>

      <Card title="Kehadiran hari ini" description="Dari absensi harian yang sudah dicatat wali kelas.">
        {s.today.total === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada catatan absensi hari ini.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {s.today.present} hadir dari {s.today.total} catatan
                </p>
                <p className="text-lg font-semibold tabular-nums">{rate === null ? "—" : `${rate}%`}</p>
              </div>
              <Progress value={rate ?? 0} className="mt-2" aria-label={`Persentase hadir ${rate ?? 0} persen`} />
            </div>
            <p className="text-sm text-muted-foreground">
              {s.today.classes_recorded} dari {s.classes} kelas sudah dicatat.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
