import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
import { api } from "../../lib/api";
import { Button } from "../../components/kit";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type Progress = { viewed_pages: number; total_pages: number; percent: number; completed: boolean };

/**
 * Pembaca PDF per halaman. Setiap halaman yang tampil dilaporkan ke server.
 * Selesai bila semua halaman sudah pernah dibuka.
 */
export function PdfViewer({
  fileId,
  fileName,
  token,
  track,
  onChange,
}: {
  fileId: string;
  fileName: string;
  token: string | null;
  track: boolean;
  onChange?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Muat dokumen sekali per berkas.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/lms/files/${fileId}`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("berkas tidak bisa dibuka");
        const data = new Uint8Array(await res.arrayBuffer());
        const doc = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
        setPage(1);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "PDF gagal dimuat");
      }
    })();
    return () => {
      cancelled = true;
      docRef.current?.destroy?.();
      docRef.current = null;
    };
  }, [fileId, token]);

  // Gambar halaman aktif sesuai lebar kotak.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || numPages === 0) return;
    let cancelled = false;
    doc.getPage(page).then((pg: any) => {
      if (cancelled) return;
      const base = pg.getViewport({ scale: 1 });
      const width = Math.min(boxRef.current?.clientWidth ?? 720, 900);
      const viewport = pg.getViewport({ scale: width / base.width });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      return pg.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    }).catch(() => {
      if (!cancelled) setError("halaman tidak bisa ditampilkan");
    });
    return () => {
      cancelled = true;
    };
  }, [page, numPages]);

  // Lapor halaman yang sedang tampil.
  useEffect(() => {
    if (!track || numPages === 0) return;
    api<Progress>(`/lms/files/${fileId}/pdf-progress`, {
      method: "POST",
      token,
      body: { total_pages: numPages, pages: [page] },
    })
      .then((p) => {
        setProgress(p);
        onChangeRef.current?.();
      })
      .catch(() => undefined);
  }, [page, numPages, track, fileId, token]);

  return (
    <div className="space-y-3" ref={boxRef}>
      <p className="text-sm font-medium">{fileName}</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-center overflow-auto rounded-lg bg-slate-100 p-2">
        <canvas ref={canvasRef} className="max-w-full bg-white shadow" aria-label={`Halaman ${page} dari ${numPages}`} />
      </div>
      {numPages > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              ← Sebelumnya
            </Button>
            <span className="tabular-nums text-slate-600">
              Halaman {page} / {numPages}
            </span>
            <Button variant="secondary" onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages}>
              Berikutnya →
            </Button>
          </div>
          {track && progress && (
            <div className="flex items-center gap-2">
              <span className="text-slate-600">
                {progress.viewed_pages} dari {progress.total_pages} halaman dibuka ({progress.percent}%)
              </span>
              {progress.completed && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Selesai</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
