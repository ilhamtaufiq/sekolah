import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Button, Card, Table, PageHeader } from "../../components/kit";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { downloadPdf } from "./api";

type GagalSiswa = { nis: string; nama: string; pesan: string };

type CetakJob = {
  id: string;
  class_name: string;
  semester_name: string;
  status: "antrean" | "proses" | "selesai" | "gagal";
  total: number;
  selesai: number;
  errors: GagalSiswa[] | null;
  error_message: string | null;
  created_by_name: string;
  created_at: string;
  finished_at: string | null;
};

const STATUS_LABEL: Record<CetakJob["status"], string> = {
  antrean: "Antrean",
  proses: "Diproses",
  selesai: "Selesai",
  gagal: "Gagal",
};

const STATUS_CLASS: Record<CetakJob["status"], string> = {
  antrean: "bg-slate-100 text-slate-700",
  proses: "bg-brand-50 text-brand-700",
  selesai: "bg-emerald-50 text-emerald-700",
  gagal: "bg-red-50 text-red-700",
};

const AKTIF = ["antrean", "proses"];

export function CetakMassalPage() {
  const { token } = useAuth();
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Daftar diperbarui tiap 3 detik selama masih ada job yang antre atau berjalan.
  const jobs = useQuery<CetakJob[]>({
    queryKey: ["cetak-massal-jobs"],
    queryFn: () => api<CetakJob[]>("/cetak-massal/jobs", { token }),
    enabled: !!token,
    refetchInterval: (query) => (query.state.data?.some((j) => AKTIF.includes(j.status)) ? 3000 : false),
  });

  const onDownload = async (job: CetakJob) => {
    setDownloadError(null);
    try {
      await downloadPdf(`/cetak-massal/jobs/${job.id}/unduh`, token, `rapor-${job.class_name}-${job.semester_name}.zip`);
    } catch (e) {
      setDownloadError(e instanceof ApiError ? e.message : "Unduh gagal.");
    }
  };

  const formatWaktu = (iso: string) => new Date(iso).toLocaleString("id-ID");

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Raport" title="Cetak massal" description="Antrean cetak rapor satu kelas. Admin melihat semua job sekolah, wali kelas hanya job miliknya." />

      {downloadError && <Alert tone="error">{downloadError}</Alert>}
      {jobs.error && <Alert tone="error">{jobs.error instanceof ApiError ? jobs.error.message : "Daftar job gagal dimuat."}</Alert>}

      <Card title="Daftar job" description="Satu sekolah hanya memproses satu job pada satu waktu.">
        {jobs.data && jobs.data.length === 0 && <p className="text-sm text-slate-500">Belum ada job cetak massal.</p>}
        {jobs.data && jobs.data.length > 0 && (
          <Table head={["Kelas dan semester", "Status", "Progres", "Dibuat", ""]}>
            {jobs.data.map((job) => (
              <tr key={job.id} className="align-top">
                <td className="px-4 py-2.5">
                  <p className="font-medium">{job.class_name}</p>
                  <p className="text-xs text-slate-500">
                    {job.semester_name} · oleh {job.created_by_name}
                  </p>
                  {job.error_message && <p className="mt-1 text-xs text-red-700">{job.error_message}</p>}
                  {job.errors && job.errors.length > 0 && (
                    <details className="mt-1 text-xs text-slate-600">
                      <summary className="cursor-pointer">{job.errors.length} siswa gagal</summary>
                      <ul className="mt-1 list-disc pl-5">
                        {job.errors.map((g) => (
                          <li key={g.nis}>
                            {g.nama} ({g.nis}): {g.pesan}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[job.status]}`}>
                    {STATUS_LABEL[job.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 tabular-nums">
                  {job.selesai}/{job.total}
                </td>
                <td className="px-4 py-2.5">{formatWaktu(job.created_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  {job.status === "selesai" && (
                    <Button variant="secondary" onClick={() => onDownload(job)}>
                      Unduh ZIP
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
