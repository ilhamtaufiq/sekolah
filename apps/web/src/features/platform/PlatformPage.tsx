import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Card, EmptyState, ErrorAlert, Field, Input, PageHeader, StatStrip, Table, TableCell, TableRow } from "../../components/kit";
import { Badge } from "@/components/ui/badge";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import { PlatformShell } from "./PlatformShell";

type SchoolSummary = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  created_at: string;
  admins: number;
  teachers: number;
  students: number;
  classes: number;
  pending_journals: number;
  last_attendance: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Status aktivitas: nonaktif didahulukan, lalu tanggal absensi terakhir. */
function activity(s: SchoolSummary): { label: string; variant: "default" | "secondary" | "outline" | "destructive" } {
  if (!s.is_active) return { label: "Nonaktif", variant: "secondary" };
  if (!s.last_attendance) return { label: "Belum ada absensi", variant: "outline" };
  const days = Math.floor((Date.now() - new Date(`${s.last_attendance}T00:00:00`).getTime()) / DAY_MS);
  return days <= 7 ? { label: "Aktif", variant: "default" } : { label: `Tidak aktif · ${days} hari`, variant: "destructive" };
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

type CreateVars = { slug: string; name: string; admin_name: string; admin_email: string; admin_password: string };

function NewSchoolForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [form, setForm] = useState<CreateVars>({ slug: "", name: "", admin_name: "", admin_email: "", admin_password: "" });
  const create = useApiMutation<CreateVars, { id: string }>(
    { method: "POST", path: () => "/platform/schools", body: (v) => v },
    [["platform", "schools"]],
  );
  const set = (k: keyof CreateVars) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate(form, { onSuccess: (res) => onCreated(res.id) });
  }

  return (
    <Card title="Sekolah baru" description="Membuat sekolah dan akun admin pertamanya sekaligus.">
      <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
        <ErrorAlert error={create.error} />
        <Field label="Nama sekolah"><Input required value={form.name} onChange={set("name")} /></Field>
        <Field label="Slug" hint="Huruf kecil, angka, atau '-'. Dipakai saat login.">
          <Input required pattern="[a-z0-9\-]{3,40}" value={form.slug} onChange={set("slug")} />
        </Field>
        <Field label="Nama admin"><Input required value={form.admin_name} onChange={set("admin_name")} /></Field>
        <Field label="Email admin"><Input type="email" required value={form.admin_email} onChange={set("admin_email")} /></Field>
        <Field label="Kata sandi awal admin" hint="Minimal 8 karakter.">
          <Input type="password" required minLength={8} value={form.admin_password} onChange={set("admin_password")} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Menyimpan…" : "Buat sekolah"}</Button>
        </div>
      </form>
    </Card>
  );
}

/** Dashboard super admin: semua sekolah (tenant) dan pembuatan sekolah baru. */
export function PlatformPage() {
  const navigate = useNavigate();
  const schools = useApiQuery<SchoolSummary[]>(["platform", "schools"], "/platform/schools");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const rows = schools.data ?? [];
  const totals = useMemo(
    () =>
      rows.reduce(
        (t, s) => ({
          active: t.active + (s.is_active ? 1 : 0),
          students: t.students + s.students,
          teachers: t.teachers + s.teachers,
          pending: t.pending + s.pending_journals,
        }),
        { active: 0, students: 0, teachers: 0, pending: 0 },
      ),
    [rows],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <PlatformShell>
      <PageHeader
        title="Semua sekolah"
        description={`${rows.length} sekolah terdaftar, ${totals.active} aktif. Data diambil langsung dari setiap tenant.`}
        actions={<Button onClick={() => setCreating((v) => !v)}>{creating ? "Tutup" : "Sekolah baru"}</Button>}
      />

      {creating && (
        <NewSchoolForm
          onCreated={(id) => {
            setCreating(false);
            navigate(`/platform/sekolah/${id}`);
          }}
        />
      )}

      {schools.isPending && <p className="text-sm text-muted-foreground">Memuat daftar sekolah…</p>}
      {schools.isError && <p className="text-sm text-destructive">Gagal memuat daftar sekolah.</p>}

      {schools.data && (
        <>
          <StatStrip
            items={[
              { label: "Sekolah aktif", value: totals.active, hint: `dari ${rows.length} sekolah` },
              { label: "Siswa aktif", value: totals.students },
              { label: "Guru & wali kelas", value: totals.teachers },
              { label: "Jurnal menunggu", value: totals.pending, hint: "Menunggu persetujuan kepala sekolah" },
            ]}
          />

          <Input className="max-w-xs" placeholder="Cari nama atau slug sekolah" value={query} onChange={(e) => setQuery(e.target.value)} />

          {filtered.length === 0 ? (
            <EmptyState title="Tidak ada sekolah yang cocok." />
          ) : (
            <Table head={["Sekolah", "Siswa", "Guru", "Kelas", "Jurnal menunggu", "Absensi terakhir", "Status"]}>
              {filtered.map((s) => {
                const act = activity(s);
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link to={`/platform/sekolah/${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                      <div className="font-mono text-xs text-muted-foreground">{s.slug}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">{s.students}</TableCell>
                    <TableCell className="tabular-nums">{s.teachers}</TableCell>
                    <TableCell className="tabular-nums">{s.classes}</TableCell>
                    <TableCell className="tabular-nums">{s.pending_journals}</TableCell>
                    <TableCell>{formatDate(s.last_attendance)}</TableCell>
                    <TableCell><Badge variant={act.variant}>{act.label}</Badge></TableCell>
                  </TableRow>
                );
              })}
            </Table>
          )}
        </>
      )}
    </PlatformShell>
  );
}
