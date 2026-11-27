import { useState, type FormEvent } from "react";
import { usePagination } from "../../lib/pagination";
import { Button, Card, ErrorAlert, Field, Input, Select, Table, PageHeader, Pagination } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import type { Student } from "./types";

const STATUSES = ["aktif", "lulus", "pindah", "keluar"];

type Form = {
  nis: string;
  nisn: string;
  name: string;
  gender: string;
  birth_date: string;
  status: string;
};

const EMPTY: Form = { nis: "", nisn: "", name: "", gender: "", birth_date: "", status: "aktif" };

export function StudentsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (status) params.set("status", status);
  const qs = params.toString();

  const students = useApiQuery<Student[]>(["students", qs], `/students${qs ? `?${qs}` : ""}`);
  const pg = usePagination(students.data ?? [], 25);

  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const reset = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  const save = useApiMutation<void, Student>(
    {
      method: editing ? "PUT" : "POST",
      path: () => (editing ? `/students/${editing.id}` : "/students"),
      body: () => ({
        nis: form.nis,
        nisn: form.nisn || null,
        name: form.name,
        gender: form.gender || null,
        birth_date: form.birth_date || null,
        status: form.status,
      }),
    },
    [["students"]],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await save.mutateAsync();
    reset();
  };

  const startEdit = (s: Student) => {
    setEditing(s);
    setForm({
      nis: s.nis,
      nisn: s.nisn ?? "",
      name: s.name,
      gender: s.gender ?? "",
      birth_date: s.birth_date ?? "",
      status: s.status,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Kesiswaan" title="Siswa" />

      <ErrorAlert error={save.error} />

      {canEdit && (
        <Card title={editing ? `Ubah ${editing.name}` : "Tambah siswa"}>
          <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Field label="NIS">
              <Input value={form.nis} onChange={set("nis")} required maxLength={20} />
            </Field>
            <Field label="NISN" hint="Opsional">
              <Input value={form.nisn} onChange={set("nisn")} maxLength={20} />
            </Field>
            <Field label="Nama">
              <Input value={form.name} onChange={set("name")} required maxLength={200} />
            </Field>
            <Field label="Jenis kelamin">
              <Select value={form.gender} onChange={set("gender")}>
                <option value="">—</option>
                <option value="L">Laki-laki</option>
                <option value="P">Perempuan</option>
              </Select>
            </Field>
            <Field label="Tanggal lahir">
              <Input type="date" value={form.birth_date} onChange={set("birth_date")} />
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={set("status")}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end gap-2 md:col-span-3 xl:col-span-6">
              <Button type="submit" disabled={save.isPending}>{editing ? "Simpan" : "Tambah"}</Button>
              {editing && <Button type="button" variant="secondary" onClick={reset}>Batal</Button>}
            </div>
          </form>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <Input placeholder="Cari nama atau NIS" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[200px]">
          <option value="">Semua status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>

      {students.isPending && <p className="text-sm text-slate-500">Memuat…</p>}
      {students.data && (
        <>
          <Table head={["NIS", "Nama", "L/P", "Status", ""]}>
            {students.data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">Tidak ada siswa yang cocok.</td>
              </tr>
            )}
            {pg.items.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3 font-mono text-xs">{s.nis}</td>
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3">{s.gender ?? "—"}</td>
                <td className="px-4 py-3">{s.status}</td>
                <td className="px-4 py-3 text-right">
                  {canEdit && <Button variant="ghost" onClick={() => startEdit(s)}>Ubah</Button>}
                </td>
              </tr>
            ))}
          </Table>
          <Pagination {...pg} />
        </>
      )}
    </div>
  );
}
