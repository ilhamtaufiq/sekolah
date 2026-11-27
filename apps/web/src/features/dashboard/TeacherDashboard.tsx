import { Link } from "react-router";
import { ClipboardCheck, Clock, NotebookPen, TrendingUp } from "lucide-react";
import { EmptyState, PageHeader } from "../../components/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "../../lib/auth";
import { DummyNote } from "./parts";
import { teacherDummy } from "./mock";

const STATE_LABEL = {
  selesai: { text: "Selesai", variant: "outline" as const },
  berlangsung: { text: "Berlangsung", variant: "default" as const },
  "akan datang": { text: "Akan datang", variant: "secondary" as const },
};

export function TeacherDashboard() {
  const { user } = useAuth();
  const d = teacherDummy;
  const journalCount = d.journalsMissing.length;
  const gradingCount = d.toGrade.reduce((sum, t) => sum + (t.total - t.submitted), 0);
  const todayCount = d.schedule.length;
  const avg = Math.round(d.classAverage.reduce((sum, c) => sum + c.average, 0) / d.classAverage.length);
  const attendance = Math.round((d.attendanceMyClasses.present / d.attendanceMyClasses.total) * 100);

  return (
    <div className="space-y-6">
      <PageHeader title={`Halo, ${user?.name ?? "Guru"}`} description="Jadwal, jurnal, dan penilaian Anda hari ini." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={Clock} label="Jadwal hari ini" value={todayCount} hint="Jam mengajar" />
        <Metric icon={NotebookPen} label="Jurnal belum diisi" value={journalCount} hint="Perlu dilengkapi" />
        <Metric icon={ClipboardCheck} label="Tugas belum dinilai" value={gradingCount} hint="Dari pengumpulan siswa" />
        <Metric icon={TrendingUp} label="Rata-rata kelas" value={avg} hint="Nilai akhir Anda" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Jadwal hari ini</CardTitle>
            <CardDescription>Jam mengajar sesuai jadwal yang sudah ditetapkan.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {d.schedule.map((slot) => (
                <li key={slot.time} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">{slot.time}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {slot.subject} · {slot.className}
                    </span>
                    <span className="block text-xs text-muted-foreground">Ruang {slot.room}</span>
                  </span>
                  <Badge variant={STATE_LABEL[slot.state].variant}>{STATE_LABEL[slot.state].text}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kehadiran kelas saya</CardTitle>
            <CardDescription>Dari absensi per mapel minggu ini.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Hadir</span>
              <span className="text-lg font-semibold tabular-nums">{attendance}%</span>
            </div>
            <Progress value={attendance} />
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="perlu-dikerjakan" className="space-y-3">
        <h2 id="perlu-dikerjakan" className="text-sm font-semibold">
          Perlu dikerjakan
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Jurnal belum diisi</CardTitle>
            </CardHeader>
            <CardContent>
              {d.journalsMissing.length === 0 ? (
                <EmptyState title="Semua jurnal sudah diisi." />
              ) : (
                <ul className="divide-y">
                  {d.journalsMissing.map((j) => (
                    <li key={`${j.date}-${j.className}-${j.hour}`} className="flex items-center justify-between gap-3 py-3">
                      <span className="text-sm">
                        {j.subject} · {j.className} <span className="text-muted-foreground">· jam ke-{j.hour}, {j.date}</span>
                      </span>
                      <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/jurnal" />}>
                        Isi jurnal
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tugas perlu dinilai</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {d.toGrade.map((t) => (
                  <li key={t.task + t.className} className="space-y-2 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">
                        {t.task} · {t.className}
                      </span>
                      <span className="text-xs text-muted-foreground">Tenggat {t.due}</span>
                    </div>
                    <Progress value={(t.submitted / t.total) * 100} />
                    <p className="text-xs text-muted-foreground">
                      {t.submitted} dari {t.total} siswa sudah mengumpulkan
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Rata-rata nilai per kelas</CardTitle>
          <CardDescription>Nilai akhir semester berjalan.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {d.classAverage.map((c) => (
            <div key={c.className} className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">Kelas {c.className}</span>
                <span className="text-sm tabular-nums">{c.average}</span>
              </div>
              <Progress value={c.average} />
            </div>
          ))}
        </CardContent>
      </Card>

      <DummyNote>Jadwal, pekerjaan, dan nilai di halaman ini adalah data contoh. Angka asli akan muncul setelah data tersambung.</DummyNote>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Clock;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="truncate text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
