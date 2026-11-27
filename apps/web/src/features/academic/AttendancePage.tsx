import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, ErrorAlert, Field, Input, Select, cn, PageHeader } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import {
  ATTENDANCE_CODES,
  type Assignment,
  type ClassRow,
  type SessionDetail,
  type SessionSummary,
  type Student,
} from "./types";

type Kind = "harian" | "mapel";

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function AttendancePage() {
  const { user } = useAuth();
  const [classId, setClassId] = useState("");
  const [kind, setKind] = useState<Kind>("harian");
  const [assignmentId, setAssignmentId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const classes = useApiQuery<ClassRow[]>(["classes"], "/classes");
  const effectiveClass = classId || classes.data?.[0]?.id || "";

  const assignments = useApiQuery<Assignment[]>(
    ["assignments", effectiveClass],
    effectiveClass ? `/assignments?class_id=${effectiveClass}` : null,
  );
  const roster = useApiQuery<Student[]>(
    ["roster", effectiveClass],
    effectiveClass ? `/classes/${effectiveClass}/students` : null,
  );

  const effectiveAssignment = kind === "mapel" ? assignmentId || assignments.data?.[0]?.id || "" : "";
  const sessions = useApiQuery<SessionSummary[]>(
    ["sessions", effectiveClass, date],
    effectiveClass ? `/attendance/sessions?class_id=${effectiveClass}&date=${date}` : null,
  );
  const existing = sessions.data?.find(
    (s) => s.kind === kind && (kind === "harian" || s.assignment_id === effectiveAssignment),
  );
  const detail = useApiQuery<SessionDetail>(
    ["session", existing?.id ?? ""],
    existing ? `/attendance/sessions/${existing.id}` : null,
  );

  // Muat status dari sesi yang sudah ada setiap kali pilihan berubah.
  useEffect(() => {
    if (detail.data) {
      const next: Record<string, string> = {};
      for (const r of detail.data.records) if (r.status) next[r.student_id] = r.status;
      setStatuses(next);
    } else {
      setStatuses({});
    }
    setSaved(false);
  }, [detail.data, effectiveClass, kind, effectiveAssignment, date]);

  const save = useApiMutation<void, SessionDetail>(
    {
      method: "PUT",
      path: () => "/attendance/sessions",
      body: () => ({
        kind,
        class_id: effectiveClass,
        assignment_id: kind === "mapel" ? effectiveAssignment : null,
        session_date: date,
        records: Object.entries(statuses).map(([student_id, status]) => ({ student_id, status })),
      }),
    },
    [["sessions", effectiveClass, date], ["session", existing?.id ?? ""], ["summary"]],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { H: 0, S: 0, I: 0, A: 0 };
    for (const s of Object.values(statuses)) c[s] = (c[s] ?? 0) + 1;
    return c;
  }, [statuses]);

  const canRecordHarian = user?.role === "admin" || user?.role === "wali_kelas";
  const canRecordMapel = user?.role === "admin" || user?.role === "guru" || user?.role === "wali_kelas";

  if (classes.data && classes.data.length === 0) {
    return <Alert tone="info">Belum ada kelas di tahun ajaran aktif.</Alert>;
  }

  const students = roster.data ?? [];
  const setStatus = (studentId: string, code: string) =>
    setStatuses((prev) => ({ ...prev, [studentId]: prev[studentId] === code ? "" : code }));

  const markAll = (code: string) => {
    const next: Record<string, string> = {};
    for (const s of students) next[s.id] = code;
    setStatuses(next);
  };

  const onSave = async () => {
    setSaved(false);
    await save.mutateAsync();
    setSaved(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Kehadiran" title="Absensi" description="Wali kelas mencatat absensi harian. Guru pengampu mencatat absensi per mapel." />

      <Card title="Pilih sesi">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Kelas">
            <Select value={effectiveClass} onChange={(e) => setClassId(e.target.value)}>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Jenis">
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="harian" disabled={!canRecordHarian}>Harian (wali kelas)</option>
              <option value="mapel" disabled={!canRecordMapel}>Per mapel</option>
            </Select>
          </Field>
          {kind === "mapel" && (
            <Field label="Mapel">
              <Select value={effectiveAssignment} onChange={(e) => setAssignmentId(e.target.value)}>
                {assignments.data?.length === 0 && <option value="">Belum ada penugasan</option>}
                {assignments.data?.map((a) => (
                  <option key={a.id} value={a.id}>{a.subject_name} · {a.teacher_name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Tanggal" hint="Tidak boleh di masa depan">
            <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
      </Card>

      <ErrorAlert error={save.error} />
      {saved && <Alert tone="success">Absensi tersimpan.</Alert>}
      {existing && !saved && (
        <Alert tone="info">
          Sesi ini sudah dicatat oleh {existing.recorded_by_name}. Perubahan akan memperbarui catatan yang ada.
        </Alert>
      )}

      {students.length === 0 && roster.data && (
        <Alert tone="warning">Kelas ini belum punya siswa. Tambahkan siswa di menu Kelas.</Alert>
      )}

      {students.length > 0 && (
        <Card
          title={`Daftar hadir · ${students.length} siswa`}
          description={`H ${counts.H} · S ${counts.S} · I ${counts.I} · A ${counts.A} · belum diisi ${students.length - Object.values(statuses).filter(Boolean).length}`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => markAll("H")}>Semua hadir</Button>
              <Button onClick={onSave} disabled={save.isPending || Object.values(statuses).filter(Boolean).length === 0}>
                {save.isPending ? "Menyimpan…" : "Simpan absensi"}
              </Button>
            </div>
          }
        >
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {students.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-[180px] flex-1">
                  <p className="font-medium">{s.name}</p>
                  <p className="font-mono text-xs text-slate-500">{s.nis}</p>
                </div>
                <div className="flex gap-1.5" role="group" aria-label={`Status ${s.name}`}>
                  {ATTENDANCE_CODES.map((c) => {
                    const active = statuses[s.id] === c.code;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        title={c.label}
                        aria-pressed={active}
                        onClick={() => setStatus(s.id, c.code)}
                        className={cn(
                          "size-9 rounded-lg text-sm font-semibold ring-1 ring-inset transition",
                          active
                            ? c.code === "H"
                              ? "bg-emerald-600 text-white ring-emerald-600"
                              : c.code === "A"
                                ? "bg-red-600 text-white ring-red-600"
                                : "bg-amber-500 text-white ring-amber-500"
                            : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50",
                        )}
                      >
                        {c.code}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">
            Keterangan: H hadir, S sakit, I izin, A alpa. Klik status yang sama lagi untuk mengosongkan.
          </p>
        </Card>
      )}
    </div>
  );
}
