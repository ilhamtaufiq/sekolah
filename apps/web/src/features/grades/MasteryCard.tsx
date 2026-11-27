import { useMemo } from "react";
import { Card, ErrorAlert, Table, cn } from "../../components/ui";
import { useApiQuery } from "../../lib/hooks";
import type { MasteryRow } from "./types";

type Props = { classId: string; semesterId: string };

/** Ketuntasan per mapel: tuntas atau belum, dari KKM yang tersimpan di nilai akhir. */
export function MasteryCard({ classId, semesterId }: Props) {
  const ready = !!classId && !!semesterId;
  const mastery = useApiQuery<MasteryRow[]>(
    ["term-mastery", classId, semesterId],
    ready ? `/term-mastery?class_id=${classId}&semester_id=${semesterId}` : null,
  );

  const rows = mastery.data ?? [];
  const subjects = useMemo(
    () => Array.from(new Set(rows.flatMap((r) => r.subjects.map((s) => s.subject)))),
    [rows],
  );

  return (
    <Card
      title="Ketuntasan tujuan per mapel"
      description="Tuntas bila nilai akhir mencapai KKM. Hitung ulang nilai akhir setelah KKM format berubah."
    >
      <ErrorAlert error={mastery.error} />
      {mastery.data && rows.length === 0 && <p className="text-sm text-slate-500">Kelas ini belum punya siswa.</p>}
      {rows.length > 0 && subjects.length === 0 && (
        <p className="text-sm text-slate-500">Belum ada nilai akhir. Hitung nilai akhir per mapel terlebih dahulu.</p>
      )}
      {rows.length > 0 && subjects.length > 0 && (
        <div className="overflow-x-auto">
          <Table head={["Siswa", ...subjects, "Tuntas", "Belum"]}>
            {rows.map((r) => (
              <tr key={r.student_id}>
                <td className="whitespace-nowrap px-4 py-2.5 font-medium">
                  {r.name} <span className="font-mono text-xs text-slate-500">{r.nis}</span>
                </td>
                {subjects.map((subject) => {
                  const item = r.subjects.find((s) => s.subject === subject);
                  const label = item?.tuntas === true ? "Tuntas" : item?.tuntas === false ? "Belum" : "-";
                  return (
                    <td
                      key={subject}
                      className={cn(
                        "px-4 py-2.5 text-sm",
                        label === "Tuntas" && "text-emerald-700",
                        label === "Belum" && "text-red-600",
                        label === "-" && "text-slate-400",
                      )}
                    >
                      {label}
                    </td>
                  );
                })}
                <td className="px-4 py-2.5">{r.tuntas}</td>
                <td className="px-4 py-2.5">{r.belum_tuntas}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}
