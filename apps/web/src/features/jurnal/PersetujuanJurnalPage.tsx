import { useState } from "react";
import { Alert, Button, Card, ErrorAlert, Field, Input, Select, Table, cn } from "../../components/ui";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import {
  formatTanggal,
  formatWaktu,
  JOURNAL_STATUS_LABEL,
  type Journal,
  type JournalStatus,
} from "./types";
import { StatusBadge } from "./StatusBadge";

const FILTERS: JournalStatus[] = ["menunggu", "ditolak", "disetujui", "draft"];

/** Persetujuan jurnal untuk kepala sekolah dan admin. */
export function PersetujuanJurnalPage() {
  const [status, setStatus] = useState<JournalStatus>("menunggu");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const journals = useApiQuery<Journal[]>(
    ["jurnal", "review", status, from, to],
    `/jurnal?${new URLSearchParams({ status, ...(from && { from }), ...(to && { to }) })}`,
  );
  const selected = journals.data?.find((j) => j.id === selectedId) ?? null;

  const approve = useApiMutation<{ id: string; note: string }, Journal>(
    { method: "POST", path: (v) => `/jurnal/${v.id}/approve`, body: (v) => ({ note: v.note.trim() || null }) },
    [["jurnal"]],
  );
  const reject = useApiMutation<{ id: string; note: string }, Journal>(
    { method: "POST", path: (v) => `/jurnal/${v.id}/reject`, body: (v) => ({ note: v.note.trim() }) },
    [["jurnal"]],
  );
  const busy = approve.isPending || reject.isPending;
  const rejectOk = note.trim().length >= 3;

  function pick(j: Journal) {
    setSelectedId(j.id);
    setNote("");
    setDone(null);
    approve.reset();
    reject.reset();
  }

  async function decide(kind: "approve" | "reject") {
    if (!selected) return;
    const vars = { id: selected.id, note };
    try {
      if (kind === "approve") await approve.mutateAsync(vars);
      else await reject.mutateAsync(vars);
      setDone(
        kind === "approve"
          ? `Jurnal ${selected.class_name} · ${selected.subject_name} disetujui.`
          : `Jurnal ${selected.class_name} · ${selected.subject_name} ditolak. Guru akan melihat catatan Anda.`,
      );
      setSelectedId(null);
      setNote("");
    } catch {
      // Pesan error ditampilkan dari state mutasi.
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Persetujuan jurnal</h1>
        <p className="text-sm text-slate-500">
          Setujui atau tolak jurnal mengajar. Penolakan wajib disertai catatan agar guru bisa memperbaikinya.
        </p>
      </div>

      {done && <Alert tone="success">{done}</Alert>}

      <Card title="Daftar jurnal">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as JournalStatus)}>
              {FILTERS.map((s) => (
                <option key={s} value={s}>
                  {JOURNAL_STATUS_LABEL[s]}
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
          <p className="text-sm text-slate-500">Tidak ada jurnal dengan status ini.</p>
        ) : (
          <Table head={["Tanggal", "Jam", "Guru", "Kelas · Mapel", "Materi", "Status", ""]}>
            {journals.data?.map((j) => (
              <tr key={j.id} className={cn(j.id === selectedId && "bg-brand-50")}>
                <td className="whitespace-nowrap px-4 py-2.5">{formatTanggal(j.journal_date)}</td>
                <td className="px-4 py-2.5">{j.hour_no}</td>
                <td className="px-4 py-2.5">{j.teacher_name}</td>
                <td className="px-4 py-2.5">
                  {j.class_name} · {j.subject_name}
                </td>
                <td className="max-w-xs truncate px-4 py-2.5">{j.topic}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={j.status} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  {j.status === "menunggu" && (
                    <Button variant="secondary" onClick={() => pick(j)}>
                      Tinjau
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {selected && (
        <Card
          title="Tinjau jurnal"
          description={`${selected.teacher_name} · ${selected.class_name} · ${selected.subject_name}`}
          actions={<StatusBadge status={selected.status} />}
        >
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">Tanggal</dt>
              <dd className="font-medium">{formatTanggal(selected.journal_date)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Jam ke</dt>
              <dd className="font-medium">{selected.hour_no}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Jumlah hadir</dt>
              <dd className="font-medium">{selected.present_count ?? "Tidak dicatat"}</dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="text-slate-500">Materi</dt>
              <dd className="font-medium">{selected.topic}</dd>
            </div>
            {selected.notes && (
              <div className="sm:col-span-3">
                <dt className="text-slate-500">Catatan guru</dt>
                <dd>{selected.notes}</dd>
              </div>
            )}
            {selected.submitted_at && (
              <div className="sm:col-span-3">
                <dt className="text-slate-500">Dikirim</dt>
                <dd>{formatWaktu(selected.submitted_at)}</dd>
              </div>
            )}
          </dl>

          <Field label="Catatan untuk guru" hint="Wajib diisi saat menolak (minimal 3 karakter). Opsional saat menyetujui.">
            <textarea
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500"
            />
          </Field>

          <ErrorAlert error={approve.error ?? reject.error} />

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setSelectedId(null)} disabled={busy}>
              Batal
            </Button>
            <Button variant="danger" onClick={() => decide("reject")} disabled={busy || !rejectOk}>
              Tolak
            </Button>
            <Button onClick={() => decide("approve")} disabled={busy}>
              Setujui
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
