import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { Button, Card, EmptyState, ErrorAlert, Field, Input, PageHeader, Select, StatStrip, Table, TableCell, TableRow } from "../../components/kit";
import { Badge } from "@/components/ui/badge";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { PlatformShell } from "./PlatformShell";
import { AUDIT_LABELS, formatWhen, summarizeDetail, type AuditRow } from "./audit-labels";
import { seedSchoolDemo } from "./demoSeed";
import { api } from "../../lib/api";

type SchoolRecord = { id: string; slug: string; name: string; is_active: boolean; created_at: string };
type UserRecord = { id: string; name: string; email: string; role: string; is_active: boolean };
type SchoolDetail = SchoolRecord & {
  summary: { admins: number; teachers: number; students: number; classes: number };
  users: UserRecord[];
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  kepala_sekolah: "Kepala sekolah",
  guru: "Guru",
  wali_kelas: "Wali kelas",
  siswa: "Siswa",
  orang_tua: "Orang tua",
};

/** Detail satu sekolah: ubah identitas, aktif/nonaktif, kelola admin, dan riwayat aksi. */
export function PlatformSchoolPage() {
  const { id = "" } = useParams();
  const detail = useApiQuery<SchoolDetail>(["platform", "school", id], `/platform/schools/${id}`);
  const audit = useApiQuery<AuditRow[]>(["platform", "audit", id], `/platform/audit?school_id=${id}&limit=200`);
  const invalidate = [["platform", "school", id], ["platform", "audit", id], ["platform", "schools"], ["platform", "audit"]];

  if (detail.isPending) return <PlatformShell><p className="text-sm text-muted-foreground">Memuat sekolah…</p></PlatformShell>;
  if (detail.isError || !detail.data) return <PlatformShell><p className="text-sm text-destructive">Sekolah tidak ditemukan.</p></PlatformShell>;
  const s = detail.data;

  return (
    <PlatformShell>
      <PageHeader
        back={{ to: "/platform", label: "Semua sekolah" }}
        title={s.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{s.slug}</span>
            <Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "Aktif" : "Nonaktif"}</Badge>
          </span>
        }
        actions={<StatusButton id={id} active={s.is_active} invalidate={invalidate} />}
      />

      <StatStrip
        items={[
          { label: "Admin", value: s.summary.admins },
          { label: "Guru & wali kelas", value: s.summary.teachers },
          { label: "Siswa aktif", value: s.summary.students },
          { label: "Kelas aktif", value: s.summary.classes },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <EditSchoolCard school={s} invalidate={invalidate} />
        <AddAdminCard id={id} invalidate={invalidate} />
      </div>

      <Card title="Pengguna" description="Semua akun di sekolah ini.">
        {s.users.length === 0 ? (
          <EmptyState title="Belum ada pengguna." />
        ) : (
          <Table head={["Nama", "Email", "Peran", "Status"]}>
            {s.users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell>{ROLE_LABEL[u.role] ?? u.role}</TableCell>
                <TableCell><Badge variant={u.is_active ? "outline" : "secondary"}>{u.is_active ? "Aktif" : "Nonaktif"}</Badge></TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>

      <ResetPasswordCard id={id} users={s.users.filter((u) => u.role === "admin")} invalidate={invalidate} />

      <DemoDataCard id={id} slug={s.slug} hasClasses={s.summary.classes > 0} invalidate={invalidate} />

      <Card title="Riwayat aksi" description="Semua perubahan yang dilakukan super admin pada sekolah ini.">
        {audit.data && audit.data.length === 0 ? (
          <EmptyState title="Belum ada aksi tercatat." />
        ) : (
          <Table head={["Waktu", "Aksi", "Oleh", "Rincian"]}>
            {(audit.data ?? []).map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-muted-foreground">{formatWhen(a.created_at)}</TableCell>
                <TableCell>{AUDIT_LABELS[a.action] ?? a.action}</TableCell>
                <TableCell>{a.actor_name}</TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">{summarizeDetail(a.detail)}</TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>
    </PlatformShell>
  );
}

function StatusButton({ id, active, invalidate }: { id: string; active: boolean; invalidate: string[][] }) {
  const toggle = useApiMutation<{ is_active: boolean }>(
    { method: "POST", path: () => `/platform/schools/${id}/status`, body: (v) => v },
    invalidate,
  );
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant={active ? "destructive" : "default"}
        disabled={toggle.isPending}
        onClick={() => {
          if (active && !window.confirm("Nonaktifkan sekolah ini? Semua pengguna langsung kehilangan akses.")) return;
          toggle.mutate({ is_active: !active });
        }}
      >
        {active ? "Nonaktifkan sekolah" : "Aktifkan sekolah"}
      </Button>
      <ErrorAlert error={toggle.error} />
    </div>
  );
}

function EditSchoolCard({ school, invalidate }: { school: SchoolRecord; invalidate: string[][] }) {
  const [name, setName] = useState(school.name);
  const [slug, setSlug] = useState(school.slug);
  useEffect(() => {
    setName(school.name);
    setSlug(school.slug);
  }, [school.id, school.name, school.slug]);
  const save = useApiMutation<{ name: string; slug: string }>(
    { method: "PATCH", path: () => `/platform/schools/${school.id}`, body: (v) => v },
    invalidate,
  );
  const dirty = name !== school.name || slug !== school.slug;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ name, slug });
  }

  return (
    <Card title="Identitas sekolah" description="Mengubah slug mengubah alamat login sekolah.">
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorAlert error={save.error} />
        <Field label="Nama sekolah"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Slug" hint="Huruf kecil, angka, atau '-'.">
          <Input required pattern="[a-z0-9\-]{3,40}" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Button type="submit" disabled={!dirty || save.isPending}>{save.isPending ? "Menyimpan…" : "Simpan perubahan"}</Button>
      </form>
    </Card>
  );
}

function AddAdminCard({ id, invalidate }: { id: string; invalidate: string[][] }) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const add = useApiMutation<typeof form>({ method: "POST", path: () => `/platform/schools/${id}/admins`, body: (v) => v }, invalidate);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    add.mutate(form, { onSuccess: () => setForm({ name: "", email: "", password: "" }) });
  }

  return (
    <Card title="Tambah admin" description="Akun admin tambahan untuk sekolah ini.">
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorAlert error={add.error} />
        <Field label="Nama"><Input required value={form.name} onChange={set("name")} /></Field>
        <Field label="Email"><Input type="email" required value={form.email} onChange={set("email")} /></Field>
        <Field label="Kata sandi awal" hint="Minimal 8 karakter.">
          <Input type="password" required minLength={8} value={form.password} onChange={set("password")} />
        </Field>
        <Button type="submit" disabled={add.isPending}>{add.isPending ? "Menyimpan…" : "Tambah admin"}</Button>
      </form>
    </Card>
  );
}

function ResetPasswordCard({ id, users, invalidate }: { id: string; users: UserRecord[]; invalidate: string[][] }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const reset = useApiMutation<{ password: string }>(
    { method: "POST", path: () => `/platform/schools/${id}/users/${userId}/password`, body: (v) => v },
    invalidate,
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    reset.mutate({ password }, { onSuccess: () => { setPassword(""); setDone(true); } });
  }

  if (users.length === 0) return null;
  return (
    <Card title="Reset password admin" description="Password baru langsung berlaku untuk login berikutnya.">
      <form onSubmit={onSubmit} className="grid items-end gap-4 md:grid-cols-[1fr_1fr_auto]">
        <ErrorAlert error={reset.error} />
        <Field label="Admin">
          <Select required value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Pilih admin</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </Select>
        </Field>
        <Field label="Password baru" hint="Minimal 8 karakter.">
          <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" disabled={!userId || reset.isPending}>{reset.isPending ? "Menyimpan…" : "Reset password"}</Button>
        {done && <p className="text-sm text-emerald-700 md:col-span-3">Password berhasil direset.</p>}
      </form>
    </Card>
  );
}

/** Mengisi sekolah kosong dengan data demo. Berjalan di browser dan dicatat di jejak audit. */
function DemoDataCard({ id, slug, hasClasses, invalidate }: { id: string; slug: string; hasClasses: boolean; invalidate: string[][] }) {
  const { token: platformToken } = useAuth();
  const qc = useQueryClient();
  const [step, setStep] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [finished, setFinished] = useState(false);

  async function run() {
    if (!window.confirm("Isi data demo ke sekolah ini? Sekolah harus kosong. Proses memakan beberapa menit dan jangan tutup halaman.")) return;
    setRunning(true);
    setError(null);
    setFinished(false);
    try {
      // Token admin sekolah hanya dipakai di memori untuk proses ini dan dicatat di jejak audit.
      const adminSession = await api<{ token: string }>(`/platform/schools/${id}/admin-token`, { method: "POST", token: platformToken });
      await seedSchoolDemo(adminSession.token, slug, setStep);
      setFinished(true);
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
      setStep("");
      invalidate.forEach((key) => qc.invalidateQueries({ queryKey: key }));
    }
  }

  return (
    <Card title="Data demo" description="Mengisi sekolah kosong dengan siswa, nilai, absensi, jurnal, ujian, dan raport contoh.">
      <div className="space-y-4">
        <ErrorAlert error={error} />
        {finished && <p className="text-sm text-emerald-700">Data demo selesai dibuat. Akun demo memakai password demo-pass-1.</p>}
        {running && <p className="text-sm text-muted-foreground">Sedang mengerjakan: {step || "persiapan"}…</p>}
        {hasClasses && !running && <p className="text-sm text-muted-foreground">Sekolah ini sudah punya kelas, jadi data demo tidak bisa diisi.</p>}
        <Button onClick={run} disabled={running || hasClasses}>{running ? "Memproses…" : "Isi data demo"}</Button>
      </div>
    </Card>
  );
}
