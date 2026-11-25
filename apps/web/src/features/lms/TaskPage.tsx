import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Alert, Button, Card, ErrorAlert, Field, Input, Table } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import { downloadFile, formatBytes, formatDateTime, type FileItem } from "./files";
import { useToken } from "./useToken";
import type { Task } from "./RoomsPage";

type Submission = {
  id: string;
  student_id: string;
  student_name: string;
  text_body: string | null;
  submitted_at: string;
  is_late: boolean;
  score: number | null;
  feedback: string | null;
  graded_at: string | null;
  files: FileItem[];
};

type TaskDetail = {
  task: Task;
  submissions: Submission[];
  own_submission: Submission | null;
  manage: boolean;
};

export function TaskPage() {
  const { id = "" } = useParams();
  const token = useToken();
  const detail = useApiQuery<TaskDetail>(["lms-task", id], `/lms/tasks/${id}`);

  if (detail.isPending) return <p className="text-sm text-slate-500">Memuat tugas…</p>;
  if (detail.isError) return <Alert tone="error">{detail.error.message}</Alert>;
  const d = detail.data;

  return (
    <div className="space-y-6">
      <header>
        <Link to="/ruang-kelas" className="text-sm text-brand-700 hover:underline">← Ruang kelas</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{d.task.title}</h1>
        <p className="text-sm text-slate-600">
          Tenggat {formatDateTime(d.task.due_at)} · nilai maksimum {d.task.max_score}
          {d.task.allow_late ? " · menerima terlambat" : " · tidak menerima terlambat"}
        </p>
      </header>

      {d.task.instructions && (
        <Card title="Instruksi">
          <p className="whitespace-pre-line text-sm text-slate-700">{d.task.instructions}</p>
        </Card>
      )}

      {d.manage ? (
        <SubmissionsTable taskId={id} submissions={d.submissions} maxScore={d.task.max_score} token={token} />
      ) : (
        <StudentSubmission taskId={id} own={d.own_submission} token={token} dueAt={d.task.due_at} allowLate={d.task.allow_late} />
      )}
    </div>
  );
}

function FileList({ files, token }: { files: FileItem[]; token: string | null }) {
  const [error, setError] = useState<string | null>(null);
  if (files.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <div className="space-y-1">
      {error && <p className="text-xs text-red-700">{error}</p>}
      {files.map((f) => (
        <button
          key={f.id}
          type="button"
          className="block text-left text-sm text-brand-700 hover:underline"
          onClick={() => downloadFile(f.id, token, f.file_name).catch((e: ApiError) => setError(e.message))}
        >
          {f.file_name} <span className="text-xs text-slate-500">({formatBytes(f.size_bytes)})</span>
        </button>
      ))}
    </div>
  );
}

function SubmissionsTable({ taskId, submissions, maxScore, token }: { taskId: string; submissions: Submission[]; maxScore: number; token: string | null }) {
  if (submissions.length === 0) return <Alert tone="info">Belum ada pengumpulan.</Alert>;
  return (
    <Card title={`Pengumpulan (${submissions.length})`} description="Nilai dibatasi 0 sampai nilai maksimum tugas.">
      <Table head={["Siswa", "Dikumpulkan", "Jawaban", "Berkas", "Nilai"]}>
        {submissions.map((s) => (
          <GradeRow key={s.id} submission={s} maxScore={maxScore} taskId={taskId} token={token} />
        ))}
      </Table>
    </Card>
  );
}

