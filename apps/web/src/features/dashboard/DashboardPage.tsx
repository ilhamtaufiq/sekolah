import { Card } from "../../components/ui";
import { useApiQuery } from "../../lib/hooks";
import { formatDate, type Summary } from "../academic/types";

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function DashboardPage() {
  const summary = useApiQuery<Summary>(["summary"], "/dashboard/summary");

  if (summary.isPending) return <p className="text-sm text-slate-500">Memuat ringkasan…</p>;
  if (summary.isError) return <p className="text-sm text-red-700">Gagal memuat ringkasan.</p>;
  const s = summary.data;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">Beranda</p>
        <h1 className="text-2xl font-semibold tracking-tight">Ringkasan sekolah</h1>
        <p className="text-sm text-slate-600">
          {s.active_year ? `Tahun ajaran aktif ${s.active_year}` : "Belum ada tahun ajaran aktif. Aktifkan satu di menu Tahun ajaran."}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Siswa aktif" value={s.active_students} />
        <Stat label="Kelas" value={s.classes} hint="Tahun ajaran aktif" />
        <Stat label="Guru" value={s.teachers} hint="Guru dan wali kelas aktif" />
        <Stat label="Penugasan" value={s.assignments} hint="Mapel per kelas" />
      </div>

      <Card title={`Kehadiran hari ini · ${formatDate(s.today.date)}`} description="Dihitung dari absensi harian yang sudah dicatat wali kelas.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Persentase hadir"
            value={s.today.present_rate === null ? "—" : `${s.today.present_rate}%`}
            hint={s.today.total === 0 ? "Belum ada catatan hari ini" : `${s.today.present} hadir dari ${s.today.total} catatan`}
          />
          <Stat label="Kelas sudah dicatat" value={s.today.classes_recorded} />
          <Stat label="Total catatan" value={s.today.total} />
        </div>
      </Card>
    </div>
  );
}
