import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, ErrorAlert, Input, Table } from "../../components/kit";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import { type AttemptView, type StudentExam, formatWhen } from "./types";

function windowState(e: StudentExam, now: number): "belum" | "buka" | "tutup" {
  if (now < new Date(e.window_start).getTime()) return "belum";
  if (now >= new Date(e.window_end).getTime()) return "tutup";
  return "buka";
}

export function StudentExamsPage() {
  const exams = useApiQuery<StudentExam[]>(["student-exams"], "/student/exams");
  const navigate = useNavigate();
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const start = useApiMutation<{ examId: string; token: string }, AttemptView>(
    {
      method: "POST",
      path: ({ examId }) => `/student/exams/${examId}/start`,
      body: ({ token }) => ({ token: token || null }),
    },
    [["student-exams"]],
  );
  const now = Date.now();

  const onStart = async (e: StudentExam) => {
    const view = await start.mutateAsync({ examId: e.exam_id, token: tokens[e.exam_id] ?? "" });
    navigate(`/kerjakan/${view.attempt_id}`);
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">Ujian</p>
        <h1 className="text-2xl font-semibold tracking-tight">Ujian saya</h1>
        <p className="text-sm text-slate-600">Waktu mengerjakan dihitung server. Sisa waktu di layar hanya tampilan.</p>
      </header>

      <ErrorAlert error={start.error} />

      {exams.isPending && <p className="text-sm text-slate-500">Memuat…</p>}
      {exams.data && (
        <Table head={["Ujian", "Mapel", "Jendela", "Durasi", "Status", ""]}>
          {exams.data.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-slate-500">Belum ada ujian untuk kelas Anda.</td>
            </tr>
          )}
          {exams.data.map((e) => {
            const ws = windowState(e, now);
            const canStart = !e.attempt_id && ws === "buka";
            return (
              <tr key={e.exam_id}>
                <td className="px-4 py-3 font-medium">{e.title}</td>
                <td className="px-4 py-3">{e.subject_name}</td>
                <td className="px-4 py-3 text-slate-600">{formatWhen(e.window_start)} – {formatWhen(e.window_end)}</td>
                <td className="px-4 py-3">{e.duration_minutes} menit · {e.question_count} soal</td>
                <td className="px-4 py-3">
                  {e.attempt_status === "in_progress" && <span className="text-amber-700">Sedang dikerjakan</span>}
                  {e.attempt_status === "submitted" && <span className="text-emerald-700">Sudah dikumpulkan</span>}
                  {e.attempt_status === "expired" && <span className="text-slate-600">Waktu habis</span>}
                  {!e.attempt_id && ws === "belum" && <span className="text-slate-500">Belum dibuka</span>}
                  {!e.attempt_id && ws === "tutup" && <span className="text-slate-500">Sudah ditutup</span>}
                  {!e.attempt_id && ws === "buka" && <span className="text-brand-700">Dibuka</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {canStart && (
                    <div className="flex items-center justify-end gap-2">
                      {e.token_required && (
                        <Input
                          placeholder="Token"
                          aria-label={`Token ${e.title}`}
                          className="w-32"
                          value={tokens[e.exam_id] ?? ""}
                          onChange={(ev) => setTokens((t) => ({ ...t, [e.exam_id]: ev.target.value }))}
                        />
                      )}
                      <Button onClick={() => onStart(e)} disabled={start.isPending}>Mulai</Button>
                    </div>
                  )}
                  {e.attempt_id && e.attempt_status === "in_progress" && (
                    <Link to={`/kerjakan/${e.attempt_id}`} className="font-medium text-brand-700 hover:underline">Lanjutkan →</Link>
                  )}
                  {e.attempt_id && e.attempt_status !== "in_progress" && (
                    <Link to={`/kerjakan/${e.attempt_id}`} className="font-medium text-brand-700 hover:underline">Lihat →</Link>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
