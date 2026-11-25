import { useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, Button, Card, ErrorAlert, Field, Input, Table } from "../../components/ui";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import {
  type AttemptAnswer,
  type AttemptRow,
  type Analysis,
  type ExamDetail,
  type Question,
  formatWhen,
} from "./types";

export function ExamDetailPage() {
  const { id = "" } = useParams();
  const detail = useApiQuery<ExamDetail>(["exam", id], `/exams/${id}`);
  const attempts = useApiQuery<AttemptRow[]>(["exam-attempts", id], `/exams/${id}/attempts`);
  const analysis = useApiQuery<Analysis>(["exam-analysis", id], `/exams/${id}/analysis`);
  const bank = useApiQuery<Question[]>(
    ["bank", detail.data?.subject_id ?? ""],
    detail.data ? `/questions?subject_id=${detail.data.subject_id}` : null,
  );

  const [picked, setPicked] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isDraft = detail.data?.status === "draft";
  const selected = picked ?? detail.data?.questions.map((q) => q.question_id) ?? [];

  const invalidate = [["exam", id], ["exams"], ["exam-analysis", id]];
  const saveQuestions = useApiMutation<void, ExamDetail>(
    { method: "PUT", path: () => `/exams/${id}/questions`, body: () => ({ question_ids: selected }) },
    invalidate,
  );
  const publish = useApiMutation<void, unknown>(
    { method: "POST", path: () => `/exams/${id}/publish` },
    invalidate,
  );

  if (detail.isPending) return <p className="text-sm text-slate-500">Memuat paket…</p>;
  if (detail.isError) return <ErrorAlert error={detail.error} />;
  const exam = detail.data;

  const toggle = (qid: string) =>
    setPicked((prev) => {
      const base = prev ?? selected;
      return base.includes(qid) ? base.filter((x) => x !== qid) : [...base, qid];
    });

  const onSave = async () => {
    setNotice(null);
    await saveQuestions.mutateAsync();
    setPicked(null);
    setNotice("Susunan soal disimpan.");
  };

  const onPublish = async () => {
    if (!window.confirm("Terbitkan paket? Setelah terbit, soal dan pengaturan tidak bisa diubah.")) return;
    setNotice(null);
    await publish.mutateAsync();
    setNotice("Paket diterbitkan. Siswa di kelas ini sekarang bisa mengerjakan.");
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link to="/ujian" className="text-sm text-brand-700 hover:underline">← Semua paket</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{exam.title}</h1>
          <span className={isDraft ? "rounded-full bg-slate-100 px-2.5 py-0.5 text-xs" : "rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs text-emerald-800"}>
            {isDraft ? "Draf" : "Terbit"}
          </span>
        </div>
        <p className="text-sm text-slate-600">
          {exam.class_name} · {exam.subject_name} · {exam.duration_minutes} menit · {formatWhen(exam.window_start)} – {formatWhen(exam.window_end)}
        </p>
        {exam.token && <p className="text-sm text-slate-600">Token ujian: <span className="font-mono font-semibold">{exam.token}</span></p>}
      </header>

      <ErrorAlert error={saveQuestions.error ?? publish.error} />
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card
        title={`Soal paket (${exam.question_count} soal, ${exam.total_points} poin)`}
        description={isDraft ? "Centang soal dari bank untuk mapel ini. Urutan awal mengikuti urutan centang." : "Soal terkunci setelah paket diterbitkan."}
        actions={
          isDraft && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onSave} disabled={saveQuestions.isPending || selected.length === 0}>
                Simpan susunan
              </Button>
              <Button onClick={onPublish} disabled={publish.isPending || exam.question_count === 0}>
                Terbitkan
              </Button>
            </div>
          )
        }
      >
        {isDraft ? (
          <div className="grid gap-2 md:grid-cols-2">
            {bank.data?.length === 0 && <p className="text-sm text-slate-500">Belum ada soal di bank untuk mapel ini. Tambahkan di menu Bank soal.</p>}
            {bank.data?.map((q) => {
              const on = selected.includes(q.id);
              return (
                <label key={q.id} className="flex items-start gap-3 rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50">
                  <input type="checkbox" checked={on} onChange={() => toggle(q.id)} className="mt-1 size-4 text-brand-600" />
                  <span className="flex-1">
                    <span className="font-medium">{q.kind === "pg" ? "PG" : "Esai"} · {q.points} poin</span>
                    <span className="block text-slate-600">{q.body}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {exam.questions.map((q) => (
              <li key={q.question_id}>
                <span className="font-medium">{q.kind === "pg" ? "PG" : "Esai"} · {q.points} poin</span>: {q.body}
                {q.answer_key && <span className="ml-2 font-mono text-xs text-slate-500">kunci {q.answer_key}</span>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {!isDraft && (
        <AttemptsCard examId={id} attempts={attempts.data ?? []} onGraded={() => attempts.refetch()} />
      )}

      {!isDraft && analysis.data && (
        <Card
          title="Analisis butir soal"
          description={analysis.data.provisional ? "Sementara: jendela ujian masih berjalan." : "Berdasarkan percobaan yang sudah selesai."}
        >
          <p className="text-sm text-slate-600">{analysis.data.attempts} percobaan dianalisis.</p>
          <Table head={["No", "Jenis", "Percobaan", "Kesukaran", "Daya beda"]}>
            {analysis.data.items.map((i) => (
              <tr key={i.question_id}>
                <td className="px-4 py-2.5">{i.position}</td>
                <td className="px-4 py-2.5">{i.kind === "pg" ? "PG" : "Esai"}</td>
                <td className="px-4 py-2.5">{i.attempts}</td>
                <td className="px-4 py-2.5">{i.difficulty === null ? "—" : `${Math.round(i.difficulty * 100)}% benar`}</td>
                <td className="px-4 py-2.5">{i.discrimination === null ? "—" : i.discrimination.toFixed(2)}</td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-slate-500">Daya beda: selisih proporsi benar kelompok atas dan bawah (27% percobaan). Di atas 0,3 umumnya baik.</p>
        </Card>
      )}
    </div>
  );
}

function AttemptsCard({ examId, attempts, onGraded }: { examId: string; attempts: AttemptRow[]; onGraded: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title={`Percobaan siswa (${attempts.length})`} description="Esai yang dijawab siswa harus dinilai manual.">
      {attempts.length === 0 && <p className="text-sm text-slate-500">Belum ada siswa yang mengerjakan.</p>}
      {attempts.length > 0 && (
        <Table head={["Siswa", "Status", "Mulai", "Dikumpulkan", "Skor", "Pindah tab", ""]}>
          {attempts.map((a) => (
            <tr key={a.attempt_id}>
              <td className="px-4 py-2.5">
                <span className="font-medium">{a.student_name}</span> <span className="font-mono text-xs text-slate-500">{a.nis}</span>
              </td>
              <td className="px-4 py-2.5">
                {a.status === "in_progress" ? "Berlangsung" : a.status === "submitted" ? "Dikumpulkan" : "Waktu habis"}
                {a.pending_essays > 0 && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">{a.pending_essays} esai belum dinilai</span>}
              </td>
              <td className="px-4 py-2.5 text-slate-600">{formatWhen(a.started_at)}</td>
              <td className="px-4 py-2.5 text-slate-600">{a.submitted_at ? formatWhen(a.submitted_at) : "—"}</td>
              <td className="px-4 py-2.5">{a.graded && a.score !== null ? a.score : <span className="text-slate-400">belum final</span>}</td>
              <td className="px-4 py-2.5">{a.events}</td>
              <td className="px-4 py-2.5 text-right">
                <Button variant="ghost" onClick={() => setOpen(open === a.attempt_id ? null : a.attempt_id)}>
                  {open === a.attempt_id ? "Tutup" : "Jawaban"}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {open && <AttemptAnswers examId={examId} attemptId={open} onGraded={onGraded} />}
    </Card>
  );
}

function AttemptAnswers({ examId, attemptId, onGraded }: { examId: string; attemptId: string; onGraded: () => void }) {
  const answers = useApiQuery<AttemptAnswer[]>(["attempt-answers", attemptId], `/exams/${examId}/attempts/${attemptId}`);
  const [scores, setScores] = useState<Record<string, string>>({});
  const grade = useApiMutation<{ qid: string; score: number }, unknown>(
    {
      method: "PUT",
      path: ({ qid }) => `/attempts/${attemptId}/answers/${qid}/score`,
      body: ({ score }) => ({ score }),
    },
    [["attempt-answers", attemptId], ["exam-attempts", examId]],
  );

  if (answers.isPending) return <p className="text-sm text-slate-500">Memuat jawaban…</p>;
  if (answers.isError) return <ErrorAlert error={answers.error} />;

  return (
    <div className="mt-4 space-y-4">
      <ErrorAlert error={grade.error} />
      {answers.data?.map((a) => (
        <div key={a.question_id} className="rounded-lg p-4 ring-1 ring-slate-200">
          <p className="text-sm font-medium">{a.position}. {a.body} <span className="text-slate-500">({a.points} poin)</span></p>
          <p className="mt-1 text-sm text-slate-700">
            Jawaban: <span className="font-mono">{a.answer ?? "(kosong)"}</span>
            {a.kind === "pg" && a.score !== null && <span className="ml-2 text-slate-500">skor {a.score}</span>}
          </p>
          {a.kind === "esai" && a.answer && (
            <div className="mt-3 flex items-end gap-3">
              <Field label="Skor">
                <Input
                  type="number"
                  min={0}
                  max={a.points}
                  value={scores[a.question_id] ?? (a.score ?? "")}
                  onChange={(e) => setScores((s) => ({ ...s, [a.question_id]: e.target.value }))}
                />
              </Field>
              <Button
                onClick={async () => {
                  await grade.mutateAsync({ qid: a.question_id, score: Number(scores[a.question_id] ?? a.score ?? 0) });
                  onGraded();
                }}
                disabled={grade.isPending}
              >
                Simpan nilai
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
