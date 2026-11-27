import { useEffect, useMemo, useState } from "react";

/**
 * Paginasi di sisi klien untuk daftar yang sudah dimuat. Halaman kembali ke 1
 * bila jumlah data berubah (mis. setelah filter atau pencarian).
 */
export function usePagination<T>(items: readonly T[], pageSize = 25) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [items.length, pageSize]);

  const current = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize),
    [items, current, pageSize],
  );

  return {
    items: pageItems,
    page: current,
    pageCount,
    pageSize,
    total: items.length,
    from: items.length === 0 ? 0 : (current - 1) * pageSize + 1,
    to: Math.min(current * pageSize, items.length),
    setPage,
  };
}

export type Pagination<T> = ReturnType<typeof usePagination<T>>;
