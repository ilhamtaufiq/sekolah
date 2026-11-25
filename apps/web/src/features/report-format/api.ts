import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { SectionKind } from "./schema";

export type ReportFormatConfig = {
  schema_version: number;
  kop: { title: string; subtitle: string | null; address: string };
  page: { paper: "a4" | "f4" | "letter"; margin_mm: number; font_family: string; font_size_pt: number };
  grading: {
    min_score: number;
    max_score: number;
    kkm: number;
    decimal_places: number;
    predicates: { label: string; min: number; description: string | null }[];
  };
  sections: SectionKind[];
  signatures: {
    city: string;
    wali_kelas_title: string;
    kepala_sekolah_name: string;
    kepala_sekolah_nip: string | null;
  };
};

export type FormatResponse = {
  version: number;
  config: ReportFormatConfig;
  updated_at: string | null;
  updated_by: string | null;
};

export type HistoryItem = {
  version: number;
  action: "update" | "restore";
  changed_by: string | null;
  changed_at: string;
  config: ReportFormatConfig;
};

const KEY = ["report-format"] as const;

export function useReportFormat() {
  const { token } = useAuth();
  return useQuery({
    queryKey: [...KEY],
    queryFn: () => api<FormatResponse>("/report-format", { token }),
    enabled: !!token,
  });
}

export function useReportFormatHistory() {
  const { token } = useAuth();
  return useQuery({
    queryKey: [...KEY, "history"],
    queryFn: () => api<HistoryItem[]>("/report-format/history", { token }),
    enabled: !!token,
  });
}

export function useSaveReportFormat() {
  const { token } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { expectedVersion: number; config: ReportFormatConfig }) =>
      api<FormatResponse>("/report-format", {
        method: "PUT",
        token,
        body: { expected_version: vars.expectedVersion, config: vars.config },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY] }),
  });
}

export function useRestoreReportFormat() {
  const { token } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { version: number; expectedVersion: number }) =>
      api<FormatResponse>(`/report-format/restore/${vars.version}/${vars.expectedVersion}`, {
        method: "POST",
        token,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY] }),
  });
}
