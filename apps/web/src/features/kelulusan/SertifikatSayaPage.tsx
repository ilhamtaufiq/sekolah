import { useState } from "react";
import { Alert, Button, ErrorAlert, Table } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { useApiQuery } from "../../lib/hooks";
import { downloadPdf } from "../grades/api";

type Certificate = {
  id: string;
  nomor: string;
  tahun: number;
  academic_year: string;
  issued_at: string;
};

/** Sertifikat kelulusan milik siswa yang sedang login. Hanya miliknya sendiri yang bisa diunduh. */
export function SertifikatSayaPage() {
  const { token } = useAuth();
  const certificates = useApiQuery<Certificate[]>(["my-certificates"], "/me/certificates");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const download = async (c: Certificate) => {
    setDownloadError(null);
    setDownloading(c.id);
    try {
      await downloadPdf(
        `/certificates/${c.id}/pdf`,
        token,
        `sertifikat-${c.academic_year}.pdf`.replace(/[\s/]+/g, "-"),
      );
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Gagal mengunduh sertifikat.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">Akademik</p>
        <h1 className="text-2xl font-semibold tracking-tight">Sertifikat saya</h1>
      </header>

      <ErrorAlert error={certificates.error} />
      {downloadError && <Alert tone="error">{downloadError}</Alert>}

      {certificates.data && certificates.data.length === 0 && (
        <Alert tone="info">Belum ada sertifikat kelulusan untuk Anda.</Alert>
      )}
      {certificates.data && certificates.data.length > 0 && (
        <Table head={["Nomor sertifikat", "Tahun ajaran", "Diterbitkan", ""]}>
          {certificates.data.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3 font-mono text-sm font-medium">{c.nomor}</td>
              <td className="px-4 py-3">{c.academic_year}</td>
              <td className="px-4 py-3 text-slate-600">{new Date(c.issued_at).toLocaleDateString("id-ID")}</td>
              <td className="px-4 py-3 text-right">
                <Button variant="secondary" onClick={() => void download(c)} disabled={downloading === c.id}>
                  {downloading === c.id ? "Mengunduh…" : "Unduh PDF"}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
