import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Field, Input, ErrorAlert, Table, cn } from "../../components/ui";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { formatDate, type AcademicYear } from "./types";

export function YearsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const years = useApiQuery<AcademicYear[]>(["years"], "/academic-years");
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const invalidate = [["years"], ["summary"]];
  const create = useApiMutation<void, AcademicYear>(
    { method: "POST", path: () => "/academic-years", body: () => ({ name, starts_on: startsOn, ends_on: endsOn }) },
    invalidate,
  );
  const activate = useApiMutation<string, AcademicYear>(
    { method: "POST", path: (id) => `/academic-years/${id}/activate` },
    invalidate,
  );

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    await create.mutateAsync();
    setNotice(`Tahun ajaran ${name} dibuat.`);
    setName("");
    setStartsOn("");
    setEndsOn("");
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">Akademik</p>
        <h1 className="text-2xl font-semibold tracking-tight">Tahun ajaran</h1>
        <p className="text-sm text-slate-600">Hanya satu tahun ajaran yang aktif. Kelas dan absensi mengikuti tahun aktif.</p>
      </header>

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorAlert error={create.error ?? activate.error} />

      {canEdit && (
        <Card title="Tambah tahun ajaran">
          <form onSubmit={onCreate} className="grid items-end gap-4 md:grid-cols-[1fr_1fr_1fr_auto]">
            <Field label="Nama" hint="Contoh: 2026/2027">
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Mulai">
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
            </Field>
            <Field label="Selesai">
              <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} required />
            </Field>
            <Button type="submit" disabled={create.isPending}>Tambah</Button>
          </form>
        </Card>
      )}

      {years.isPending && <p className="text-sm text-slate-500">Memuat…</p>}
      {years.data && (
        <Table head={["Nama", "Periode", "Status", ""]}>
          {years.data.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-slate-500">Belum ada tahun ajaran.</td>
            </tr>
          )}
          {years.data.map((y) => (
            <tr key={y.id}>
              <td className="px-4 py-3 font-medium">{y.name}</td>
              <td className="px-4 py-3 text-slate-600">
                {formatDate(y.starts_on)} – {formatDate(y.ends_on)}
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    y.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {y.is_active ? "Aktif" : "Nonaktif"}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                {canEdit && !y.is_active && (
                  <Button variant="secondary" onClick={() => activate.mutate(y.id)} disabled={activate.isPending}>
                    Aktifkan
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
