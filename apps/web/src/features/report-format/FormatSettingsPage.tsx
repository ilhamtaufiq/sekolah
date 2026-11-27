import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Alert, Button, Card, Field, Input, cn } from "../../components/kit";
import { FormatPreview } from "./FormatPreview";
import { HistoryPanel } from "./HistoryPanel";
import {
  FONTS,
  PAPERS,
  SECTION_KINDS,
  SECTION_LABELS,
  formSchema,
  type FormOutput,
  type FormValues,
} from "./schema";
import {
  type FormatResponse,
  type ReportFormatConfig,
  useReportFormat,
  useSaveReportFormat,
} from "./api";

/** Bentuk form: bagian raport disimpan sebagai daftar lengkap dengan status aktif. */
function toFormValues(config: ReportFormatConfig): FormValues {
  const enabled = config.sections;
  const rest = SECTION_KINDS.filter((k) => !enabled.includes(k));
  return {
    kop: { title: config.kop.title, subtitle: config.kop.subtitle ?? "", address: config.kop.address },
    page: { ...config.page, font_family: config.page.font_family as FormValues["page"]["font_family"] },
    grading: {
      min_score: config.grading.min_score,
      max_score: config.grading.max_score,
      kkm: config.grading.kkm,
      decimal_places: config.grading.decimal_places,
      predicates: config.grading.predicates.map((p) => ({ label: p.label, min: p.min, description: p.description ?? "" })),
    },
    sections: [...enabled.map((kind) => ({ kind, enabled: true })), ...rest.map((kind) => ({ kind, enabled: false }))],
    signatures: {
      city: config.signatures.city,
      wali_kelas_title: config.signatures.wali_kelas_title,
      kepala_sekolah_name: config.signatures.kepala_sekolah_name,
      kepala_sekolah_nip: config.signatures.kepala_sekolah_nip ?? "",
    },
  };
}

function toApiConfig(v: FormOutput, schemaVersion: number): ReportFormatConfig {
  return {
    schema_version: schemaVersion,
    kop: { title: v.kop.title, subtitle: v.kop.subtitle ?? null, address: v.kop.address },
    page: v.page,
    grading: {
      min_score: v.grading.min_score,
      max_score: v.grading.max_score,
      kkm: v.grading.kkm,
      decimal_places: v.grading.decimal_places,
      predicates: v.grading.predicates.map((p) => ({ label: p.label, min: p.min, description: p.description ?? null })),
    },
    sections: v.sections.filter((s) => s.enabled).map((s) => s.kind),
    signatures: {
      city: v.signatures.city,
      wali_kelas_title: v.signatures.wali_kelas_title,
      kepala_sekolah_name: v.signatures.kepala_sekolah_name,
      kepala_sekolah_nip: v.signatures.kepala_sekolah_nip ?? null,
    },
  };
}

