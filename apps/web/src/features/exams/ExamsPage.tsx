import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Alert, Button, Card, ErrorAlert, Field, Input, Select, Table } from "../../components/ui";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import type { Assignment } from "../academic/types";
import { type ExamRow, formatWhen, toIso } from "./types";

export function ExamsPage() {
  const exams = useApiQuery<ExamRow[]>(["exams"], "/exams");
  const assignments = useApiQuery<Assignment[]>(["assignments", "mine"], "/assignments");

  const [assignmentId, setAssignmentId] = useState("");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("60");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [shuffleQ, setShuffleQ] = useState(true);
  const [shuffleO, setShuffleO] = useState(true);
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const create = useApiMutation<void, ExamRow>(
    {
      method: "POST",
      path: () => "/exams",
      body: () => ({
        assignment_id: assignmentId || assignments.data?.[0]?.id,
        title,
        duration_minutes: Number(duration),
        window_start: toIso(start),
        window_end: toIso(end),
        shuffle_questions: shuffleQ,
        shuffle_options: shuffleO,
        token: token.trim() || null,
      }),
    },
    [["exams"]],
  );

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    await create.mutateAsync();
    setNotice(`Paket "${title}" dibuat sebagai draf. Susun soalnya lalu terbitkan.`);
    setTitle("");
    setToken("");
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">Ujian</p>
        <h1 className="text-2xl font-semibold tracking-tight">Paket ujian</h1>
        <p className="text-sm text-slate-600">Waktu dihitung server. Siswa hanya bisa mengerjakan paket yang sudah diterbitkan.</p>
      </header>

      <ErrorAlert error={create.error} />
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card title="Paket baru">
        <form onSubmit={onCreate} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Kelas dan mapel">
            <Select value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} required>
              <option value="">Pilih penugasan</option>
              {assignments.data?.map((a) => (
                <option key={a.id} value={a.id}>{a.class_name} · {a.subject_name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Judul">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={200} />
          </Field>
          <Field label="Durasi (menit)" hint="1–600">
            <Input type="number" min={1} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} required />
          </Field>
          <Field label="Token ujian" hint="Opsional, 4–20 huruf/angka">
            <Input value={token} onChange={(e) => setToken(e.target.value)} maxLength={20} />
          </Field>
          <Field label="Dibuka">
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="Ditutup">
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </Field>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={shuffleQ} onChange={(e) => setShuffleQ(e.target.checked)} className="size-4 text-brand-600" />
              Acak urutan soal
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={shuffleO} onChange={(e) => setShuffleO(e.target.checked)} className="size-4 text-brand-600" />
              Acak urutan opsi
            </label>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={create.isPending || !start || !end}>Buat draf</Button>
          </div>
        </form>
      </Card>

      {exams.data && (
        <Table head={["Judul", "Kelas · mapel", "Jendela", "Soal", "Status", ""]}>
          {exams.data.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-slate-500">Belum ada paket ujian.</td>
            </tr>
          )}
          {exams.data.map((e) => (
            <tr key={e.id}>
              <td className="px-4 py-3 font-medium">{e.title}</td>
              <td className="px-4 py-3">{e.class_name} · {e.subject_name}</td>
              <td className="px-4 py-3 text-slate-600">{formatWhen(e.window_start)} – {formatWhen(e.window_end)}</td>
              <td className="px-4 py-3">{e.question_count} ({e.total_points} poin)</td>
              <td className="px-4 py-3">
                <span className={e.status === "published" ? "text-emerald-700" : "text-slate-500"}>
                  {e.status === "published" ? "Terbit" : "Draf"}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <Link to={`/ujian/${e.id}`} className="inline-flex items-center rounded-lg px-3.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
                  Kelola →
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
