import { ApiError } from "../../lib/api";

/**
 * Mengunduh berkas lewat endpoint yang dicek server. Header Authorization ikut terkirim
 * karena link biasa tidak membawa token.
 */
export async function downloadFile(fileId: number | string, token: string | null, fileName: string): Promise<void> {
  const res = await fetch(`/api/lms/files/${fileId}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? "unknown", data.message ?? "Gagal mengunduh berkas", []);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type FileItem = { id: string; file_name: string; mime: string; size_bytes: number };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}
