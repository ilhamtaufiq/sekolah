import { useState } from "react";
import { usePagination } from "../../lib/pagination";
import { Alert, Button, Card, ErrorAlert, Field, Input, Select, Table, PageHeader, Pagination } from "../../components/ui";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import type { AcademicYear, ClassRow } from "../academic/types";

type Decision = "naik" | "tinggal" | "lulus";

type RosterRow = {
  student_id: string;
  nis: string;
  name: string;
  status: string;
  class_id: string;
  class_name: string;
  decision: Decision | null;
  to_class_id: string | null;
  processed_at: string | null;
};

type Draft = { decision: "" | Decision; toClass: string };

type ProcessBody = {
  academic_year_id: string;
  certificate_code: string | null;
  items: { student_id: string; decision: Decision; to_class_id: string | null }[];
};

type ProcessResult = {
  processed: number;
  certificates: { student_id: string; nomor: string }[];
};

const DECISION_LABEL: Record<Decision, string> = {
  naik: "Naik kelas",
  tinggal: "Tinggal di kelas",
  lulus: "Lulus",
};

/** Proses kenaikan kelas satu tahun ajaran. Keputusan lulus menerbitkan sertifikat bernomor. */
export function KenaikanPage() {
  const years = useApiQuery<AcademicYear[]>(["academic-years"], "/academic-years");
  const [sourceChoice, setSourceChoice] = useState("");
  const [targetChoice, setTargetChoice] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ProcessResult | null>(null);

  const sourceId = sourceChoice || years.data?.find((y) => y.is_active)?.id || "";
  const targetId = targetChoice || years.data?.find((y) => y.id !== sourceId)?.id || "";

  const roster = useApiQuery<RosterRow[]>(
    ["promotions", sourceId],
    sourceId ? `/promotions?academic_year_id=${sourceId}` : null,
  );
  const pg = usePagination(roster.data ?? [], 25);
  const targetClasses = useApiQuery<ClassRow[]>(
    ["classes", targetId],
    targetId ? `/classes?academic_year_id=${targetId}` : null,
  );

  const process = useApiMutation<ProcessBody, ProcessResult>(
    { method: "POST", path: () => "/promotions/process", body: (b) => b },
    [["promotions"], ["classes"], ["students"]],
  );

  const setDraft = (studentId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => {
      const current = prev[studentId] ?? { decision: "", toClass: "" };
      return { ...prev, [studentId]: { ...current, ...patch } };
    });
  };

  const pending = (roster.data ?? []).filter((r) => !r.decision && r.status === "aktif");
  const chosen = pending.filter((r) => drafts[r.student_id]?.decision);

  const submit = async () => {
    setResult(null);
    const body: ProcessBody = {
      academic_year_id: sourceId,
      certificate_code: code.trim() || null,
      items: chosen.map((r) => {
        const d = drafts[r.student_id];
        return {
          student_id: r.student_id,
          decision: d.decision as Decision,
          to_class_id: d.decision === "lulus" ? null : d.toClass || null,
        };
      }),
    };
    try {
      const res = await process.mutateAsync(body);
      setResult(res);
      setDrafts({});
    } catch {
      // Pesan kesalahan ditampilkan lewat ErrorAlert di bawah.
    }
  };

  const sourceName = years.data?.find((y) => y.id === sourceId)?.name ?? "";

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Akademik" title="Proses kenaikan kelas" description="Tentukan keputusan tiap siswa. Siswa yang lulus mendapat sertifikat dengan nomor unik. Semua keputusan diproses sekaligus; bila ada yang salah, tidak ada yang tersimpan." />

      <ErrorAlert error={years.error} />
      <ErrorAlert error={roster.error} />
      <ErrorAlert error={process.error} />
      {result && (
        <Alert tone="success">
          <p>Berhasil memproses {result.processed} siswa.</p>
          {result.certificates.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {result.certificates.map((c) => (
                <li key={c.student_id}>
                  Nomor sertifikat: <code className="text-xs">{c.nomor}</code>
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <Card title="Pilih tahun ajaran" description="Tahun asal siswa dan tahun tujuan untuk memilih kelas baru.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tahun ajaran asal">
            <Select value={sourceId} onChange={(e) => setSourceChoice(e.target.value)}>
              {(years.data ?? []).map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                  {y.is_active ? " (aktif)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tahun ajaran tujuan">
            <Select value={targetId} onChange={(e) => setTargetChoice(e.target.value)}>
              {(years.data ?? [])
                .filter((y) => y.id !== sourceId)
                .map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Kode sertifikat" hint="Kosongkan untuk memakai slug sekolah (huruf besar).">
            <Input value={code} maxLength={20} placeholder="Mis. SDN1" onChange={(e) => setCode(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card
        title={sourceName ? `Siswa tahun ${sourceName}` : "Siswa"}
        description="Hanya siswa aktif yang belum diproses yang bisa diberi keputusan."
        actions={
          <Button onClick={() => void submit()} disabled={chosen.length === 0 || process.isPending}>
            {process.isPending ? "Memproses…" : `Proses ${chosen.length} keputusan`}
          </Button>
        }
      >
        {roster.data && roster.data.length === 0 && (
          <Alert tone="info">Belum ada siswa yang terdaftar di kelas pada tahun ajaran ini.</Alert>
        )}
        {roster.data && roster.data.length > 0 && (
          <>
            <Table head={["Siswa", "Kelas asal", "Keputusan", "Kelas tujuan", "Keterangan"]}>
              {pg.items.map((r) => {
                const isPending = !r.decision && r.status === "aktif";
                const draft = drafts[r.student_id] ?? { decision: "", toClass: "" };
                return (
                  <tr key={r.student_id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-slate-500">NIS {r.nis}</p>
                    </td>
                    <td className="px-4 py-3">{r.class_name}</td>
                    <td className="px-4 py-3">
                      {isPending ? (
                        <Select
                          aria-label={`Keputusan ${r.name}`}
                          value={draft.decision}
                          onChange={(e) => setDraft(r.student_id, { decision: e.target.value as Draft["decision"] })}
                        >
                          <option value="">Belum dipilih</option>
                          <option value="naik">Naik kelas</option>
                          <option value="tinggal">Tinggal di kelas</option>
                          <option value="lulus">Lulus</option>
                        </Select>
                      ) : (
                        <span className="font-medium">{r.decision ? DECISION_LABEL[r.decision] : "-"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isPending && draft.decision && draft.decision !== "lulus" ? (
                        <Select
                          aria-label={`Kelas tujuan ${r.name}`}
                          value={draft.toClass}
                          onChange={(e) => setDraft(r.student_id, { toClass: e.target.value })}
                        >
                          <option value="">Pilih kelas</option>
                          {(targetClasses.data ?? []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} (tingkat {c.grade_level})
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {r.status !== "aktif"
                        ? `Status ${r.status}`
                        : r.processed_at
                          ? `Diproses ${new Date(r.processed_at).toLocaleDateString("id-ID")}`
                          : ""}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination {...pg} />
          </>
        )}
      </Card>
    </div>
  );
}
