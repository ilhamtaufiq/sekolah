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
