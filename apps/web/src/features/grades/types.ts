export type Semester = { id: string; academic_year_id: string; ordinal: number; name: string; starts_on: string; ends_on: string };

export type Component = { id: string; assignment_id: string; semester_id: string; name: string; weight: number };

export type EntryRow = { student_id: string; nis: string; name: string; score: number | null; note: string | null };

export type FinalRow = {
  student_id: string;
  nis: string;
  name: string;
  score: number | null;
  predicate: string | null;
  kkm_met: boolean | null;
  incomplete: boolean;
  format_version: number | null;
};

export type TermNote = {
  student_id: string;
  nis: string;
  name: string;
  attitude: string | null;
  extracurricular: string | null;
  homeroom_note: string | null;
  absences: { sakit: number; izin: number; alpa: number };
};

export type ReportCard = {
  id: string;
  student_id: string;
  nis: string;
  name: string;
  format_version: number;
  generated_at: string;
};

/** Predikat sikap dan ekstrakurikuler. Hanya A sampai D. */
export type Predikat = "A" | "B" | "C" | "D";

export type AttitudeCell = { predicate: Predikat; description: string | null };

export type AttitudeRow = {
  student_id: string;
  nis: string;
  name: string;
  spiritual: AttitudeCell | null;
  sosial: AttitudeCell | null;
};

export type Activity = { id: string; name: string };

export type ExtraItem = { activity_id: string; activity: string; predicate: Predikat; description: string | null };

export type ExtraRow = { student_id: string; nis: string; name: string; items: ExtraItem[] };

export type MasteryItem = { subject: string; score: number | null; tuntas: boolean | null };

export type MasteryRow = {
  student_id: string;
  nis: string;
  name: string;
  subjects: MasteryItem[];
  tuntas: number;
  belum_tuntas: number;
};
