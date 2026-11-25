export type QuestionOption = { key: string; text: string };

export type Question = {
  id: string;
  subject_id: string;
  subject_name: string;
  kind: "pg" | "esai";
  body: string;
  options: QuestionOption[] | null;
  answer_key: string | null;
  points: number;
};

export type ExamRow = {
  id: string;
  assignment_id: string;
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  title: string;
  duration_minutes: number;
  window_start: string;
  window_end: string;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  token_state: "none" | "set" | "reset";
  status: "draft" | "published";
  question_count: number;
  total_points: number;
};

export type ExamQuestion = {
  question_id: string;
  position: number;
  kind: "pg" | "esai";
  body: string;
  points: number;
  options: QuestionOption[] | null;
  answer_key: string | null;
};

export type ExamDetail = ExamRow & { questions: ExamQuestion[] };

export type AttemptRow = {
  attempt_id: string;
  student_id: string;
  student_name: string;
  nis: string;
  status: "in_progress" | "submitted" | "expired";
  started_at: string;
  deadline: string;
  submitted_at: string | null;
  score: number | null;
  graded: boolean;
  events: number;
  pending_essays: number;
};

export type AttemptAnswer = {
  question_id: string;
  position: number;
  kind: "pg" | "esai";
  body: string;
  points: number;
  answer: string | null;
  score: number | null;
};

export type ItemStat = {
  question_id: string;
  position: number;
  kind: "pg" | "esai";
  attempts: number;
  difficulty: number | null;
  discrimination: number | null;
};

export type Analysis = { attempts: number; provisional: boolean; items: ItemStat[] };

export type StudentExam = {
  exam_id: string;
  title: string;
  subject_name: string;
  class_name: string;
  duration_minutes: number;
  window_start: string;
  window_end: string;
  token_required: boolean;
  question_count: number;
  attempt_id: string | null;
  attempt_status: string | null;
};

export type TakeQuestion = {
  question_id: string;
  position: number;
  kind: "pg" | "esai";
  body: string;
  points: number;
  options: QuestionOption[] | null;
  answer: string | null;
};

export type AttemptView = {
  attempt_id: string;
  exam_id: string;
  title: string;
  duration_minutes: number;
  status: "in_progress" | "submitted" | "expired";
  started_at: string;
  deadline: string;
  submitted_at: string | null;
  score: number | null;
  server_now: string;
  locked: boolean;
  questions: TakeQuestion[];
};

/** ISO UTC dari nilai input datetime-local (zona waktu perangkat). */
export function toIso(local: string): string {
  return new Date(local).toISOString();
}

/** Nilai untuk input datetime-local dari ISO. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}
