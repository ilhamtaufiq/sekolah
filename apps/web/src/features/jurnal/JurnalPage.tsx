import { useState } from "react";
import { Link } from "react-router";
import { Alert, Card, ErrorAlert, Field, Input, Select, Table } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { useApiQuery } from "../../lib/hooks";
import { formatTanggal, JOURNAL_STATUS_LABEL, type Journal, type JournalRekap, type JournalStatus } from "./types";
import type { Assignment } from "../academic/types";
import { StatusBadge } from "./StatusBadge";

const STATUS_FILTER: ("" | JournalStatus)[] = ["", "draft", "menunggu", "ditolak", "disetujui"];

/** Daftar jurnal guru beserta rekap jurnal yang disetujui. */
export function JurnalPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<"" | JournalStatus>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const journals = useApiQuery<Journal[]>(
    ["jurnal", "list", status, from, to],
    `/jurnal?${new URLSearchParams({ ...(status && { status }), ...(from && { from }), ...(to && { to }) })}`,
  );
  const assignments = useApiQuery<Assignment[]>(
    ["assignments", "mine", user?.id ?? ""],
    user ? `/assignments?teacher_id=${user.id}` : null,
  );
  const rekap = useApiQuery<JournalRekap[]>(
    ["jurnal", "rekap", from, to],
    `/jurnal/rekap?${new URLSearchParams({ ...(from && { from }), ...(to && { to }) })}`,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Jurnal mengajar</h1>
          <p className="text-sm text-slate-500">
            Catat materi per jam pelajaran. Jurnal yang disetujui kepala sekolah masuk ke rekap.
          </p>
        </div>
        <Link
          to="/jurnal/baru"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Catat jurnal
        </Link>
      </div>

      {assignments.data?.length === 0 && (
        <Alert tone="info">Anda belum punya penugasan mengajar. Minta admin menambahkannya di menu Jadwal atau Guru &amp; staf.</Alert>
      )}

      <Card title="Daftar jurnal" description="Jurnal Anda, terbaru di atas.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as "" | JournalStatus)}>
              {STATUS_FILTER.map((s) => (
                <option key={s || "semua"} value={s}>
                  {s ? JOURNAL_STATUS_LABEL[s] : "Semua status"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dari tanggal">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Sampai tanggal">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        <ErrorAlert error={journals.error} />
        {journals.isPending ? (
          <p className="text-sm text-slate-500">Memuat jurnal…</p>
        ) : journals.data?.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada jurnal untuk filter ini.</p>
        ) : (
          <Table head={["Tanggal", "Jam ke", "Kelas · Mapel", "Materi", "Status", ""]}>
            {journals.data?.map((j) => (
              <tr key={j.id}>
                <td className="whitespace-nowrap px-4 py-2.5">{formatTanggal(j.journal_date)}</td>
                <td className="px-4 py-2.5">{j.hour_no}</td>
                <td className="px-4 py-2.5">
                  {j.class_name} · {j.subject_name}
                </td>
                <td className="max-w-xs truncate px-4 py-2.5">{j.topic}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={j.status} />
                  {j.status === "ditolak" && j.decision_note && (
                    <p className="mt-1 text-xs text-red-700">Catatan: {j.decision_note}</p>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link to={`/jurnal/${j.id}`} className="font-medium text-brand-700 hover:underline">
                    {j.status === "draft" || j.status === "ditolak" ? "Ubah" : "Lihat"}
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Rekap jurnal disetujui" description="Hanya jurnal yang sudah disetujui kepala sekolah yang dihitung. Atur rentang tanggal di atas.">
        <ErrorAlert error={rekap.error} />
        {rekap.isPending ? (
          <p className="text-sm text-slate-500">Memuat rekap…</p>
        ) : rekap.data?.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada jurnal yang disetujui pada rentang ini.</p>
        ) : (
          <Table head={["Kelas · Mapel", "Jam", "Hari", "Jam dengan jumlah hadir", "Total hadir"]}>
            {rekap.data?.map((r) => (
              <tr key={r.assignment_id}>
                <td className="px-4 py-2.5">
                  {r.class_name} · {r.subject_name}
                </td>
                <td className="px-4 py-2.5">{r.jumlah_jam}</td>
                <td className="px-4 py-2.5">{r.jumlah_hari}</td>
                <td className="px-4 py-2.5">{r.jam_dengan_hadir}</td>
                <td className="px-4 py-2.5">{r.total_hadir}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
