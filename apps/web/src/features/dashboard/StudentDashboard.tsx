import { Link } from "react-router";
import { CalendarClock, CheckCircle2, GraduationCap, PlayCircle } from "lucide-react";
import { PageHeader } from "../../components/kit";
import { Button } from "../../components/kit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "../../lib/auth";
import { DummyNote, Delta } from "./parts";
import { studentDummy } from "./mock";

export function StudentDashboard() {
  const { user } = useAuth();
  const d = studentDummy;
  const avg = Math.round(d.recentGrades.reduce((sum, g) => sum + g.score, 0) / d.recentGrades.length);
  const monthTotal = d.attendanceMonth.present + d.attendanceMonth.sick + d.attendanceMonth.permit + d.attendanceMonth.absent;
  const monthRate = Math.round((d.attendanceMonth.present / monthTotal) * 100);

  return (
    <div className="space-y-6">
      <PageHeader title={`Halo, ${user?.name ?? "Siswa"}`} description="Tugas, nilai, dan pembelajaran Anda." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={CalendarClock} label="Tugas aktif" value={d.upcomingTasks.length} hint="Belum dikumpulkan" />
        <Metric icon={GraduationCap} label="Rata-rata nilai" value={avg} hint="Dari nilai terbaru" />
        <Metric icon={CheckCircle2} label="Kehadiran bulan ini" value={monthRate} suffix="%" hint={`${d.attendanceMonth.present} hari hadir`} />
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Ujian berikutnya</p>
            <PlayCircle className="size-4 text-muted-foreground" aria-hidden />
          </div>
          <p className="mt-1 text-sm font-semibold">{d.nextExam.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {d.nextExam.date}, {d.nextExam.time}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tugas yang mendekati tenggat</CardTitle>
            <CardDescription>Kumpulkan sebelum tenggat agar tidak tercatat terlambat.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {d.upcomingTasks.map((t) => (
                <li key={t.title} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t.subject} · tenggat {t.due}
                    </span>
                  </span>
                  <span className="text-xs font-medium tabular-nums text-muted-foreground">{t.daysLeft} hari lagi</span>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <Button size="sm" variant="outline" render={<Link to="/ruang-kelas" />}>
                Buka ruang kelas
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Nilai terbaru</CardTitle>
            <CardDescription>Dibandingkan dengan penilaian sebelumnya.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {d.recentGrades.map((g) => (
                <li key={g.subject} className="flex items-center justify-between gap-3 py-3">
                  <span className="text-sm font-medium">{g.subject}</span>
                  <span className="text-right">
                    <span className="block text-lg font-semibold tabular-nums">
                      {g.score} <span className="text-xs font-normal text-muted-foreground">· {g.predicate}</span>
                    </span>
                    <Delta value={g.delta} label="poin" />
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Progres pembelajaran</CardTitle>
          <CardDescription>Bab dan video yang sudah Anda selesaikan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {d.learningProgress.map((p) => (
            <div key={p.title} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm">{p.title}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{p.percent}%</span>
              </div>
              <Progress value={p.percent} />
            </div>
          ))}
        </CardContent>
      </Card>

      <DummyNote>Tugas, nilai, dan progres di halaman ini adalah data contoh. Angka asli akan muncul setelah data tersambung.</DummyNote>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  suffix = "",
  hint,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: number;
  suffix?: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {value}
        {suffix}
      </p>
      <p className="truncate text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
