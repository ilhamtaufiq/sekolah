export type AcademicYear = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_active: boolean;
};

export type Subject = { id: string; code: string; name: string };

export type ClassRow = {
  id: string;
  academic_year_id: string;
  name: string;
  grade_level: number;
  homeroom_teacher_id: string | null;
  homeroom_teacher_name: string | null;
  student_count: number;
};

export type Student = {
  id: string;
  nis: string;
  nisn: string | null;
  name: string;
  gender: string | null;
  birth_date: string | null;
  status: string;
};

export type StaffUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
};

export type Assignment = {
  id: string;
  academic_year_id: string;
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  teacher_id: string;
  teacher_name: string;
};

export type ScheduleSlot = {
  id: string;
  assignment_id: string;
  class_id: string;
  class_name: string;
  subject_name: string;
  teacher_id: string;
  teacher_name: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room: string | null;
};

export type SessionSummary = {
  id: string;
  kind: "harian" | "mapel";
  session_date: string;
  class_id: string;
  class_name: string;
  assignment_id: string | null;
  subject_name: string | null;
  recorded_by_name: string;
  present: number;
  total: number;
};

export type SessionDetail = {
  id: string;
  kind: "harian" | "mapel";
  session_date: string;
  class_id: string;
  class_name: string;
  assignment_id: string | null;
  subject_name: string | null;
  recorded_by_name: string;
  records: { student_id: string; nis: string; name: string; status: string | null; note: string | null }[];
};

export type Summary = {
  active_year: string | null;
  active_students: number;
  classes: number;
  teachers: number;
  assignments: number;
  today: {
    date: string;
    classes_recorded: number;
    present: number;
    total: number;
    present_rate: number | null;
  };
};

export const DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  kepala_sekolah: "Kepala sekolah",
  guru: "Guru",
  wali_kelas: "Wali kelas",
};

export const ATTENDANCE_CODES = [
  { code: "H", label: "Hadir" },
  { code: "S", label: "Sakit" },
  { code: "I", label: "Izin" },
  { code: "A", label: "Alpa" },
] as const;

/** Format tanggal Indonesia untuk tampilan. Input "YYYY-MM-DD". */
export function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Isi bentuk ringkas (HH:MM) dari "HH:MM:SS". */
export function shortTime(value: string): string {
  return value.slice(0, 5);
}