function GradeRow({ submission: s, maxScore, taskId, token }: { submission: Submission; maxScore: number; taskId: string; token: string | null }) {
  const [score, setScore] = useState(s.score === null ? "" : String(s.score));
  const [feedback, setFeedback] = useState(s.feedback ?? "");
  const grade = useApiMutation<void, Submission>(
    {
      method: "PUT",
      path: () => `/lms/submissions/${s.id}/grade`,
      body: () => ({ score: Number(score), feedback: feedback || null }),
    },
    [["lms-task", taskId]],
  );
  return (
    <tr className="align-top">
      <td className="px-4 py-3 font-medium">{s.student_name}</td>
      <td className="px-4 py-3">
        {formatDateTime(s.submitted_at)}
        {s.is_late && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Terlambat</span>}
      </td>
      <td className="max-w-xs px-4 py-3 text-sm text-slate-700">{s.text_body ?? <span className="text-slate-400">—</span>}</td>
      <td className="px-4 py-3"><FileList files={s.files} token={token} /></td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input type="number" min={0} max={maxScore} step="any" value={score} onChange={(e) => setScore(e.target.value)} className="w-24" aria-label={`Nilai ${s.student_name}`} />
            <Button onClick={() => grade.mutate()} disabled={grade.isPending || score === ""}>Simpan</Button>
          </div>
          <Input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Umpan balik" aria-label={`Umpan balik ${s.student_name}`} />
          <ErrorAlert error={grade.error} />
        </div>
      </td>
    </tr>
  );
}

function StudentSubmission({ taskId, own, token, dueAt, allowLate }: { taskId: string; own: Submission | null; token: string | null; dueAt: string; allowLate: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const graded = own?.score !== null && own?.score !== undefined;
  const closed = new Date(dueAt).getTime() < Date.now();
  const blocked = closed && !allowLate;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setError(null);
    setPending(true);
    try {
      const form = new FormData();
      form.append("text", text);
      files.forEach((f) => form.append("file", f));
      const res = await fetch(`/api/lms/tasks/${taskId}/submission`, {
        method: "PUT",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(res.status, data.error ?? "unknown", data.message ?? "Gagal mengumpulkan", data.details ?? []);
      }
      setSaved(true);
      setText("");
      setFiles([]);
      await qc.invalidateQueries({ queryKey: ["lms-task", taskId] });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "unknown", "Gagal mengumpulkan", []));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6">
      {own && (
        <Card title="Pengumpulan Anda" description={`Dikumpulkan ${formatDateTime(own.submitted_at)}`}>
          <div className="space-y-2 text-sm">
            {own.is_late && <p className="text-amber-800">Dikumpulkan setelah tenggat.</p>}
            {own.text_body && <p className="whitespace-pre-line text-slate-700">{own.text_body}</p>}
            <FileList files={own.files} token={token} />
            {graded ? (
              <div className="rounded-lg bg-emerald-50 p-3 text-emerald-900 ring-1 ring-emerald-200">
                <p className="font-semibold">Nilai: {own.score}</p>
                {own.feedback && <p className="mt-1">{own.feedback}</p>}
              </div>
            ) : (
              <p className="text-slate-500">Belum dinilai. Anda masih bisa mengganti pengumpulan.</p>
            )}
          </div>
        </Card>
      )}

      {!graded && (
        <Card title={own ? "Ganti pengumpulan" : "Kumpulkan tugas"} description="Isi jawaban berupa teks, berkas, atau keduanya. Berkas maksimal 10 MB per file.">
          {blocked && <Alert tone="warning">Tenggat sudah lewat dan guru tidak menerima pengumpulan terlambat.</Alert>}
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Jawaban">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={20000} disabled={blocked} className="block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:bg-slate-100" />
            </Field>
            <Field label="Berkas" hint="pdf, docx, pptx, xlsx, png, jpg, txt. Maksimal 5 berkas.">
              <input
                type="file"
                multiple
                disabled={blocked}
                accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.txt"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))}
                className="text-sm"
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={blocked || pending || (text.trim() === "" && files.length === 0)}>
                {pending ? "Mengirim…" : "Kumpulkan"}
              </Button>
              {saved && <span className="text-sm text-emerald-700">Tersimpan.</span>}
            </div>
            {error && <ErrorAlert error={error} />}
          </form>
        </Card>
      )}
    </div>
  );
}
