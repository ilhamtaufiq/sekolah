import { Link } from "react-router";
import { Card, EmptyState, PageHeader, StatStrip } from "../../components/ui";
import { useApiQuery } from "../../lib/hooks";
import { formatDate, type Summary } from "../academic/types";

type JournalRow = { id: string };

type Task = { label: string; count: number; detail: string; to: string };

export function DashboardPage() {
  const summary = useApiQuery<Summary>(["summary"], "/dashboard/summary");
  const pending = useApiQuery<JournalRow[]>(["jurnal", "menunggu"], "/jurnal?status=menunggu");

  if (summary.isPending) return <p className="text-sm text-slate-500">Memuat ringkasan…</p>;
  if (summary.isError) return <p className="text-sm text-red-700">Gagal memuat ringkasan.</p>;
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
        <h2 id="perlu-tindakan" className="text-sm font-semibold text-slate-900">
          Perlu tindakan
        </h2>
        {tasks.length === 0 ? (
          <EmptyState title="Tidak ada yang menunggu tindakan.">Jurnal, absensi, dan tahun ajaran sudah beres.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {tasks.map((t) => (
              <li key={t.label}>
                <Link to={t.to} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50">
                  <span className="w-12 shrink-0 text-2xl font-semibold tabular-nums text-slate-900">{t.count}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-900">{t.label}</span>
                    <span className="block text-sm text-slate-500">{t.detail}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-brand-700">Buka →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ringkasan-angka" className="space-y-3">
        <h2 id="ringkasan-angka" className="text-sm font-semibold text-slate-900">
          Sekolah saat ini
        </h2>
        <StatStrip
          items={[
            { label: "Siswa aktif", value: s.active_students },
            { label: "Kelas", value: s.classes, hint: "Tahun ajaran aktif" },
            { label: "Guru & wali kelas", value: s.teachers, hint: "Akun aktif" },
            { label: "Penugasan", value: s.assignments, hint: "Mapel per kelas" },
          ]}
        />
      </section>

      <Card title="Kehadiran hari ini" description="Dari absensi harian yang sudah dicatat wali kelas.">
        {s.today.total === 0 ? (
          <p className="text-sm text-slate-600">Belum ada catatan absensi hari ini.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm text-slate-600">
                  {s.today.present} hadir dari {s.today.total} catatan
                </p>
                <p className="text-lg font-semibold tabular-nums text-slate-900">{rate === null ? "—" : `${rate}%`}</p>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Persentase hadir ${rate ?? 0} persen`}>
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${rate ?? 0}%` }} />
              </div>
            </div>
            <p className="text-sm text-slate-500">
              {s.today.classes_recorded} dari {s.classes} kelas sudah dicatat.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
