import { SECTION_LABELS, type SectionKind } from "./schema";
import type { ReportFormatConfig } from "./api";
import { Card } from "../../components/kit";

/** Pratinjau kasar, bukan render PDF. Cukup untuk melihat kop, predikat, dan urutan bagian. */
export function FormatPreview({ config }: { config: ReportFormatConfig }) {
  const fontFamily = config.page.font_family;
  const sectionKinds = config.sections as SectionKind[];

  return (
    <Card title="Pratinjau" description="Perkiraan tampilan. PDF final dibuat saat cetak raport.">
      <div
        className="mx-auto aspect-[210/297] w-full max-w-[280px] overflow-hidden rounded-md bg-white p-5 text-[11px] leading-snug text-slate-800 shadow-inner ring-1 ring-slate-200"
        style={{ fontFamily }}
      >
        <div className="border-b-2 border-slate-800 pb-2 text-center">
          <p className="text-[13px] font-bold uppercase leading-tight">{config.kop.title || "—"}</p>
          {config.kop.subtitle && <p className="text-[10px]">{config.kop.subtitle}</p>}
          <p className="text-[9px] text-slate-600">{config.kop.address}</p>
        </div>

        <p className="mt-3 text-center text-[11px] font-semibold uppercase">Laporan hasil belajar</p>

        <div className="mt-3 space-y-3">
          {sectionKinds.map((kind) => (
            <div key={kind}>
              <p className="border-b border-slate-300 pb-0.5 text-[10px] font-semibold">{SECTION_LABELS[kind]}</p>
              {kind === "nilai_akademik" ? (
                <table className="mt-1 w-full text-[9px]">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="font-normal">Mapel</th>
                      <th className="text-right font-normal">Nilai</th>
                      <th className="text-right font-normal">Predikat</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Matematika</td>
                      <td className="text-right">{Math.min(config.grading.max_score, config.grading.kkm + 8).toFixed(config.grading.decimal_places)}</td>
                      <td className="text-right">{predicateFor(config, config.grading.kkm + 8)}</td>
                    </tr>
                    <tr>
                      <td>Bahasa Indonesia</td>
                      <td className="text-right">{config.grading.kkm.toFixed(config.grading.decimal_places)}</td>
                      <td className="text-right">{predicateFor(config, config.grading.kkm)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="mt-1 text-[9px] text-slate-400">…</p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-slate-200 pt-2 text-[9px]">
          <p className="text-slate-500">Predikat</p>
          {config.grading.predicates.map((p) => (
            <p key={p.label}>
              <span className="font-semibold">{p.label}</span> ({p.min}–{config.grading.max_score}) {p.description ?? ""}
            </p>
          ))}
        </div>

        <div className="mt-5 text-right text-[9px]">
          <p>{config.signatures.city}, ……</p>
          <p>{config.signatures.wali_kelas_title}</p>
          <div className="h-10" />
          <p>{config.signatures.kepala_sekolah_name}</p>
          {config.signatures.kepala_sekolah_nip && <p>NIP. {config.signatures.kepala_sekolah_nip}</p>}
        </div>
      </div>
    </Card>
  );
}

function predicateFor(config: ReportFormatConfig, score: number): string {
  const sorted = [...config.grading.predicates].sort((a, b) => b.min - a.min);
  return sorted.find((p) => score >= p.min)?.label ?? "—";
}
