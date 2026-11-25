import { useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, Card, ErrorAlert } from "../../components/ui";
import { useApiQuery } from "../../lib/hooks";

type PreviewQuestion = {
  id: string;
  position: number;
  kind: "pg" | "esai";
  body: string;
  points: number;
  options: { key: string; text: string }[];
};

type PreviewExam = {
  exam_id: string;
  title: string;
  duration_minutes: number;
  questions: PreviewQuestion[];
};

/**
 * Mode tes untuk guru dan admin: melihat paket seperti yang dilihat siswa.
 * Jawaban di sini tidak disimpan, tidak dikunci, tidak dicatat, dan tidak dinilai.
 */
export function PreviewExamPage() {
  const { id = "" } = useParams();
  const preview = useApiQuery<PreviewExam>(["exam-preview", id], `/exams/${id}/preview`);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  if (preview.isPending) return <p className="text-sm text-slate-500">Memuat…</p>;
  if (preview.isError) {
    return (
      <div className="space-y-4">
        <ErrorAlert error={preview.error} />
        <Link to={`/ujian/${id}`} className="text-sm text-brand-700 hover:underline">← Kembali ke paket</Link>
      </div>
    );
  }
  const exam = preview.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to={`/ujian/${id}`} className="text-sm text-brand-700 hover:underline">← Kembali ke paket</Link>
      <header className="space-y-1">
        <p className="text-sm text-slate-500">Mode tes</p>
        <h1 className="text-2xl font-semibold tracking-tight">{exam.title}</h1>
        <p className="text-sm text-slate-600">{exam.duration_minutes} menit · {exam.questions.length} soal</p>
      </header>

      <Alert tone="info">
        Mode tes tidak mengunci halaman, tidak mencatat kejadian, dan tidak membuat nilai. Jawaban di sini hanya ada di layar ini.
      </Alert>

      {exam.questions.length === 0 && <Alert tone="warning">Paket ini belum punya soal.</Alert>}

      {exam.questions.map((q) => (
        <Card key={q.id} title={`Soal ${q.position} · ${q.points} poin`}>
          <p className="whitespace-pre-wrap text-sm">{q.body}</p>
          {q.kind === "pg" ? (
            <div className="space-y-2">
              {q.options.map((o) => (
                <label key={o.key} className="flex items-start gap-3 rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50">
                  <input
                    type="radio"
                    name={q.id}
                    value={o.key}
                    checked={answers[q.id] === o.key}
                    onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.key }))}
                    className="mt-0.5"
                  />
                  <span><span className="font-semibold">{o.key}.</span> {o.text}</span>
                </label>
              ))}
            </div>
          ) : (
            <textarea
              aria-label={`Jawaban soal ${q.position}`}
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              rows={5}
              className="block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500"
            />
          )}
        </Card>
      ))}
    </div>
  );
}
