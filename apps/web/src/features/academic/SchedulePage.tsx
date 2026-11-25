import { useState, type FormEvent } from "react";
import { Button, Card, ErrorAlert, Field, Input, Select, Table, Alert } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { toTime, useApiMutation, useApiQuery } from "../../lib/hooks";
import {
  DAYS,
  ROLE_LABELS,
  shortTime,
  type Assignment,
  type ClassRow,
  type ScheduleSlot,
  type StaffUser,
  type Subject,
} from "./types";

export function SchedulePage() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";

  const classes = useApiQuery<ClassRow[]>(["classes"], "/classes");
  const subjects = useApiQuery<Subject[]>(["subjects"], "/subjects");
  const staff = useApiQuery<StaffUser[]>(["staff", ""], canEdit ? "/users" : null);
  const teachers = (staff.data ?? []).filter((u) => (u.role === "guru" || u.role === "wali_kelas") && u.is_active);

  const [classId, setClassId] = useState("");
  const effectiveClass = classId || classes.data?.[0]?.id || "";

  const assignments = useApiQuery<Assignment[]>(
    ["assignments", effectiveClass],
    effectiveClass ? `/assignments?class_id=${effectiveClass}` : null,
  );
  const schedule = useApiQuery<ScheduleSlot[]>(
    ["schedules", effectiveClass],
    effectiveClass ? `/schedules?class_id=${effectiveClass}` : null,
  );

  // Form penugasan
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const addAssignment = useApiMutation<void, Assignment>(
    {
      method: "POST",
      path: () => "/assignments",
      body: () => ({ class_id: effectiveClass, subject_id: subjectId, teacher_id: teacherId }),
    },
    [["assignments", effectiveClass], ["summary"]],
  );
  const removeAssignment = useApiMutation<string, unknown>(
    { method: "DELETE", path: (id) => `/assignments/${id}` },
    [["assignments", effectiveClass], ["schedules", effectiveClass], ["summary"]],
  );

  // Form jadwal
  const [slotAssignment, setSlotAssignment] = useState("");
  const [day, setDay] = useState("1");
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("08:00");
  const [room, setRoom] = useState("");
  const addSlot = useApiMutation<void, ScheduleSlot>(
    {
      method: "POST",
      path: () => "/schedules",
      body: () => ({
        assignment_id: slotAssignment,
        day_of_week: Number(day),
        start_time: toTime(start),
        end_time: toTime(end),
        room: room || null,
      }),
    },
    [["schedules", effectiveClass]],
  );
  const removeSlot = useApiMutation<string, unknown>(
    { method: "DELETE", path: (id) => `/schedules/${id}` },
    [["schedules", effectiveClass], ["summary"]],
  );

  const onAssign = async (e: FormEvent) => {
    e.preventDefault();
    await addAssignment.mutateAsync();
    setSubjectId("");
    setTeacherId("");
  };

  const onSlot = async (e: FormEvent) => {
    e.preventDefault();
    await addSlot.mutateAsync();
    setRoom("");
  };

  const assignedSubjects = new Set((assignments.data ?? []).map((a) => a.subject_id));
  const freeSubjects = (subjects.data ?? []).filter((s) => !assignedSubjects.has(s.id));
  const sortedSlots = [...(schedule.data ?? [])].sort(
    (a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time),
  );

  if (classes.data && classes.data.length === 0) {
    return <Alert tone="info">Belum ada kelas di tahun ajaran aktif. Buat kelas dulu di menu Kelas.</Alert>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Akademik</p>
          <h1 className="text-2xl font-semibold tracking-tight">Penugasan dan jadwal</h1>
        </div>
        <Field label="Kelas">
          <Select value={effectiveClass} onChange={(e) => setClassId(e.target.value)} className="min-w-[180px]">
            {classes.data?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
      </header>

      <ErrorAlert error={addAssignment.error ?? removeAssignment.error ?? addSlot.error ?? removeSlot.error} />

      <Card title="Guru per mapel" description="Setiap mapel di kelas ini dipegang satu guru.">
        {canEdit && (
          <form onSubmit={onAssign} className="grid items-end gap-4 md:grid-cols-[1fr_1fr_auto]">
            <Field label="Mapel">
              <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
                <option value="">Pilih mapel</option>
                {freeSubjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Guru">
              <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} required>
                <option value="">Pilih guru</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({ROLE_LABELS[t.role]})</option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={!subjectId || !teacherId || addAssignment.isPending}>Tambah</Button>
          </form>
        )}
        {assignments.data && assignments.data.length === 0 && (
          <p className="text-sm text-slate-500">Belum ada penugasan untuk kelas ini.</p>
        )}
        {assignments.data && assignments.data.length > 0 && (
          <Table head={["Mapel", "Guru", ""]}>
            {assignments.data.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-2.5 font-medium">{a.subject_name}</td>
                <td className="px-4 py-2.5">{a.teacher_name}</td>
                <td className="px-4 py-2.5 text-right">
                  {canEdit && (
                    <Button variant="ghost" onClick={() => removeAssignment.mutate(a.id)} disabled={removeAssignment.isPending}>
                      Hapus
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Jadwal pelajaran" description="Bentrok dicek untuk kelas dan untuk guru.">
        {canEdit && (
          <form onSubmit={onSlot} className="grid items-end gap-4 md:grid-cols-[1.2fr_1fr_120px_120px_1fr_auto]">
            <Field label="Mapel dan guru">
              <Select value={slotAssignment} onChange={(e) => setSlotAssignment(e.target.value)} required>
                <option value="">Pilih penugasan</option>
                {assignments.data?.map((a) => (
                  <option key={a.id} value={a.id}>{a.subject_name} · {a.teacher_name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Hari">
              <Select value={day} onChange={(e) => setDay(e.target.value)}>
                {DAYS.map((d, i) => (
                  <option key={d} value={i + 1}>{d}</option>
                ))}
              </Select>
            </Field>
            <Field label="Mulai">
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
            </Field>
            <Field label="Selesai">
              <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </Field>
            <Field label="Ruang" hint="Opsional">
              <Input value={room} onChange={(e) => setRoom(e.target.value)} maxLength={40} />
            </Field>
            <Button type="submit" disabled={!slotAssignment || addSlot.isPending}>Tambah</Button>
          </form>
        )}
        {sortedSlots.length === 0 && <p className="text-sm text-slate-500">Belum ada jadwal.</p>}
        {sortedSlots.length > 0 && (
          <Table head={["Hari", "Jam", "Mapel", "Guru", "Ruang", ""]}>
            {sortedSlots.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2.5">{DAYS[s.day_of_week - 1]}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{shortTime(s.start_time)}–{shortTime(s.end_time)}</td>
                <td className="px-4 py-2.5 font-medium">{s.subject_name}</td>
                <td className="px-4 py-2.5">{s.teacher_name}</td>
                <td className="px-4 py-2.5">{s.room ?? "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  {canEdit && (
                    <Button variant="ghost" onClick={() => removeSlot.mutate(s.id)} disabled={removeSlot.isPending}>
                      Hapus
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
