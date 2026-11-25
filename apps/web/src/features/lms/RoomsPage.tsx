import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { Alert, Button, Card, ErrorAlert, Field, Input, Table, cn } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import { downloadFile, formatBytes, formatDateTime, type FileItem } from "./files";
import { useToken } from "./useToken";

export type Room = { id: string; class_name: string; subject_name: string; teacher_name: string };
export type Material = { id: string; title: string; body: string | null; created_by_name: string; created_at: string; files: FileItem[] };
export type Task = { id: string; title: string; instructions: string | null; due_at: string; max_score: number; allow_late: boolean; created_at: string; grade_component_id: string | null };
type Semester = { id: string; name: string; starts_on: string; ends_on: string };
type GradeComponent = { id: string; name: string };
export type Announcement = { id: string; title: string; body: string; created_by_name: string; created_at: string };

export function RoomsPage() {
  const rooms = useApiQuery<Room[]>(["lms-rooms"], "/lms/rooms");
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">Pembelajaran</p>
        <h1 className="text-2xl font-semibold tracking-tight">Ruang kelas</h1>
      </header>
      {rooms.isPending && <p className="text-sm text-slate-500">Memuat…</p>}
      {rooms.data && rooms.data.length === 0 && <Alert tone="info">Belum ada ruang kelas untuk Anda di tahun ajaran aktif.</Alert>}
      {rooms.data && rooms.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rooms.data.map((r) => (
            <Link key={r.id} to={`/ruang-kelas/${r.id}`} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 hover:ring-brand-500">
              <p className="text-xs uppercase tracking-wide text-slate-500">Kelas {r.class_name}</p>
              <p className="mt-1 text-lg font-semibold">{r.subject_name}</p>
              <p className="text-sm text-slate-600">{r.teacher_name}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const TABS = ["materi", "tugas", "pengumuman"] as const;
type Tab = (typeof TABS)[number];

export function RoomPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const token = useToken();
  const rooms = useApiQuery<Room[]>(["lms-rooms"], "/lms/rooms");
  const room = rooms.data?.find((r) => r.id === id);
  const manage = user?.role !== "siswa" && !!room;
  const [tab, setTab] = useState<Tab>("materi");

  return (
    <div className="space-y-6">
      <header>
        <Link to="/ruang-kelas" className="text-sm text-brand-700 hover:underline">← Semua ruang kelas</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{room ? room.subject_name : "Ruang kelas"}</h1>
        {room && <p className="text-sm text-slate-600">Kelas {room.class_name} · {room.teacher_name}</p>}
      </header>

      <nav className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize",
              tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "materi" && <MaterialsTab roomId={id} manage={manage} token={token} />}
      {tab === "tugas" && <TasksTab roomId={id} manage={manage} />}
      {tab === "pengumuman" && <AnnouncementsTab roomId={id} manage={manage} />}
    </div>
  );
}

function MaterialsTab({ roomId, manage, token }: { roomId: string; manage: boolean; token: string | null }) {
  const materials = useApiQuery<Material[]>(["lms-materials", roomId], `/lms/rooms/${roomId}/materials`);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const inv = [["lms-materials", roomId]];

  const create = useApiMutation<void, Material>(
    { method: "POST", path: () => `/lms/rooms/${roomId}/materials`, body: () => ({ title, body: body || null }) },
    inv,
  );
  const upload = useApiMutation<string, FileItem>({ method: "POST", path: (id) => `/lms/materials/${id}/files` }, inv);
  const remove = useApiMutation<string, unknown>({ method: "DELETE", path: (id) => `/lms/materials/${id}` }, inv);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const created = await create.mutateAsync();
    if (file) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/lms/materials/${created.id}/files`, {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNotice(`Materi dibuat, tetapi berkas ditolak: ${data.details?.[0]?.message ?? data.message ?? "tidak valid"}`);
      }
    }
    setTitle("");
    setBody("");
    setFile(null);
    await materials.refetch();
  };

  return (
    <div className="space-y-6">
      {manage && (
        <Card title="Tambah materi" description="Lampiran: pdf, docx, pptx, xlsx, png, jpg, txt. Maksimal 10 MB.">
          <form onSubmit={onCreate} className="grid gap-4 md:grid-cols-2">
            <Field label="Judul">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
            </Field>
            <Field label="Lampiran" hint="Opsional">
              <input type="file" accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
            </Field>
            <Field label="Keterangan">
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={20000} className="block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={create.isPending || upload.isPending}>Simpan materi</Button>
            </div>
          </form>
        </Card>
      )}
      <ErrorAlert error={create.error ?? upload.error ?? remove.error} />
      {notice && <Alert tone="warning">{notice}</Alert>}
      {downloadError && <Alert tone="error">{downloadError}</Alert>}
      {materials.data && materials.data.length === 0 && <p className="text-sm text-slate-500">Belum ada materi.</p>}
      {materials.data?.map((m) => (
        <Card key={m.id} title={m.title} description={`${m.created_by_name} · ${formatDateTime(m.created_at)}`}
          actions={manage ? <Button variant="ghost" onClick={() => remove.mutate(m.id)} disabled={remove.isPending}>Hapus</Button> : undefined}>
          {m.body && <p className="whitespace-pre-line text-sm text-slate-700">{m.body}</p>}
          {m.files.length > 0 && (
            <ul className="space-y-1">
              {m.files.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="text-sm text-brand-700 hover:underline"
                    onClick={() => downloadFile(f.id, token, f.file_name).catch((e) => setDownloadError(e.message))}
                  >
                    {f.file_name}
                  </button>{" "}
                  <span className="text-xs text-slate-500">({formatBytes(f.size_bytes)})</span>
                </li>
              ))}
            </ul>
          )}
          {manage && m.files.length === 0 && (
            <p className="text-xs text-slate-500">Tanpa lampiran. Tambahkan lampiran lewat formulir di atas saat membuat materi.</p>
          )}
        </Card>
      ))}
    </div>
  );
}

function TasksTab({ roomId, manage }: { roomId: string; manage: boolean }) {
  const tasks = useApiQuery<Task[]>(["lms-tasks", roomId], `/lms/rooms/${roomId}/tasks`);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [due, setDue] = useState("");
  const [maxScore, setMaxScore] = useState("100");
  const [allowLate, setAllowLate] = useState(false);
  // Nilai tugas bisa disalin ke komponen nilai F3 (opsional). Pilih semester dulu.
  const semesters = useApiQuery<Semester[]>(["semesters"], "/semesters");
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultSemester =
    semesters.data?.find((x) => x.starts_on <= todayIso && todayIso <= x.ends_on)?.id ?? semesters.data?.[0]?.id ?? "";
  const [semesterPick, setSemesterPick] = useState("");
  const semesterId = semesterPick || defaultSemester;
  const components = useApiQuery<GradeComponent[]>(
    ["grade-components", roomId, semesterId],
    semesterId ? `/grade-components?assignment_id=${roomId}&semester_id=${semesterId}` : null,
  );
  const [componentId, setComponentId] = useState("");
  const create = useApiMutation<void, Task>(
    {
      method: "POST",
      path: () => `/lms/rooms/${roomId}/tasks`,
      body: () => ({
        title,
        instructions: instructions || null,
        due_at: new Date(due).toISOString(),
        max_score: Number(maxScore),
        allow_late: allowLate,
        grade_component_id: componentId || null,
      }),
    },
    [["lms-tasks", roomId]],
  );

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync();
    setTitle("");
    setInstructions("");
    setDue("");
  };

  const now = Date.now();
  return (
    <div className="space-y-6">
      {manage && (
        <Card title="Tambah tugas">
          <form onSubmit={onCreate} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Field label="Judul"><Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} /></Field>
            <Field label="Tenggat"><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} required /></Field>
            <Field label="Nilai maksimum"><Input type="number" min={1} max={1000} value={maxScore} onChange={(e) => setMaxScore(e.target.value)} required /></Field>
            <label className="flex items-center gap-2 pt-7 text-sm">
              <input type="checkbox" checked={allowLate} onChange={(e) => setAllowLate(e.target.checked)} className="size-4 rounded border-slate-300 text-brand-600" />
              Terima terlambat
            </label>
            <Field label="Semester" hint="Untuk nilai F3">
              <select value={semesterId} onChange={(e) => { setSemesterPick(e.target.value); setComponentId(""); }} className="block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-slate-300">
                {semesters.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <Field label="Salin nilai ke komponen" hint="Opsional, nilai F3">
              <select value={componentId} onChange={(e) => setComponentId(e.target.value)} className="block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-slate-300">
                <option value="">— tidak terhubung —</option>
                {components.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <div className="flex items-end"><Button type="submit" disabled={create.isPending || !due}>Simpan tugas</Button></div>
            <div className="md:col-span-2 xl:col-span-5">
              <Field label="Instruksi" hint="Opsional">
                <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} maxLength={10000} className="block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500" />
              </Field>
            </div>
          </form>
          <ErrorAlert error={create.error} />
        </Card>
      )}
      {tasks.data && tasks.data.length === 0 && <p className="text-sm text-slate-500">Belum ada tugas.</p>}
      {tasks.data && tasks.data.length > 0 && (
        <Table head={["Tugas", "Tenggat", "Nilai maks", "Status", ""]}>
          {tasks.data.map((t) => {
            const closed = new Date(t.due_at).getTime() < now;
            return (
              <tr key={t.id}>
                <td className="px-4 py-3 font-medium">{t.title}</td>
                <td className="px-4 py-3">{formatDateTime(t.due_at)}</td>
                <td className="px-4 py-3">{t.max_score}</td>
                <td className="px-4 py-3">
                  {closed ? (t.allow_late ? "Lewat tenggat (terima terlambat)" : "Tenggat lewat") : "Berjalan"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link to={`/tugas/${t.id}`} className="text-brand-700 hover:underline">{manage ? "Periksa" : "Buka"}</Link>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

function AnnouncementsTab({ roomId, manage }: { roomId: string; manage: boolean }) {
  const list = useApiQuery<Announcement[]>(["lms-ann", roomId], `/lms/rooms/${roomId}/announcements`);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const create = useApiMutation<void, Announcement>(
    { method: "POST", path: () => `/lms/rooms/${roomId}/announcements`, body: () => ({ title, body }) },
    [["lms-ann", roomId]],
  );
  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync();
    setTitle("");
    setBody("");
  };
  return (
    <div className="space-y-6">
      {manage && (
        <Card title="Pengumuman baru">
          <form onSubmit={onCreate} className="grid gap-4">
            <Field label="Judul"><Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} /></Field>
            <Field label="Isi">
              <textarea value={body} onChange={(e) => setBody(e.target.value)} required rows={3} maxLength={10000} className="block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500" />
            </Field>
            <div><Button type="submit" disabled={create.isPending}>Umumkan</Button></div>
          </form>
          <ErrorAlert error={create.error} />
        </Card>
      )}
      {list.data && list.data.length === 0 && <p className="text-sm text-slate-500">Belum ada pengumuman.</p>}
      {list.data?.map((a) => (
        <Card key={a.id} title={a.title} description={`${a.created_by_name} · ${formatDateTime(a.created_at)}`}>
          <p className="whitespace-pre-line text-sm text-slate-700">{a.body}</p>
        </Card>
      ))}
    </div>
  );
}
