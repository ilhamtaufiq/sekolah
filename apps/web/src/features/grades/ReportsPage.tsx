import { useEffect, useState } from "react";
import { Alert, Button, Card, ErrorAlert, Field, Select, Table } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import type { ClassRow } from "../academic/types";
import { downloadPdf } from "./api";
import type { ReportCard, Semester, TermNote } from "./types";

type Draft = { attitude: string; extracurricular: string; homeroom_note: string };

export function ReportsPage() {
  const { token, user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "wali_kelas";

  const classes = useApiQuery<ClassRow[]>(["classes"], "/classes");
  const semesters = useApiQuery<Semester[]>(["semesters"], "/semesters");
  const [classId, setClassId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const effClass = classId || classes.data?.[0]?.id || "";
  const effSemester = semesterId || semesters.data?.find((s) => s.ordinal === 1)?.id || semesters.data?.[0]?.id || "";

  const notes = useApiQuery<TermNote[]>(
    ["term-notes", effClass, effSemester],
    effClass && effSemester ? `/term-notes?class_id=${effClass}&semester_id=${effSemester}` : null,
  );
  const cards = useApiQuery<ReportCard[]>(
    ["report-cards", effClass, effSemester],
    effClass && effSemester ? `/report-cards?class_id=${effClass}&semester_id=${effSemester}` : null,
  );

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!notes.data) return;
    const next: Record<string, Draft> = {};
    for (const n of notes.data) {
      next[n.student_id] = {
        attitude: n.attitude ?? "",
        extracurricular: n.extracurricular ?? "",
        homeroom_note: n.homeroom_note ?? "",
      };
    }
    setDrafts(next);
  }, [notes.data]);

  const saveNotes = useApiMutation<void, unknown>(
    {
      method: "PUT",
      path: () => "/term-notes",
      body: () => ({
        class_id: effClass,
        semester_id: effSemester,
        notes: Object.entries(drafts).map(([student_id, d]) => ({ student_id, ...d })),
      }),
    },
    [["term-notes", effClass, effSemester]],
  );

  const generate = useApiMutation<void, ReportCard[]>(
    { method: "POST", path: () => "/report-cards/generate", body: () => ({ class_id: effClass, semester_id: effSemester }) },
    [["report-cards", effClass, effSemester]],
  );

  const onSave = async () => {
    setNotice(null);
    await saveNotes.mutateAsync();
    setNotice("Catatan tersimpan.");
  };

  const onGenerate = async () => {
    setNotice(null);
    const made = await generate.mutateAsync();
    setNotice(`${made.length} raport dibuat.`);
  };

  const onDownload = async (card: ReportCard) => {
    setDownloadError(null);
    try {
      await downloadPdf(`/report-cards/${card.id}/pdf`, token, `raport-${card.nis}.pdf`);
    } catch (e) {
      setDownloadError(e instanceof ApiError ? e.message : "Unduh gagal.");
    }
  };

  const setField = (studentId: string, field: keyof Draft, value: string) =>
    setDrafts((d) => ({ ...d, [studentId]: { ...(d[studentId] ?? { attitude: "", extracurricular: "", homeroom_note: "" }), [field]: value } }));

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">Raport</p>
        <h1 className="text-2xl font-semibold tracking-tight">Catatan dan raport</h1>
        <p className="text-sm text-slate-600">
          Isi sikap, ekstrakurikuler, dan catatan wali kelas. Ketidakhadiran diambil dari absensi harian.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Kelas">
          <Select value={effClass} onChange={(e) => setClassId(e.target.value)}>
            {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Semester">
          <Select value={effSemester} onChange={(e) => setSemesterId(e.target.value)}>
            {semesters.data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.ordinal})</option>)}
          </Select>
        </Field>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorAlert error={saveNotes.error ?? generate.error} />
      {downloadError && <Alert tone="error">{downloadError}</Alert>}

      <Card
        title="Catatan semester"
        description="Sikap dan ekstrakurikuler bisa diisi wali kelas atau admin."
        actions={canEdit && <Button onClick={onSave} disabled={saveNotes.isPending || !notes.data?.length}>{saveNotes.isPending ? "Menyimpan…" : "Simpan catatan"}</Button>}
      >
        {notes.data && notes.data.length === 0 && <p className="text-sm text-slate-500">Kelas ini belum punya siswa.</p>}
        {notes.data?.map((n) => {
          const d = drafts[n.student_id] ?? { attitude: "", extracurricular: "", homeroom_note: "" };
          return (
            <div key={n.student_id} className="grid gap-3 rounded-lg p-3 ring-1 ring-slate-200 md:grid-cols-[200px_1fr]">
              <div>
                <p className="font-medium">{n.name}</p>
                <p className="font-mono text-xs text-slate-500">{n.nis}</p>
                <p className="mt-2 text-xs text-slate-600">
                  Sakit {n.absences.sakit} · Izin {n.absences.izin} · Alpa {n.absences.alpa}
                </p>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <label className="text-xs text-slate-600">
                  Sikap
                  <textarea disabled={!canEdit} value={d.attitude} onChange={(e) => setField(n.student_id, "attitude", e.target.value)} rows={3} maxLength={1000} className="mt-1 block w-full rounded-md px-2 py-1.5 text-sm ring-1 ring-inset ring-slate-300 disabled:bg-slate-100" />
                </label>
                <label className="text-xs text-slate-600">
                  Ekstrakurikuler
                  <textarea disabled={!canEdit} value={d.extracurricular} onChange={(e) => setField(n.student_id, "extracurricular", e.target.value)} rows={3} maxLength={1000} className="mt-1 block w-full rounded-md px-2 py-1.5 text-sm ring-1 ring-inset ring-slate-300 disabled:bg-slate-100" />
                </label>
                <label className="text-xs text-slate-600">
                  Catatan wali kelas
                  <textarea disabled={!canEdit} value={d.homeroom_note} onChange={(e) => setField(n.student_id, "homeroom_note", e.target.value)} rows={3} maxLength={1000} className="mt-1 block w-full rounded-md px-2 py-1.5 text-sm ring-1 ring-inset ring-slate-300 disabled:bg-slate-100" />
                </label>
              </div>
            </div>
          );
        })}
      </Card>

      <Card
        title="Raport"
        description="Dibuat dari nilai akhir dan pengaturan format raport yang aktif saat ini."
        actions={canEdit && <Button onClick={onGenerate} disabled={generate.isPending || !notes.data?.length}>{generate.isPending ? "Membuat…" : "Buat raport kelas"}</Button>}
      >
        {cards.data && cards.data.length === 0 && <p className="text-sm text-slate-500">Belum ada raport untuk kelas dan semester ini.</p>}
        {cards.data && cards.data.length > 0 && (
          <Table head={["Siswa", "Format versi", "Dibuat", ""]}>
            {cards.data.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2.5 font-medium">{c.name} <span className="font-mono text-xs text-slate-500">{c.nis}</span></td>
                <td className="px-4 py-2.5">v{c.format_version}</td>
                <td className="px-4 py-2.5">{new Date(c.generated_at).toLocaleString("id-ID")}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button variant="secondary" onClick={() => onDownload(c)}>Unduh PDF</Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
