import { ApiError } from "../../lib/api";
import { Alert, Button, Card } from "../../components/kit";
import { useReportFormatHistory, useRestoreReportFormat } from "./api";

export function HistoryPanel({ canRestore, currentVersion }: { canRestore: boolean; currentVersion: number }) {
  const history = useReportFormatHistory();
  const restore = useRestoreReportFormat();

  const onRestore = (version: number) => {
    if (!window.confirm(`Pulihkan isi v${version} menjadi versi aktif baru? Versi lama tetap tersimpan.`)) return;
    restore.mutate({ version, expectedVersion: currentVersion });
  };

  const restoreError = restore.error instanceof ApiError ? restore.error : null;

  return (
    <Card title="Riwayat" description="Setiap perubahan tercatat. Pemulihan membuat versi baru, tidak menghapus sejarah.">
      {restoreError && <Alert tone="error">{restoreError.message}</Alert>}
      {history.isPending && <p className="text-sm text-slate-500">Memuat riwayat…</p>}
      {history.isError && <Alert tone="error">Gagal memuat riwayat.</Alert>}
      {history.data && history.data.length === 0 && (
        <p className="text-sm text-slate-500">Belum ada perubahan. Sekolah memakai pengaturan default.</p>
      )}
      <ul className="space-y-3">
        {history.data?.map((h) => (
          <li key={h.version} className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-slate-900">
                v{h.version}
                {h.version === currentVersion && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">aktif</span>}
                {h.action === "restore" && <span className="ml-2 text-xs text-slate-500">(dipulihkan)</span>}
              </p>
              <p className="truncate text-xs text-slate-500">
                {h.changed_by ?? "—"} · {new Date(h.changed_at).toLocaleString("id-ID")}
              </p>
              <p className="truncate text-xs text-slate-500">{h.config.kop.title}</p>
            </div>
            {canRestore && h.version !== currentVersion && (
              <Button variant="secondary" onClick={() => onRestore(h.version)} disabled={restore.isPending}>
                Pulihkan
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
