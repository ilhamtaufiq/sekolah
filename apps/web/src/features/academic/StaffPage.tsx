import { useMemo, useState, type FormEvent } from "react";
import { Button, Card, ErrorAlert, Field, Input, Select, Table, cn, PageHeader } from "../../components/kit";
import { useAuth } from "../../lib/auth";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import { ROLE_LABELS, type StaffUser } from "./types";

/** Peran staf yang bisa dibuat dan diubah dari halaman ini. */
const STAFF_ROLES = ["admin", "kepala_sekolah", "guru", "wali_kelas"] as const;
/** Akun siswa dan orang tua: peran tidak bisa diubah dari sini. */
const ACCOUNT_ONLY_ROLES = ["siswa", "orang_tua"] as const;
const FILTER_ROLES = [...STAFF_ROLES, ...ACCOUNT_ONLY_ROLES] as const;

type Form = { name: string; email: string; password: string; role: string; is_active: boolean };
const EMPTY: Form = { name: "", email: "", password: "", role: "guru", is_active: true };

export function StaffPage() {
  const { user: me } = useAuth();
  const canEdit = me?.role === "admin";
  const [roleFilter, setRoleFilter] = useState("");
  const [query, setQuery] = useState("");
  const users = useApiQuery<StaffUser[]>(["staff", roleFilter], `/users${roleFilter ? `?role=${roleFilter}` : ""}`);

  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const isAccountOnly = editing ? (ACCOUNT_ONLY_ROLES as readonly string[]).includes(editing.role) : false;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !users.data) return users.data ?? [];
    return users.data.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users.data, query]);

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
    save.reset();
    setEditing(u);
    setForm({ name: u.name, email: u.email, password: "", role: u.role, is_active: u.is_active });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Akun sekolah"
        title="Pengguna"
        description="Kelola akun staf, siswa, dan orang tua. Peran staf bisa diubah. Akun siswa dan orang tua bisa dinonaktifkan atau direset password, tetapi perannya tetap."
      />

      <ErrorAlert error={save.error} />

      {canEdit && (
        <Card
          title={editing ? `Ubah ${editing.name}` : "Tambah akun staf"}
          description={
            editing
              ? "Kosongkan password jika tidak diganti. Mengisi password baru sekaligus mereset password akun ini."
              : "Password minimal 8 karakter. Akun siswa dibuat dari menu Siswa."
          }
          actions={editing && <Button variant="ghost" size="sm" onClick={reset}>Tutup</Button>}
        >
          <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Field label="Nama">
              <Input value={form.name} onChange={set("name")} required maxLength={200} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={set("email")} required disabled={!!editing} />
            </Field>
            <Field label={editing ? "Password baru" : "Password"}>
              <Input
                type="password"
                value={form.password}
                onChange={set("password")}
                required={!editing}
                minLength={editing ? undefined : 8}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Peran">
              {isAccountOnly ? (
                <Input value={ROLE_LABELS[form.role] ?? form.role} disabled />
              ) : (
                <Select value={form.role} onChange={set("role")}>
                  {STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="flex items-end gap-2">
              {editing && (
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                    disabled={editing.id === me?.id}
                    className="size-4 rounded border-slate-300 text-brand-600"
                  />
                  Aktif
                </label>
              )}
              <Button type="submit" disabled={save.isPending}>
                {editing ? "Simpan" : "Tambah"}
              </Button>
            </div>
          </form>
          {editing?.id === me?.id && (
            <p className="mt-3 text-xs text-muted-foreground">Anda tidak bisa menonaktifkan atau menurunkan peran akun sendiri.</p>
          )}
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <Input
          type="search"
          placeholder="Cari nama atau email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
          aria-label="Cari pengguna"
        />
        <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="max-w-[220px]" aria-label="Filter peran">
          <option value="">Semua peran</option>
          {FILTER_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </div>

      {users.data && (
        <Table head={["Nama", "Email", "Peran", "Status", ""]}>
          {visible.map((u) => (
            <tr key={u.id} className={cn(!u.is_active && "text-slate-400")}>
              <td className="px-4 py-3 font-medium">{u.name}</td>
              <td className="px-4 py-3">{u.email}</td>
              <td className="px-4 py-3">{ROLE_LABELS[u.role] ?? u.role}</td>
              <td className="px-4 py-3">{u.is_active ? "Aktif" : "Nonaktif"}</td>
              <td className="px-4 py-3 text-right">
                {canEdit && (
                  <Button variant="ghost" onClick={() => startEdit(u)}>
                    Ubah
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                Tidak ada pengguna yang cocok.
              </td>
            </tr>
          )}
        </Table>
      )}
    </div>
  );
}