export function FormatSettingsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const query = useReportFormat();
  const save = useSaveReportFormat();
  const [saved, setSaved] = useState<FormatResponse | null>(null);

  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema) as Resolver<FormValues, unknown, FormOutput>,
    mode: "onTouched",
  });
  const { register, control, handleSubmit, reset, watch, formState } = form;
  const predicates = useFieldArray({ control, name: "grading.predicates" });
  const sections = useFieldArray({ control, name: "sections" });

  const loaded = query.data;
  useEffect(() => {
    if (loaded) reset(toFormValues(loaded.config));
  }, [loaded, reset]);

  const watched = watch();
  // Render pertama terjadi sebelum reset() mengisi form, jadi nilai watch() masih kosong.
  const preview = useMemo(() => {
    if (!loaded || !watched.kop || !watched.grading || !watched.signatures) return null;
    return toApiConfig(watched as FormOutput, loaded.config.schema_version);
  }, [watched, loaded]);

  const serverError = save.error instanceof ApiError ? save.error : null;
  const conflict = serverError?.status === 409;
  const validationIssues = serverError?.status === 422 ? serverError.details : [];

  const onSubmit = handleSubmit(async (values) => {
    if (!loaded) return;
    setSaved(null);
    const config = toApiConfig(values, loaded.config.schema_version);
    try {
      const res = await save.mutateAsync({ expectedVersion: loaded.version, config });
      setSaved(res);
      reset(toFormValues(res.config));
    } catch {
      // Error ditampilkan dari state mutation.
    }
  });

  if (query.isPending) return <p className="text-sm text-slate-500">Memuat pengaturan…</p>;
  if (query.isError) return <Alert tone="error">Gagal memuat pengaturan: {query.error.message}</Alert>;
  if (!loaded) return null;

  const sectionRows = sections.fields;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <header className="space-y-1">
          <p className="text-sm text-slate-500">Pengaturan · Raport</p>
          <h1 className="text-2xl font-semibold tracking-tight">Format raport</h1>
          <p className="text-sm text-slate-600">
            Versi aktif <span className="font-medium">v{loaded.version}</span>
            {loaded.updated_by && loaded.updated_at && (
              <> · diubah oleh {loaded.updated_by} pada {new Date(loaded.updated_at).toLocaleString("id-ID")}</>
            )}
          </p>
        </header>

        {!canEdit && (
          <Alert tone="info">Anda hanya bisa melihat pengaturan ini. Perubahan dilakukan oleh admin sekolah.</Alert>
        )}
        {saved && <Alert tone="success">Pengaturan disimpan sebagai v{saved.version}.</Alert>}
        {conflict && (
          <Alert tone="warning">
            {serverError?.message}. Perubahan Anda belum tersimpan. Muat ulang halaman untuk melihat versi terbaru.
          </Alert>
        )}
        {serverError && !conflict && validationIssues.length === 0 && (
          <Alert tone="error">{serverError.message}</Alert>
        )}
        {validationIssues.length > 0 && (
          <Alert tone="error">
            <p className="mb-1 font-medium">Periksa kembali isian berikut:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {validationIssues.map((i, idx) => (
                <li key={idx}>
                  <code className="text-xs">{i.field}</code>: {i.message}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <fieldset disabled={!canEdit} className="space-y-6 disabled:opacity-80">
            <Card title="Kop surat" description="Teks di bagian atas raport setiap siswa.">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Nama sekolah" error={formState.errors.kop?.title?.message}>
                  <Input {...register("kop.title")} />
                </Field>
                <Field label="Subjudul" hint="Opsional, mis. status akreditasi" error={formState.errors.kop?.subtitle?.message}>
                  <Input {...register("kop.subtitle")} />
                </Field>
              </div>
              <Field label="Alamat" error={formState.errors.kop?.address?.message}>
                <Input {...register("kop.address")} />
              </Field>
            </Card>

            <Card title="Halaman & huruf" description="Pengaturan cetak untuk PDF raport.">
              <div className="grid gap-4 md:grid-cols-4">
                <Field label="Ukuran kertas">
                  <select className={selectClass} {...register("page.paper")}>
                    {PAPERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Margin (mm)" error={formState.errors.page?.margin_mm?.message}>
                  <Input type="number" step="1" {...register("page.margin_mm", { valueAsNumber: true })} />
                </Field>
                <Field label="Font">
                  <select className={selectClass} {...register("page.font_family")}>
                    {FONTS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Ukuran huruf (pt)" error={formState.errors.page?.font_size_pt?.message}>
                  <Input type="number" step="0.5" {...register("page.font_size_pt", { valueAsNumber: true })} />
                </Field>
              </div>
            </Card>

            <Card title="Penilaian" description="Rentang nilai, KKM, dan predikat yang tampil di raport.">
              <div className="grid gap-4 md:grid-cols-4">
                <Field label="Nilai minimal" error={formState.errors.grading?.min_score?.message}>
                  <Input type="number" {...register("grading.min_score", { valueAsNumber: true })} />
                </Field>
                <Field label="Nilai maksimal" error={formState.errors.grading?.max_score?.message}>
                  <Input type="number" {...register("grading.max_score", { valueAsNumber: true })} />
                </Field>
                <Field label="KKM" error={formState.errors.grading?.kkm?.message}>
                  <Input type="number" {...register("grading.kkm", { valueAsNumber: true })} />
                </Field>
                <Field label="Desimal" hint="0–2 angka" error={formState.errors.grading?.decimal_places?.message}>
                  <Input type="number" {...register("grading.decimal_places", { valueAsNumber: true })} />
                </Field>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-slate-700">Predikat</h3>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={predicates.fields.length >= 10}
                    onClick={() => predicates.append({ label: "", min: 0, description: "" })}
                  >
                    Tambah predikat
                  </Button>
                </div>
                {formState.errors.grading?.predicates?.message && (
                  <p className="text-xs text-red-600">{formState.errors.grading.predicates.message}</p>
                )}
                <div className="space-y-2">
                  {predicates.fields.map((field, i) => (
                    <div key={field.id} className="grid grid-cols-[64px_88px_minmax(0,1fr)_auto] items-start gap-2">
                      <Input placeholder="Label" aria-label={`Label predikat ${i + 1}`} {...register(`grading.predicates.${i}.label`)} />
                      <Input
                        type="number"
                        placeholder="Dari nilai"
                        aria-label={`Batas bawah predikat ${i + 1}`}
                        {...register(`grading.predicates.${i}.min`, { valueAsNumber: true })}
                      />
                      <Input placeholder="Deskripsi, mis. Sangat baik" aria-label={`Deskripsi predikat ${i + 1}`} {...register(`grading.predicates.${i}.description`)} />
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={predicates.fields.length <= 1}
                        onClick={() => predicates.remove(i)}
                        aria-label={`Hapus predikat ${i + 1}`}
                      >
                        Hapus
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card title="Bagian raport" description="Centang untuk menampilkan. Urutan dari atas ke bawah sama dengan cetakan.">
              {formState.errors.sections?.message && (
                <p className="text-xs text-red-600">{formState.errors.sections.message}</p>
              )}
              <ol className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {sectionRows.map((row, i) => {
                  const kind = row.kind as (typeof SECTION_KINDS)[number];
                  return (
                    <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        {...register(`sections.${i}.enabled`)}
                        aria-label={`Tampilkan ${SECTION_LABELS[kind]}`}
                      />
                      <span className={cn("flex-1 text-sm", !watched.sections?.[i]?.enabled && "text-slate-400")}>
                        {SECTION_LABELS[kind]}
                      </span>
                      <Button type="button" variant="ghost" disabled={i === 0} onClick={() => sections.move(i, i - 1)} aria-label="Naikkan">↑</Button>
                      <Button type="button" variant="ghost" disabled={i === sectionRows.length - 1} onClick={() => sections.move(i, i + 1)} aria-label="Turunkan">↓</Button>
                    </li>
                  );
                })}
              </ol>
            </Card>

            <Card title="Tanda tangan" description="Blok tanda tangan di akhir raport.">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Kota" error={formState.errors.signatures?.city?.message}>
                  <Input {...register("signatures.city")} />
                </Field>
                <Field label="Jabatan wali kelas" error={formState.errors.signatures?.wali_kelas_title?.message}>
                  <Input {...register("signatures.wali_kelas_title")} />
                </Field>
                <Field label="Nama kepala sekolah" error={formState.errors.signatures?.kepala_sekolah_name?.message}>
                  <Input {...register("signatures.kepala_sekolah_name")} />
                </Field>
                <Field label="NIP kepala sekolah" hint="Opsional" error={formState.errors.signatures?.kepala_sekolah_nip?.message}>
                  <Input {...register("signatures.kepala_sekolah_nip")} />
                </Field>
              </div>
            </Card>

            {canEdit && (
              <div className="sticky bottom-3 flex items-center justify-end gap-3 rounded-xl bg-white p-3 shadow-lg ring-1 ring-slate-200">
                <Button type="button" variant="secondary" onClick={() => reset(toFormValues(loaded.config))} disabled={!formState.isDirty}>
                  Batalkan perubahan
                </Button>
                <Button type="submit" disabled={save.isPending || !formState.isDirty}>
                  {save.isPending ? "Menyimpan…" : `Simpan sebagai v${loaded.version + 1}`}
                </Button>
              </div>
            )}
          </fieldset>
        </form>
      </div>

      <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
        {preview && <FormatPreview config={preview} />}
        <HistoryPanel canRestore={canEdit} currentVersion={loaded.version} />
      </aside>
    </div>
  );
}

const selectClass =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500";
