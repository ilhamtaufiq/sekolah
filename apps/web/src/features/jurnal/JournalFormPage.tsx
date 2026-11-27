import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, Button, Card, ErrorAlert, Field, Input, Select } from "../../components/kit";
import { useAuth } from "../../lib/auth";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import type { Assignment } from "../academic/types";
import {
  formatWaktu,
  todayIso,
  type Journal,
  type JournalInput,
} from "./types";
import { StatusBadge } from "./StatusBadge";

type Form = {
  assignmentId: string;
  date: string;
  hour: string;
  topic: string;
  notes: string;
  present: string;
};

const EMPTY_FORM: Form = { assignmentId: "", date: todayIso(), hour: "1", topic: "", notes: "", present: "" };

function toForm(j: Journal): Form {
  return {
    assignmentId: j.assignment_id,
    date: j.journal_date,
    hour: String(j.hour_no),
    topic: j.topic,
    notes: j.notes ?? "",
    present: j.present_count === null ? "" : String(j.present_count),
  };
}

function toInput(f: Form): JournalInput {
  return {
    journal_date: f.date,
    hour_no: Number(f.hour),
    topic: f.topic.trim(),
    notes: f.notes.trim() || null,
    present_count: f.present === "" ? null : Number(f.present),
  };
}

/** Form jurnal untuk guru. Route `/jurnal/baru` membuat jurnal baru, `/jurnal/:id` membuka yang sudah ada. */
export function JournalFormPage() {
  const { id = "" } = useParams();
  const isNew = id === "baru";
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeacher = user?.role === "guru" || user?.role === "wali_kelas";

  const journal = useApiQuery<Journal>(["jurnal", "detail", id], isNew ? null : `/jurnal/${id}`);
  const assignments = useApiQuery<Assignment[]>(
    ["assignments", "mine", user?.id ?? ""],
    isNew && user ? `/assignments?teacher_id=${user.id}` : null,
  );

  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    if (journal.data) setForm(toForm(journal.data));
  }, [journal.data]);

  const createMut = useApiMutation<JournalInput & { assignment_id: string }, Journal>(
    {
      method: "POST",
      path: () => "/jurnal",
      body: (v) => v,
    },
    [["jurnal"]],
  );
  const updateMut = useApiMutation<{ id: string; input: JournalInput }, Journal>(
    {
      method: "PUT",
      path: (v) => `/jurnal/${v.id}`,
      body: (v) => v.input,
    },
    [["jurnal"]],
  );
  const submitMut = useApiMutation<{ id: string }, Journal>(
    {
      method: "POST",
      path: (v) => `/jurnal/${v.id}/submit`,
    },
    [["jurnal"]],
  );

  const current = journal.data;
  const editable = isNew ? isTeacher : !!current && current.teacher_id === user?.id && (current.status === "draft" || current.status === "ditolak");
  const busy = createMut.isPending || updateMut.isPending || submitMut.isPending;

  /** Menyimpan isian: buat baru bila belum ada, atau perbarui. Mengembalikan id jurnal. */
  async function persist(): Promise<string> {
    const input = toInput(form);
    if (isNew) {
      if (!form.assignmentId) throw new Error("Pilih penugasan (kelas dan mapel) terlebih dahulu.");
      const created = await createMut.mutateAsync({ ...input, assignment_id: form.assignmentId });
      return created.id;
    }
    await updateMut.mutateAsync({ id, input });
    return id;
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSavedNote(null);
    try {
      const jid = await persist();
      setSavedNote("Draf tersimpan.");
      if (isNew) navigate(`/jurnal/${jid}`, { replace: true });
    } catch (err) {
      if (err instanceof Error && !("status" in err)) setFormError(err.message);
    }
  }

  async function onSend() {
    setFormError(null);
    setSavedNote(null);
    try {
      const jid = await persist();
      await submitMut.mutateAsync({ id: jid });
      navigate(`/jurnal/${jid}`, { replace: true });
      setSavedNote("Jurnal dikirim untuk persetujuan kepala sekolah.");
    } catch (err) {
      if (err instanceof Error && !("status" in err)) setFormError(err.message);
    }
  }

  if (!isNew && journal.isPending) return <p className="text-sm text-slate-500">Memuat jurnal…</p>;
  if (!isNew && journal.isError) return <Alert tone="error">{journal.error.message}</Alert>;

  const title = isNew ? "Catat jurnal" : "Jurnal mengajar";
  const mutationError = createMut.error ?? updateMut.error ?? submitMut.error;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/jurnal" className="text-sm text-brand-700 hover:underline">
            ← Kembali ke daftar jurnal
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1>
        </div>
        {current && <StatusBadge status={current.status} />}
      </div>

      {isNew && !isTeacher && (
        <Alert tone="info">Hanya guru pengajar yang dapat mencatat jurnal.</Alert>
      )}
      {current?.status === "menunggu" && (
        <Alert tone="info">Jurnal ini menunggu persetujuan kepala sekolah dan tidak bisa diubah sampai diputuskan.</Alert>
      )}
      {current?.status === "disetujui" && (
        <Alert tone="success">
          Disetujui oleh {current.decided_by_name ?? "kepala sekolah"} pada {formatWaktu(current.decided_at ?? current.updated_at)}.
          {current.decision_note && <> Catatan: {current.decision_note}</>} Jurnal tidak bisa diubah lagi.
        </Alert>
      )}
      {current?.status === "ditolak" && (
        <Alert tone="error">
          Ditolak oleh {current.decided_by_name ?? "kepala sekolah"} pada {formatWaktu(current.decided_at ?? current.updated_at)}.
          <br />
          Catatan: {current.decision_note}
          <br />
          Perbaiki isian lalu kirim ulang.
        </Alert>
      )}

      <form onSubmit={onSave}>
        <Card title="Isi jurnal" description="Tanggal, jam ke, dan materi wajib diisi. Jumlah hadir boleh dikosongkan.">
          {isNew ? (
            <Field label="Kelas dan mapel">
              <Select
                value={form.assignmentId}
                onChange={(e) => setForm({ ...form, assignmentId: e.target.value })}
                disabled={!editable || assignments.isPending}
                required
              >
                <option value="">Pilih penugasan…</option>
                {assignments.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.class_name} · {a.subject_name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Kelas dan mapel">
              <Input value={current ? `${current.class_name} · ${current.subject_name}` : ""} disabled readOnly />
            </Field>
          )}

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Tanggal">
              <Input
                type="date"
                value={form.date}
                max={todayIso()}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                disabled={!editable}
                required
              />
            </Field>
            <Field label="Jam ke" hint="1 sampai 20">
              <Input
                type="number"
                min={1}
                max={20}
                value={form.hour}
                onChange={(e) => setForm({ ...form, hour: e.target.value })}
                disabled={!editable}
                required
              />
            </Field>
            <Field label="Jumlah hadir" hint="Opsional">
              <Input
                type="number"
                min={0}
                value={form.present}
                onChange={(e) => setForm({ ...form, present: e.target.value })}
                disabled={!editable}
              />
            </Field>
          </div>

          <Field label="Materi">
            <Input
              value={form.topic}
              maxLength={200}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
              disabled={!editable}
              required
              placeholder="Contoh: Pecahan senilai dan penyederhanaan"
            />
          </Field>

          <Field label="Catatan" hint="Opsional, misalnya kejadian selama pembelajaran.">
            <textarea
              rows={4}
              maxLength={2000}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              disabled={!editable}
              className="block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:bg-slate-100"
            />
          </Field>

          {formError && <Alert tone="error">{formError}</Alert>}
          <ErrorAlert error={mutationError} />
          {savedNote && <Alert tone="success">{savedNote}</Alert>}

          {editable && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="submit" variant="secondary" disabled={busy || !isTeacher}>
                Simpan draf
              </Button>
              <Button type="button" onClick={onSend} disabled={busy || !isTeacher || !form.topic.trim()}>
                {current?.status === "ditolak" ? "Kirim ulang" : "Kirim untuk persetujuan"}
              </Button>
            </div>
          )}
        </Card>
      </form>
    </div>
  );
}
