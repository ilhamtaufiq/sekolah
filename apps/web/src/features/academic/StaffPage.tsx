import { useState, type FormEvent } from "react";
import { Button, Card, ErrorAlert, Field, Input, Select, Table, cn, PageHeader } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import { ROLE_LABELS, type StaffUser } from "./types";

const ROLES = ["guru", "wali_kelas", "kepala_sekolah", "admin"] as const;

type Form = { name: string; email: string; password: string; role: string; is_active: boolean };
const EMPTY: Form = { name: "", email: "", password: "", role: "guru", is_active: true };

export function StaffPage() {
  const { user: me } = useAuth();
  const canEdit = me?.role === "admin";
  const [roleFilter, setRoleFilter] = useState("");
  const staff = useApiQuery<StaffUser[]>(["staff", roleFilter], `/users${roleFilter ? `?role=${roleFilter}` : ""}`);

  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const reset = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  const save = useApiMutation<void, StaffUser>(
    {
      method: editing ? "PUT" : "POST",
      path: () => (editing ? `/users/${editing.id}` : "/users"),
      body: () =>
        editing
          ? { name: form.name, role: form.role, is_active: form.is_active, password: form.password || null }
          : { name: form.name, email: form.email, password: form.password, role: form.role },
    },
    [["staff"]],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await save.mutateAsync();
    reset();
  };

  const startEdit = (u: StaffUser) => {
    setEditing(u);
    setForm({ name: u.name, email: u.email, password: "", role: u.role, is_active: u.is_active });
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Kepegawaian" title="Guru dan staf" description="Akun untuk login ke sistem. Peran menentukan apa yang bisa dilakukan." />

      <ErrorAlert error={save.error} />

      {canEdit && (
        <Card
          title={editing ? `Ubah ${editing.name}` : "Tambah akun"}
          description={editing ? "Kosongkan password jika tidak diganti." : "Password minimal 8 karakter."}
        >
          <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Field label="Nama">
              <Input value={form.name} onChange={set("name")} required maxLength={200} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={set("email")} required disabled={!!editing} />
            </Field>
            <Field label={editing ? "Password baru" : "Password"}>
              <Input type="password" value={form.password} onChange={set("password")} required={!editing} autoComplete="new-password" />
            </Field>
            <Field label="Peran">
              <Select value={form.role} onChange={set("role")}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end gap-2">
              {editing && (
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                    className="size-4 rounded border-slate-300 text-brand-600"
                  />
                  Aktif
                </label>
              )}
              <Button type="submit" disabled={save.isPending}>{editing ? "Simpan" : "Tambah"}</Button>
              {editing && <Button type="button" variant="secondary" onClick={reset}>Batal</Button>}
            </div>
          </form>
        </Card>
      )}

      <div className="flex gap-3">
        <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="max-w-[220px]">
          <option value="">Semua peran</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </Select>
      </div>

      {staff.data && (
        <Table head={["Nama", "Email", "Peran", "Status", ""]}>
          {staff.data.map((u) => (
            <tr key={u.id} className={cn(!u.is_active && "text-slate-400")}>
              <td className="px-4 py-3 font-medium">{u.name}</td>
              <td className="px-4 py-3">{u.email}</td>
              <td className="px-4 py-3">{ROLE_LABELS[u.role] ?? u.role}</td>
              <td className="px-4 py-3">{u.is_active ? "Aktif" : "Nonaktif"}</td>
              <td className="px-4 py-3 text-right">
                {canEdit && <Button variant="ghost" onClick={() => startEdit(u)}>Ubah</Button>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
