import { useState } from "react";
import { Alert, Button, ErrorAlert, Table } from "../../components/kit";
import { useAuth } from "../../lib/auth";
import { useApiQuery } from "../../lib/hooks";
import { downloadPdf } from "./api";

type MyReport = {
  id: string;
  semester_name: string;
  academic_year: string;
  format_version: number;
  generated_at: string;
};

/** Raport milik siswa yang sedang login. Hanya raportnya sendiri yang bisa diunduh. */
export function MyReportsPage() {
  const { token } = useAuth();
  const reports = useApiQuery<MyReport[]>(["my-reports"], "/me/report-cards");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const download = async (r: MyReport) => {
    setDownloadError(null);
    setDownloading(r.id);
    try {
      await downloadPdf(`/report-cards/${r.id}/pdf`, token, `raport-${r.academic_year}-${r.semester_name}.pdf`.replace(/[\s/]+/g, "-"));
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Gagal mengunduh raport.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">Akademik</p>
        <h1 className="text-2xl font-semibold tracking-tight">Raport saya</h1>
      </header>

      <ErrorAlert error={reports.error} />
      {downloadError && <Alert tone="error">{downloadError}</Alert>}

      {reports.data && reports.data.length === 0 && (
        <Alert tone="info">Belum ada raport yang diterbitkan untuk Anda.</Alert>
      )}
      {reports.data && reports.data.length > 0 && (
        <Table head={["Tahun ajaran", "Semester", "Dibuat", ""]}>
          {reports.data.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3">{r.academic_year}</td>
              <td className="px-4 py-3 font-medium">{r.semester_name}</td>
              <td className="px-4 py-3 text-slate-600">{new Date(r.generated_at).toLocaleDateString("id-ID")}</td>
              <td className="px-4 py-3 text-right">
                <Button variant="secondary" onClick={() => void download(r)} disabled={downloading === r.id}>
                  {downloading === r.id ? "Mengunduh…" : "Unduh PDF"}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
