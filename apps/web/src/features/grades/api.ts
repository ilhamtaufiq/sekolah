import { ApiError } from "../../lib/api";

/** Unduh PDF dengan token. Tidak memakai api() karena responsnya biner. */
export async function downloadPdf(path: string, token: string | null, filename: string): Promise<void> {
  const res = await fetch(`/api${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? "unknown", data.message ?? `Unduh gagal (${res.status})`, data.details ?? []);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
