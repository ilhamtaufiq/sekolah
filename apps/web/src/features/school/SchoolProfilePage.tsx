import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Card, ErrorAlert, Field, Select } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { useApiMutation } from "../../lib/hooks";
import { JENIS_LEMBAGA_OPTIONS, useSchoolTerms, type JenisLembaga, type SchoolProfile } from "./useSchoolTerms";

export function SchoolProfilePage() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const { profile, terms, isPending } = useSchoolTerms();
  const [jenis, setJenis] = useState<JenisLembaga>("sd");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile) setJenis(profile.jenis_lembaga);
  }, [profile]);

  const save = useApiMutation<JenisLembaga, SchoolProfile>(
    { method: "PUT", path: () => "/school-profile", body: (value) => ({ jenis_lembaga: value }) },
    [["school-profile"], ["classes"]],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    await save.mutateAsync(jenis);
    setSaved(true);
  };

  const label = JENIS_LEMBAGA_OPTIONS.find((o) => o.value === profile?.jenis_lembaga)?.label ?? "";

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">Pengaturan</p>
        <h1 className="text-2xl font-semibold tracking-tight">Profil sekolah</h1>
        <p className="text-sm text-slate-600">
          Jenis lembaga menentukan istilah di seluruh aplikasi. Saat ini: {label || "…"}, memakai istilah “{terms.student}” dan “{terms.class}”.
        </p>
      </header>

      <ErrorAlert error={save.error} />
      {saved && <Alert tone="success">Jenis lembaga disimpan.</Alert>}

      <Card title="Jenis lembaga" description="Perubahan berlaku untuk semua pengguna sekolah ini.">
        {isPending && <p className="text-sm text-slate-500">Memuat…</p>}
        {profile && (
          <form onSubmit={onSubmit} className="grid items-end gap-4 md:grid-cols-[1fr_auto]">
            <Field label="Nama sekolah">
              <p className="py-2 text-sm font-medium">{profile.name}</p>
            </Field>
            <Field label="Jenis lembaga">
              <Select value={jenis} onChange={(e) => setJenis(e.target.value as JenisLembaga)} disabled={!canEdit}>
                {JENIS_LEMBAGA_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            {canEdit && (
              <div className="md:col-span-2">
                <Button type="submit" disabled={save.isPending || jenis === profile.jenis_lembaga}>
                  Simpan jenis lembaga
                </Button>
              </div>
            )}
          </form>
        )}
      </Card>
    </div>
  );
}
