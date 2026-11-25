import { z } from "zod";

// Harus sejalan dengan `report_format::model` di backend. Backend tetap jadi penjaga terakhir.

export const SECTION_KINDS = [
  "nilai_akademik",
  "sikap",
  "ekstrakurikuler",
  "absensi",
  "prestasi",
  "catatan_wali_kelas",
  "ranking",
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const SECTION_LABELS: Record<SectionKind, string> = {
  nilai_akademik: "Nilai akademik",
  sikap: "Sikap / perilaku",
  ekstrakurikuler: "Ekstrakurikuler",
  absensi: "Ketidakhadiran",
  prestasi: "Prestasi",
  catatan_wali_kelas: "Catatan wali kelas",
  ranking: "Ranking",
};

export const FONTS = ["Times New Roman", "Arial", "Calibri", "Georgia", "Tahoma"] as const;
export const PAPERS = [
  { value: "a4", label: "A4 (210 × 297 mm)" },
  { value: "f4", label: "F4 / Folio" },
  { value: "letter", label: "Letter" },
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .max(max, `Maksimal ${max} karakter`)
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined));

export const formSchema = z
  .object({
    kop: z.object({
      title: z.string().trim().min(1, "Wajib diisi").max(120, "Maksimal 120 karakter"),
      subtitle: optionalText(120),
      address: z.string().trim().min(1, "Wajib diisi").max(300, "Maksimal 300 karakter"),
    }),
    page: z.object({
      paper: z.enum(["a4", "f4", "letter"]),
      margin_mm: z.number().min(5, "Minimal 5 mm").max(40, "Maksimal 40 mm"),
      font_family: z.enum(FONTS),
      font_size_pt: z.number().min(8, "Minimal 8 pt").max(14, "Maksimal 14 pt"),
    }),
    grading: z.object({
      min_score: z.number().min(0, "Tidak boleh negatif"),
      max_score: z.number().max(1000, "Maksimal 1000"),
      kkm: z.number(),
      decimal_places: z.number().int().min(0).max(2),
      predicates: z
        .array(
          z.object({
            label: z.string().trim().min(1, "Wajib diisi").max(10, "Maksimal 10 karakter"),
            min: z.number(),
            description: optionalText(120),
          }),
        )
        .min(1, "Minimal 1 predikat")
        .max(10, "Maksimal 10 predikat"),
    }),
    sections: z.array(z.object({ kind: z.enum(SECTION_KINDS), enabled: z.boolean() })),
    signatures: z.object({
      city: z.string().trim().min(1, "Wajib diisi").max(60),
      wali_kelas_title: z.string().trim().min(1, "Wajib diisi").max(80),
      kepala_sekolah_name: z.string().trim().min(1, "Wajib diisi").max(120),
      kepala_sekolah_nip: optionalText(30),
    }),
  })
  .superRefine((v, ctx) => {
    const g = v.grading;
    if (g.min_score >= g.max_score) {
      ctx.addIssue({ code: "custom", path: ["grading", "max_score"], message: "Nilai maksimal harus lebih besar dari minimal" });
    }
    if (g.kkm < g.min_score || g.kkm > g.max_score) {
      ctx.addIssue({ code: "custom", path: ["grading", "kkm"], message: "KKM harus berada dalam rentang nilai" });
    }
    if (!g.predicates.some((p) => p.min === g.min_score)) {
      ctx.addIssue({
        code: "custom",
        path: ["grading", "predicates"],
        message: "Harus ada predikat dengan batas bawah sama dengan nilai minimal",
      });
    }
    g.predicates.forEach((p, i) => {
      if (p.min < g.min_score || p.min > g.max_score) {
        ctx.addIssue({ code: "custom", path: ["grading", "predicates", i, "min"], message: "Di luar rentang nilai" });
      }
    });
    if (!v.sections.some((s) => s.enabled)) {
      ctx.addIssue({ code: "custom", path: ["sections"], message: "Aktifkan minimal satu bagian" });
    }
  });

export type FormValues = z.input<typeof formSchema>;
export type FormOutput = z.output<typeof formSchema>;
