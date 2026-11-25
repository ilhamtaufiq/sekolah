import { useState, type FormEvent } from "react";
import { Button, Card, ErrorAlert, Field, Input, Select, Table, cn } from "../../components/ui";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import type { Subject } from "../academic/types";
import type { Question, QuestionOption } from "./types";

type Draft = {
  subject_id: string;
  kind: "pg" | "esai";
  body: string;
  points: string;
  options: QuestionOption[];
  answer_key: string;
};

const KEYS = ["A", "B", "C", "D", "E"];
const EMPTY = (subjectId: string): Draft => ({
  subject_id: subjectId,
  kind: "pg",
  body: "",
  points: "1",
  options: [
    { key: "A", text: "" },
    { key: "B", text: "" },
    { key: "C", text: "" },
    { key: "D", text: "" },
  ],
  answer_key: "A",
});

export function BankPage() {
  const subjects = useApiQuery<Subject[]>(["subjects"], "/subjects");
  const [subjectId, setSubjectId] = useState("");
  const activeSubject = subjectId || subjects.data?.[0]?.id || "";
  const questions = useApiQuery<Question[]>(
    ["questions", activeSubject],
    activeSubject ? `/questions?subject_id=${activeSubject}` : null,
  );

  const [editing, setEditing] = useState<Question | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY(""));
  const [saved, setSaved] = useState<string | null>(null);

  const body = () => ({
    subject_id: draft.subject_id,
    kind: draft.kind,
    body: draft.body,
    points: Number(draft.points),
    options: draft.kind === "pg" ? draft.options : null,
    answer_key: draft.kind === "pg" ? draft.answer_key : null,
  });
  const save = useApiMutation<void, Question>(
    {
      method: editing ? "PUT" : "POST",
      path: () => (editing ? `/questions/${editing.id}` : "/questions"),
      body,
    },
    [["questions", activeSubject]],
  );
  const remove = useApiMutation<string, unknown>(
    { method: "DELETE", path: (id) => `/questions/${id}` },
    [["questions", activeSubject]],
  );

  const reset = () => {
    setEditing(null);
    setDraft(EMPTY(activeSubject));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(null);
    await save.mutateAsync();
    setSaved(editing ? "Soal diperbarui." : "Soal ditambahkan.");
    reset();
  };

  const startEdit = (q: Question) => {
    setEditing(q);
    setDraft({
      subject_id: q.subject_id,
      kind: q.kind,
      body: q.body,
      points: String(q.points),
      options: q.options ?? EMPTY(q.subject_id).options,
      answer_key: q.answer_key ?? "A",
    });
  };

  const setOption = (i: number, text: string) =>
    setDraft((d) => ({ ...d, options: d.options.map((o, idx) => (idx === i ? { ...o, text } : o)) }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Ujian</p>
          <h1 className="text-2xl font-semibold tracking-tight">Bank soal</h1>
          <p className="text-sm text-slate-600">Soal dipakai ulang di beberapa paket. Soal yang sudah terbit di ujian tidak bisa diubah.</p>
        </div>
        <Field label="Mapel">
          <Select value={activeSubject} onChange={(e) => setSubjectId(e.target.value)} className="min-w-[200px]">
            {subjects.data?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
      </header>

      <ErrorAlert error={save.error ?? remove.error} />
      {saved && <p className="text-sm text-emerald-700">{saved}</p>}

      <Card title={editing ? "Ubah soal" : "Soal baru"}>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[180px_120px_1fr]">
            <Field label="Jenis">
              <Select value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as "pg" | "esai" }))}>
                <option value="pg">Pilihan ganda</option>
                <option value="esai">Esai</option>
              </Select>
            </Field>
            <Field label="Poin">
              <Input type="number" min={1} max={100} value={draft.points} onChange={(e) => setDraft((d) => ({ ...d, points: e.target.value }))} />
            </Field>
            <Field label="Isi soal">
              <textarea
                className="block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500"
                rows={3}
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                required
              />
            </Field>
          </div>

          {draft.kind === "pg" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Pilihan jawaban dan kunci</p>
              {draft.options.map((o, i) => (
                <div key={o.key} className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="answer_key"
                    aria-label={`Kunci ${o.key}`}
                    checked={draft.answer_key === o.key}
                    onChange={() => setDraft((d) => ({ ...d, answer_key: o.key }))}
                    className="size-4 text-brand-600"
                  />
                  <span className="w-6 font-mono text-sm font-semibold">{o.key}</span>
                  <Input value={o.text} onChange={(e) => setOption(i, e.target.value)} placeholder={`Teks opsi ${o.key}`} required />
                  {draft.options.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          options: d.options.filter((x) => x.key !== o.key),
                          answer_key: d.answer_key === o.key ? "A" : d.answer_key,
                        }))
                      }
                    >
                      Hapus
                    </Button>
                  )}
                </div>
              ))}
              {draft.options.length < 5 && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setDraft((d) => {
                      const used = d.options.map((o) => o.key);
                      const next = KEYS.find((k) => !used.includes(k));
                      return next ? { ...d, options: [...d.options, { key: next, text: "" }] } : d;
                    })
                  }
                >
                  Tambah opsi
                </Button>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending || !draft.subject_id}>{editing ? "Simpan perubahan" : "Tambah soal"}</Button>
            {editing && <Button type="button" variant="secondary" onClick={reset}>Batal</Button>}
          </div>
        </form>
      </Card>

      {questions.data && (
        <Table head={["#", "Jenis", "Soal", "Poin", "Kunci", ""]}>
          {questions.data.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-slate-500">Belum ada soal untuk mapel ini.</td>
            </tr>
          )}
          {questions.data.map((q, i) => (
            <tr key={q.id}>
              <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
              <td className="px-4 py-2.5">{q.kind === "pg" ? "PG" : "Esai"}</td>
              <td className={cn("max-w-md px-4 py-2.5", q.body.length > 80 && "truncate")}>{q.body}</td>
              <td className="px-4 py-2.5">{q.points}</td>
              <td className="px-4 py-2.5 font-mono">{q.answer_key ?? "—"}</td>
              <td className="space-x-1 px-4 py-2.5 text-right">
                <Button variant="ghost" onClick={() => startEdit(q)}>Ubah</Button>
                <Button variant="ghost" onClick={() => remove.mutate(q.id)} disabled={remove.isPending}>Hapus</Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
