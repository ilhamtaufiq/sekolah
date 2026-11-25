import { Link, useParams } from "react-router";
import { Alert, Card, ErrorAlert } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { useApiQuery } from "../../lib/hooks";
import { PdfViewer } from "./PdfViewer";
import { VideoPlayer } from "./VideoPlayer";

export type LessonItem = {
  id: string;
  position: number;
  kind: "video" | "pdf";
  title: string;
  material_id: string;
  file_id: string | null;
  youtube_id: string | null;
  progress: { percent: number; completed: boolean; viewed_pages: number | null; total_pages: number | null } | null;
};

export type LessonDetail = {
  id: string;
  title: string;
  description: string | null;
  items: LessonItem[];
  percent: number | null;
  completed: boolean | null;
};

/** Pembelajaran berurutan. Siswa melihat progres tiap item; guru melihat susunan materi. */
export function LessonPage() {
  const { id = "" } = useParams();
  const { token } = useAuth();
  const lesson = useApiQuery<LessonDetail>(["lesson", id], `/lms/lessons/${id}`);

  if (lesson.isPending) return <p className="text-sm text-slate-500">Memuat pembelajaran…</p>;
  if (lesson.isError) {
    return (
      <div className="space-y-4">
        <ErrorAlert error={lesson.error} />
        <Link to="/ruang-kelas" className="text-sm text-brand-700 hover:underline">← Ruang kelas</Link>
      </div>
    );
  }
  const data = lesson.data;
  const student = data.percent !== null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/ruang-kelas" className="text-sm text-brand-700 hover:underline">← Ruang kelas</Link>
      <header className="space-y-2">
        <p className="text-sm text-slate-500">Pembelajaran · {data.items.length} materi</p>
        <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>
        {data.description && <p className="whitespace-pre-line text-sm text-slate-600">{data.description}</p>}
        {student && (
          <div className="space-y-1 pt-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Progres pembelajaran: {data.percent}%</span>
              {data.completed && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Selesai</span>}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={data.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${data.percent ?? 0}%` }} />
            </div>
          </div>
        )}
      </header>

      {data.completed && <Alert tone="success">Anda sudah menyelesaikan semua materi pembelajaran ini.</Alert>}

      {data.items.map((item) => (
        <Card
          key={item.id}
          title={`${item.position}. ${item.kind === "video" ? "Video" : "PDF"} · ${item.title}`}
          description={
            item.progress
              ? item.progress.completed
                ? "Selesai"
                : item.kind === "video"
                  ? `Ditonton ${item.progress.percent}%. Tonton sampai habis.`
                  : `${item.progress.viewed_pages ?? 0} dari ${item.progress.total_pages ?? "?"} halaman dibuka.`
              : undefined
          }
        >
          {item.kind === "video" && item.youtube_id ? (
            <VideoPlayer
              materialId={item.material_id}
              youtubeId={item.youtube_id}
              token={token}
              track={student}
              onChange={() => void lesson.refetch()}
            />
          ) : item.file_id ? (
            <PdfViewer
              fileId={item.file_id}
              fileName={item.title}
              token={token}
              track={student}
              onChange={() => void lesson.refetch()}
            />
          ) : (
            <p className="text-sm text-slate-500">Materi ini tidak bisa ditampilkan.</p>
          )}
        </Card>
      ))}
    </div>
  );
}
