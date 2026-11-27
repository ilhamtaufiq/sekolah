import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { Alert, Button, Card, ErrorAlert, Field, Input, Select, Table, PageHeader } from "../../components/kit";
import { useAuth } from "../../lib/auth";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import { useSchoolTerms } from "../school/useSchoolTerms";
import { PROGRAM_LABELS, PROGRAM_OPTIONS, ROLE_LABELS, type ClassRow, type StaffUser, type Student } from "./types";

const TEACHER_ROLES = ["guru", "wali_kelas"];

export function ClassesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const classes = useApiQuery<ClassRow[]>(["classes"], "/classes");
  const staff = useApiQuery<StaffUser[]>(["staff"], canEdit ? "/users" : null);
  const teachers = (staff.data ?? []).filter((u) => TEACHER_ROLES.includes(u.role) && u.is_active);
  const { terms } = useSchoolTerms();

  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("7");
  const [program, setProgram] = useState("");
  const [homeroom, setHomeroom] = useState("");

  const reset = () => {
    setEditing(null);
    setName("");
    setGrade("7");
    setProgram("");
    setHomeroom("");
  };

  const save = useApiMutation<void, ClassRow>(
    {
      method: editing ? "PUT" : "POST",
      path: () => (editing ? `/classes/${editing.id}` : "/classes"),
      body: () => ({
        name,
        grade_level: Number(grade),
        program: program || null,
        homeroom_teacher_id: homeroom || null,
      }),
    },
    [["classes"], ["summary"]],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await save.mutateAsync();
    reset();
  };

  const startEdit = (c: ClassRow) => {
    setEditing(c);
    setName(c.name);
    setGrade(String(c.grade_level));
    setProgram(c.program ?? "");
    setHomeroom(c.homeroom_teacher_id ?? "");
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Akademik" title={terms.class} description={<>Daftar {terms.class.toLowerCase()} di tahun ajaran yang aktif.</>} />

      <ErrorAlert error={save.error} />

      {canEdit && (
        <Card title={editing ? `Ubah kelas ${editing.name}` : "Tambah kelas"}>
          <form onSubmit={onSubmit} className="grid items-end gap-4 md:grid-cols-[1fr_96px_168px_1fr_auto_auto]">
            <Field label="Nama kelas">
              <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} placeholder="7A" />
            </Field>
            <Field label="Tingkat">
              <Select value={grade} onChange={(e) => setGrade(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}</option>
                ))}
              </Select>
            </Field>
            <Field label="Program">
              <Select value={program} onChange={(e) => setProgram(e.target.value)}>
                <option value="">Tanpa program</option>
                {PROGRAM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Wali kelas">
              <Select value={homeroom} onChange={(e) => setHomeroom(e.target.value)}>
                <option value="">Belum ditentukan</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({ROLE_LABELS[t.role] ?? t.role})</option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={save.isPending}>{editing ? "Simpan" : "Tambah"}</Button>
            {editing && <Button type="button" variant="secondary" onClick={reset}>Batal</Button>}
          </form>
        </Card>
      )}

      {classes.isPending && <p className="text-sm text-slate-500">Memuat…</p>}
      {classes.data && classes.data.length === 0 && (
        <Alert tone="info">Belum ada kelas di tahun ajaran aktif.</Alert>
      )}
      {classes.data && classes.data.length > 0 && (
        <Table head={[terms.class, "Tingkat", "Program", "Wali kelas", terms.student, ""]}>
          {classes.data.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3 font-medium">{c.name}</td>
              <td className="px-4 py-3">{c.grade_level}</td>
              <td className="px-4 py-3">{c.program ? PROGRAM_LABELS[c.program] ?? c.program : <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-3">{c.homeroom_teacher_name ?? <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-3">{c.student_count}</td>
              <td className="space-x-2 px-4 py-3 text-right">
                {canEdit && <Button variant="ghost" onClick={() => startEdit(c)}>Ubah</Button>}
                <Link to={`/kelas/${c.id}`} className="inline-flex items-center rounded-lg px-3.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
                  Buka →
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function ClassDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const { terms } = useSchoolTerms();
  const classes = useApiQuery<ClassRow[]>(["classes"], "/classes");
  const roster = useApiQuery<Student[]>(["roster", id], `/classes/${id}/students`);
  const students = useApiQuery<Student[]>(["students", ""], canEdit ? "/students" : null);
  const [picked, setPicked] = useState<string[]>([]);

  const klass = classes.data?.find((c) => c.id === id);
  const inClass = useMemo(() => new Set((roster.data ?? []).map((s) => s.id)), [roster.data]);
  const candidates = (students.data ?? []).filter((s) => s.status === "aktif" && !inClass.has(s.id));

  const invalidate = [["roster", id], ["classes"]];
  const add = useApiMutation<string[], Student[]>(
    { method: "POST", path: () => `/classes/${id}/students`, body: (ids) => ({ student_ids: ids }) },
    invalidate,
  );
  const remove = useApiMutation<string, unknown>(
    { method: "DELETE", path: (sid) => `/classes/${id}/students/${sid}` },
    invalidate,
  );

  const togglePick = (sid: string) =>
    setPicked((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));

  const onAdd = async () => {
    await add.mutateAsync(picked);
    setPicked([]);
  };

  return (
    <div className="space-y-6">
      <header>
        <Link to="/kelas" className="text-sm text-brand-700 hover:underline">← Semua kelas</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{terms.class} {klass?.name ?? ""}</h1>
        {klass && (
          <p className="text-sm text-slate-600">
            Tingkat {klass.grade_level} · Wali kelas: {klass.homeroom_teacher_name ?? "belum ditentukan"}
          </p>
        )}
      </header>

      <ErrorAlert error={add.error ?? remove.error} />

      <Card title={`${terms.student} (${roster.data?.length ?? 0})`}>
        {roster.data && roster.data.length === 0 && <p className="text-sm text-slate-500">Belum ada siswa.</p>}
        {roster.data && roster.data.length > 0 && (
          <Table head={["NIS", "Nama", "L/P", ""]}>
            {roster.data.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2.5 font-mono text-xs">{s.nis}</td>
                <td className="px-4 py-2.5">{s.name}</td>
                <td className="px-4 py-2.5">{s.gender ?? "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  {canEdit && (
                    <Button variant="ghost" onClick={() => remove.mutate(s.id)} disabled={remove.isPending}>
                      Keluarkan
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {canEdit && (
        <Card
          title={`Tambah ${terms.student.toLowerCase()}`}
          description={`${terms.student} yang sudah berada di ${terms.class.toLowerCase()} lain pada tahun ajaran ini tidak ditampilkan.`}
          actions={<Button onClick={onAdd} disabled={picked.length === 0 || add.isPending}>Tambahkan {picked.length || ""}</Button>}
        >
          {candidates.length === 0 && <p className="text-sm text-slate-500">Tidak ada siswa aktif yang bisa ditambahkan.</p>}
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {candidates.map((s) => (
              <label key={s.id} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={picked.includes(s.id)}
                  onChange={() => togglePick(s.id)}
                  className="size-4 rounded border-slate-300 text-brand-600"
                />
                <span>{s.name}</span>
                <span className="ml-auto font-mono text-xs text-slate-500">{s.nis}</span>
              </label>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
