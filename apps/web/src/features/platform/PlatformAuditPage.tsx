import { useState } from "react";
import { Link } from "react-router";
import { EmptyState, PageHeader, Table, TableCell, TableRow } from "../../components/kit";
import { Input } from "../../components/kit";
import { useApiQuery } from "../../lib/hooks";
import { PlatformShell } from "./PlatformShell";
import { AUDIT_LABELS, formatWhen, summarizeDetail, type AuditRow } from "./audit-labels";

/** Jejak audit seluruh platform: semua aksi super admin di semua sekolah. */
export function PlatformAuditPage() {
  const audit = useApiQuery<AuditRow[]>(["platform", "audit"], "/platform/audit?limit=500");
  const [query, setQuery] = useState("");
  const rows = (audit.data ?? []).filter((a) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (a.school_name ?? "").toLowerCase().includes(q) || a.actor_name.toLowerCase().includes(q) || (AUDIT_LABELS[a.action] ?? a.action).toLowerCase().includes(q);
  });

  return (
    <PlatformShell>
      <PageHeader title="Jejak audit" description="Setiap perubahan oleh super admin, dari semua sekolah, terbaru di atas." />
      <Input className="max-w-xs" placeholder="Cari sekolah, pelaku, atau aksi" value={query} onChange={(e) => setQuery(e.target.value)} />
      {audit.isPending && <p className="text-sm text-muted-foreground">Memuat jejak audit…</p>}
      {audit.data && rows.length === 0 && <EmptyState title="Belum ada aksi tercatat." />}
      {rows.length > 0 && (
        <Table head={["Waktu", "Sekolah", "Aksi", "Oleh", "Rincian"]}>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="text-muted-foreground">{formatWhen(a.created_at)}</TableCell>
              <TableCell>
                {a.school_id ? <Link to={`/platform/sekolah/${a.school_id}`} className="hover:underline">{a.school_name}</Link> : "—"}
              </TableCell>
              <TableCell>{AUDIT_LABELS[a.action] ?? a.action}</TableCell>
              <TableCell>{a.actor_name}</TableCell>
              <TableCell className="whitespace-normal text-muted-foreground">{summarizeDetail(a.detail)}</TableCell>
            </TableRow>
          ))}
        </Table>
      )}
    </PlatformShell>
  );
}
