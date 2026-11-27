import { useApiQuery } from "../../lib/hooks";

export type JenisLembaga = "sd" | "smp" | "sma" | "pkbm" | "paud" | "tk";

export type SchoolProfile = {
  id: string;
  name: string;
  slug: string;
  jenis_lembaga: JenisLembaga;
  /** Istilah UI dari backend (src/school_profile.rs). */
  terms: { student: string; class: string };
};

export const JENIS_LEMBAGA_OPTIONS: { value: JenisLembaga; label: string }[] = [
  { value: "sd", label: "SD" },
  { value: "smp", label: "SMP" },
  { value: "sma", label: "SMA" },
  { value: "pkbm", label: "PKBM" },
  { value: "paud", label: "PAUD" },
  { value: "tk", label: "TK" },
];

/**
 * Istilah UI untuk sekolah yang sedang login. Satu-satunya pembaca profil sekolah di frontend.
 * Sebelum profil termuat, dipakai istilah SD/SMP/SMA sebagai tampilan awal.
 */
export function useSchoolTerms() {
  const profile = useApiQuery<SchoolProfile>(["school-profile"], "/school-profile");
  return {
    profile: profile.data,
    terms: profile.data?.terms ?? { student: "Siswa", class: "Kelas" },
    isPending: profile.isPending,
  };
}
