export type FieldIssue = { field: string; message: string };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: FieldIssue[];

  constructor(status: number, code: string, message: string, details: FieldIssue[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Options = {
  method?: "GET" | "PUT" | "PATCH" | "POST" | "DELETE";
  body?: unknown;
  token?: string | null;
};

/** Memanggil API. Path relatif terhadap /api, mis. "/me". */
export async function api<T>(path: string, { method = "GET", body, token }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      data.error ?? "unknown",
      data.message ?? `Permintaan gagal (${res.status})`,
      data.details ?? [],
    );
  }
  return res.json() as Promise<T>;
}
