/** Label Indonesia untuk aksi di jejak audit platform. */
export const AUDIT_LABELS: Record<string, string> = {
  "school.create": "Sekolah dibuat",
  "school.update": "Nama atau slug diubah",
  "school.activate": "Sekolah diaktifkan",
  "school.deactivate": "Sekolah dinonaktifkan",
  "user.create_admin": "Admin ditambahkan",
  "user.reset_password": "Password admin direset",
};

export type AuditRow = {
  id: string;
  actor_name: string;
  action: string;
  school_id: string | null;
  school_name: string | null;
  detail: string | null;
  created_at: string;
};

export function formatWhen(value: string): string {
  return new Date(value).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Ringkas detail audit untuk ditampilkan; password tidak pernah disimpan di sini. */
export function summarizeDetail(detail: string | null): string {
  if (!detail) return "";
  try {
    const obj = JSON.parse(detail) as Record<string, unknown>;
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" · ");
  } catch {
    return detail;
  }
}
