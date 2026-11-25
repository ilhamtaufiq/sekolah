import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "./api";
import { useAuth } from "./auth";

/** Query ber-token. `path` null = belum diaktifkan (misalnya menunggu pilihan kelas). */
export function useApiQuery<T>(key: QueryKey, path: string | null) {
  const { token } = useAuth();
  return useQuery({
    queryKey: key,
    queryFn: () => api<T>(path as string, { token }),
    enabled: !!token && !!path,
  });
}

type MutationSpec<TVars> = {
  method: "POST" | "PUT" | "DELETE";
  path: (vars: TVars) => string;
  body?: (vars: TVars) => unknown;
};

/** Mutasi ber-token. Setelah sukses, query dengan kunci `invalidate` dimuat ulang. */
export function useApiMutation<TVars, TOut = unknown>(spec: MutationSpec<TVars>, invalidate: QueryKey[] = []) {
  const { token } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) =>
      api<TOut>(spec.path(vars), {
        method: spec.method,
        token,
        body: spec.body ? spec.body(vars) : undefined,
      }),
    onSuccess: () => {
      invalidate.forEach((key) => qc.invalidateQueries({ queryKey: key }));
    },
  });
}

/** Ubah "07:00" menjadi "07:00:00" karena backend menerima HH:MM:SS. */
export function toTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}
