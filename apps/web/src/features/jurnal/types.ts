export type JournalStatus = "draft" | "menunggu" | "disetujui" | "ditolak";

export const JOURNAL_STATUS_LABEL: Record<JournalStatus, string> = {
  draft: "Draf",
  menunggu: "Menunggu persetujuan",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
};

export const JOURNAL_STATUS_STYLE: Record<JournalStatus, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  menunggu: "bg-amber-50 text-amber-800 ring-amber-200",
  disetujui: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  ditolak: "bg-red-50 text-red-800 ring-red-200",
};

export type Journal = {
  id: string;
  assignment_id: string;
  class_name: string;
  subject_name: string;
  teacher_id: string;
  teacher_name: string;
  journal_date: string;
  hour_no: number;
  topic: string;
  notes: string | null;
  present_count: number | null;
  status: JournalStatus;
  submitted_at: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
};

export type JournalRekap = {
  assignment_id: string;
  class_name: string;
  subject_name: string;
  teacher_name: string;
  jumlah_jam: number;
  jumlah_hari: number;
  jam_dengan_hadir: number;
  total_hadir: number;
};

export type JournalInput = {
  journal_date: string;
  hour_no: number;
  topic: string;
  notes: string | null;
  present_count: number | null;
};

export function formatTanggal(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatWaktu(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}
