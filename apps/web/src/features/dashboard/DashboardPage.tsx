import { Link } from "react-router";
import { BookOpen, CalendarCheck, GraduationCap, School, Users } from "lucide-react";
import { Pie, PieChart, Cell, Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { EmptyState, PageHeader } from "../../components/kit";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useApiQuery } from "../../lib/hooks";
import { formatDate, type Summary } from "../academic/types";

type JournalRow = { id: string };
type Task = { label: string; count: number; detail: string; to: string };

const GRADE_COLORS = ["#14305a", "#2b6cd6", "#2fb6c9", "#9fb8d9", "#cbd5e1"];

const attendanceConfig = {
  present_rate: { label: "Hadir", color: "#2b6cd6" },
} satisfies ChartConfig;

/** Cincin persentase kecil untuk angka kehadiran hari ini. */
function RateRing({ value }: { value: number | null }) {
  const pct = value ?? 0;
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 56 56" className="size-14 -rotate-90" aria-hidden>
      <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" className="stroke-muted" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        className="stroke-primary"
        strokeDasharray={c}
        strokeDashoffset={c - (pct / 100) * c}
      />
    </svg>
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
  const gradeTotal = s.grade_distribution.reduce((sum, g) => sum + g.count, 0);
  const trend = s.attendance_week.map((d) => ({
    day: new Date(`${d.date}T00:00:00`).toLocaleDateString("id-ID", { weekday: "short" }),
    present_rate: d.present_rate,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ringkasan sekolah"
        description={formatDate(s.today.date)}
        actions={
          s.active_year ? (
            <Badge variant="secondary" className="h-7 gap-1.5 px-3 text-sm">
              <GraduationCap className="size-3.5" aria-hidden />
              Tahun ajaran {s.active_year}
            </Badge>
          ) : (
            <Badge variant="outline" className="h-7 px-3 text-sm">Belum ada tahun ajaran aktif</Badge>
          )
        }
      />

      {/* Empat statistik dalam satu bingkai */}
      <div className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-xl border bg-card lg:grid-cols-4 lg:divide-y-0">
        <Stat label="Siswa aktif" value={s.active_students} hint="Akun siswa aktif" icon={Users} />
        <Stat label="Guru & wali kelas" value={s.teachers} hint="Akun aktif" icon={GraduationCap} />
        <div className="flex items-center justify-between gap-3 p-5">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Kehadiran hari ini</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{rate === null ? "—" : `${rate}%`}</p>
            <p className="truncate text-xs text-muted-foreground">
              {s.today.total === 0 ? "Belum ada catatan" : `${s.today.present} hadir dari ${s.today.total}`}
            </p>
          </div>
          <RateRing value={rate} />
        </div>
        <Stat label="Kelas aktif" value={s.classes} hint={`${s.assignments} penugasan mapel`} icon={School} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck className="size-4 text-muted-foreground" aria-hidden />
              Tren kehadiran
            </CardTitle>
            <CardDescription>Persentase hadir per hari, dari absensi harian yang sudah dicatat.</CardDescription>
            <CardAction>
              <Link to="/absensi" className="text-sm font-medium text-primary">
                Buka absensi →
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <EmptyState title="Belum ada data kehadiran.">Tren muncul setelah wali kelas mencatat absensi harian.</EmptyState>
            ) : (
              <ChartContainer config={attendanceConfig} className="h-64 w-full">
                <LineChart data={trend} margin={{ top: 8, right: 28, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tickLine={false} axisLine={false} unit="%" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="present_rate" stroke="var(--color-present_rate)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Distribusi predikat</CardTitle>
            <CardDescription>Nilai akhir semester terbaru.</CardDescription>
          </CardHeader>
          <CardContent>
            {gradeTotal === 0 ? (
              <EmptyState title="Belum ada nilai akhir.">Distribusi muncul setelah nilai akhir dihitung.</EmptyState>
            ) : (
              <div className="space-y-5">
                <div className="relative mx-auto h-44 w-44">
                  <PieChart width={176} height={176}>
                    <Pie
                      data={s.grade_distribution}
                      dataKey="count"
                      nameKey="predicate"
                      innerRadius={58}
                      outerRadius={84}
                      stroke="none"
                      isAnimationActive={false}
                    >
                      {s.grade_distribution.map((g, i) => (
                        <Cell key={g.predicate} fill={GRADE_COLORS[i % GRADE_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs text-muted-foreground">Total</span>
                    <span className="text-xl font-semibold tabular-nums">{gradeTotal}</span>
                  </div>
                </div>
                <ul className="space-y-2 text-sm">
                  {s.grade_distribution.map((g, i) => (
                    <li key={g.predicate} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 rounded-sm" style={{ background: GRADE_COLORS[i % GRADE_COLORS.length] }} aria-hidden />
                        Predikat {g.predicate}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {g.count} <span className="text-foreground">{Math.round((g.count / gradeTotal) * 100)}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="perlu-tindakan" className="space-y-3">
        <h2 id="perlu-tindakan" className="text-sm font-semibold">
          Perlu tindakan
        </h2>
        {tasks.length === 0 ? (
          <EmptyState title="Tidak ada yang menunggu tindakan.">Jurnal, absensi, dan tahun ajaran sudah beres.</EmptyState>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
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

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <BookOpen className="size-3.5" aria-hidden />
        Angka diambil langsung dari data sekolah saat ini.
      </p>
    </div>
  );
}

function Stat({ label, value, hint, icon: Icon }: { label: string; value: number; hint: string; icon: typeof Users }) {
  return (
    <div className="min-w-0 p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="truncate text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
