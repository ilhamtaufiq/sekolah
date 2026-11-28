/*
 * Seed data demo untuk satu sekolah, dijalankan dari browser super admin.
 * Diport dari apps/api/scripts/seed_demo.py dan seed_demo_lengkap.py: urutan, angka,
 * dan isi data sama. Semua lewat API dengan token admin sekolah yang dipilih.
 */
import { api } from "../../lib/api";

export const DEMO_PASSWORD = "demo-pass-1";
const SUBJECTS: [string, string][] = [
  ["MTK", "Matematika"],
  ["BIN", "Bahasa Indonesia"],
  ["IPA", "Ilmu Pengetahuan Alam"],
  ["IPS", "Ilmu Pengetahuan Sosial"],
  ["PJOK", "Pendidikan Jasmani"],
];
const CLASSES: [string, number][] = [
  ["7A", 7],
  ["7B", 7],
  ["8A", 8],
  ["8B", 8],
];
const FIRST = ["Andi", "Budi", "Citra", "Dewi", "Eko", "Fitri", "Gilang", "Hana", "Indra", "Joko", "Kartika", "Lukman", "Maya", "Nadia", "Oka", "Putri", "Rizki", "Sari", "Tegar", "Umi", "Vino", "Wulan", "Yusuf", "Zahra"];
const LAST = ["Pratama", "Saputra", "Lestari", "Wijaya", "Hidayat", "Ramadhani", "Nugroho", "Setiawan", "Permata", "Utami"];
const TEACHER_NAMES = ["Ibu Ratna", "Pak Surya", "Ibu Dian", "Pak Hendra", "Ibu Melati"];
const PRED = ["A", "B", "B", "C"];
const ACTIVITIES = ["Pramuka", "Basket", "Tari"];
const NOTES: Record<string, string> = {
  A: "Sangat baik dalam kegiatan kelas.",
  B: "Baik, terus tingkatkan.",
  C: "Perlu lebih aktif dan disiplin.",
};

type Rec = { id: string; [k: string]: unknown };

/** Generator acak deterministik (mulberry32), supaya data yang sama bisa dibuat ulang. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick: <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)],
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    sample: <T,>(xs: T[], k: number): T[] => {
      const copy = [...xs];
      const out: T[] = [];
      while (out.length < k && copy.length) out.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
      return out;
    },
  };
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Hari sekolah (Senin–Jumat) ke belakang dari kemarin, dilewati `skip` hari pertama. */
function schoolDays(today: Date, count: number, skip: number): Date[] {
  const days: Date[] = [];
  const d = new Date(today);
  d.setDate(d.getDate() - 1);
  let seen = 0;
  while (days.length < count) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      seen += 1;
      if (seen > skip) days.push(new Date(d));
    }
    d.setDate(d.getDate() - 1);
  }
  return days;
}

export type SeedProgress = (label: string) => void;

/**
 * Mengisi sekolah kosong dengan data demo. Melempar error jika sekolah sudah punya kelas
 * di tahun ajaran aktif (sama seperti skrip Python).
 */
export async function seedSchoolDemo(token: string, slug: string, onProgress: SeedProgress): Promise<void> {
  const A = (path: string, opts: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; token?: string } = {}) =>
    api<any>(path, { token, ...opts }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const login = (email: string) => api<{ token: string }>("/auth/login", { method: "POST", body: { school_slug: slug, email, password: DEMO_PASSWORD } }).then((r) => r.token);
  const rnd = rng(42);
  const today = new Date();

  // 1. Tahun ajaran dan semester
  onProgress("Tahun ajaran dan semester");
  const years: Rec[] = await A("/academic-years");
  const classesNow: Rec[] = await A("/classes");
  if (years.some((y) => y.is_active) && classesNow.length > 0) {
    throw new Error("Sekolah ini sudah punya kelas di tahun ajaran aktif. Isi data demo hanya untuk sekolah kosong.");
  }
  const startYear = today.getMonth() + 1 >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  const name = `${startYear}/${startYear + 1}`;
  let year = years.find((y) => y.name === name);
  if (!year) {
    year = await A("/academic-years", { method: "POST", body: { name, starts_on: `${startYear}-07-01`, ends_on: `${startYear + 1}-06-30` } });
  }
  if (!year!.is_active) year = await A(`/academic-years/${year!.id}/activate`, { method: "POST" });
  const sem1 = await A("/semesters", { method: "POST", body: { ordinal: 1, starts_on: `${startYear}-07-01`, ends_on: `${startYear}-12-31` } });
  await A("/semesters", { method: "POST", body: { ordinal: 2, starts_on: `${startYear + 1}-01-01`, ends_on: `${startYear + 1}-06-30` } });

  // 2. Mapel dan guru
  onProgress("Mapel dan guru");
  const subj: Record<string, Rec> = {};
  for (const [code, nm] of SUBJECTS) subj[code] = await A("/subjects", { method: "POST", body: { code, name: nm } });
  const teachers: Rec[] = [];
  for (let i = 0; i < TEACHER_NAMES.length; i++) {
    teachers.push(await A("/users", { method: "POST", body: { name: TEACHER_NAMES[i], email: `guru${i + 1}@demo.sch.id`, password: DEMO_PASSWORD, role: "guru" } }));
  }
  const homerooms: Rec[] = [];
  for (let i = 0; i < CLASSES.length; i++) {
    homerooms.push(await A("/users", { method: "POST", body: { name: `Wali kelas ${CLASSES[i][0]}`, email: `wali${i + 1}@demo.sch.id`, password: DEMO_PASSWORD, role: "wali_kelas" } }));
  }

  // 3. Kelas dan siswa
  onProgress("Kelas dan siswa");
  const classes: Rec[] = [];
  for (let i = 0; i < CLASSES.length; i++) {
    classes.push(await A("/classes", { method: "POST", body: { name: CLASSES[i][0], grade_level: CLASSES[i][1], homeroom_teacher_id: homerooms[i].id } }));
  }
  const studentsByClass: Rec[][] = [];
  let nis = 260001;
  for (const c of classes) {
    const roster: Rec[] = [];
    for (let k = 0; k < 20; k++) {
      const s = await A("/students", { method: "POST", body: { nis: String(nis), name: `${rnd.pick(FIRST)} ${rnd.pick(LAST)}`, gender: rnd.pick(["L", "P"]), status: "aktif" } });
      await A(`/students/${s.id}/account`, { method: "POST", body: { email: `siswa${nis}@demo.sch.id`, password: DEMO_PASSWORD } });
      roster.push(s);
      nis += 1;
    }
    await A(`/classes/${c.id}/students`, { method: "POST", body: { student_ids: roster.map((s) => s.id) } });
    studentsByClass.push(roster);
  }

  // 4. Penugasan dan jadwal
  onProgress("Penugasan dan jadwal");
  const assignments = new Map<string, Rec>();
  for (let ci = 0; ci < classes.length; ci++) {
    for (let si = 0; si < SUBJECTS.length; si++) {
      const [code] = SUBJECTS[si];
      const asg = await A("/assignments", { method: "POST", body: { class_id: classes[ci].id, subject_id: subj[code].id, teacher_id: teachers[si].id } });
      assignments.set(`${ci}-${si}`, asg);
      const hour = 7 + ci;
      await A("/schedules", { method: "POST", body: { assignment_id: asg.id, day_of_week: si + 1, start_time: `${String(hour).padStart(2, "0")}:00:00`, end_time: `${String(hour).padStart(2, "0")}:45:00`, room: `R-${classes[ci].name}` } });
    }
  }

  // 5. Nilai semester 1
  onProgress("Nilai dan nilai akhir");
  for (const [key, asg] of assignments) {
    const ci = Number(key.split("-")[0]);
    const roster = studentsByClass[ci];
    for (const [nm, weight] of [["Tugas", 30], ["UH", 30], ["PTS", 40]] as const) {
      const comp = await A("/grade-components", { method: "POST", body: { assignment_id: asg.id, semester_id: sem1.id, name: nm, weight } });
      await A("/grade-entries", { method: "PUT", body: { component_id: comp.id, entries: roster.map((s) => ({ student_id: s.id, score: rnd.int(55, 100) })) } });
    }
    await A("/final-grades/compute", { method: "POST", body: { assignment_id: asg.id, semester_id: sem1.id } });
  }

  // 6. Absensi 5 hari terakhir
  onProgress("Absensi");
  const recentDays = schoolDays(today, 5, 0);
  const wali = await Promise.all(classes.map((_, ci) => login(`wali${ci + 1}@demo.sch.id`)));
  for (const day of recentDays) {
    for (let ci = 0; ci < classes.length; ci++) {
      await A("/attendance/sessions", { method: "PUT", token: wali[ci], body: { kind: "harian", class_id: classes[ci].id, assignment_id: null, session_date: isoDate(day), records: attendanceRecords(studentsByClass[ci], rnd) } });
    }
  }

  // 7. LMS: pengumuman, materi, tugas
  onProgress("Ruang kelas (pengumuman, materi, tugas)");
  const teacherTok = await Promise.all(TEACHER_NAMES.map((_, i) => login(`guru${i + 1}@demo.sch.id`)));
  for (const [key, asg] of assignments) {
    const si = Number(key.split("-")[1]);
    const tok = teacherTok[si];
    await A(`/lms/rooms/${asg.id}/announcements`, { method: "POST", token: tok, body: { title: "Selamat datang", body: `Selamat datang di pelajaran ${SUBJECTS[si][1]} semester ini.` } });
    await A(`/lms/rooms/${asg.id}/materials`, { method: "POST", token: tok, body: { title: "Panduan belajar", body: "Baca bab 1 dan kerjakan latihan di buku." } });
    if (si === 0) {
      const due = new Date(Date.now() + 7 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
      await A(`/lms/rooms/${asg.id}/tasks`, { method: "POST", token: tok, body: { title: "Latihan bab 1", instructions: "Kerjakan soal 1 sampai 10.", due_at: due, max_score: 100, allow_late: true } });
    }
  }

  // 8. Absensi tambahan 10 hari
  onProgress("Absensi tambahan");
  for (const day of schoolDays(today, 10, 5)) {
    for (let ci = 0; ci < classes.length; ci++) {
      await A("/attendance/sessions", { method: "PUT", token: wali[ci], body: { kind: "harian", class_id: classes[ci].id, assignment_id: null, session_date: isoDate(day), records: attendanceRecords(studentsByClass[ci], rnd) } });
    }
  }

  // 9. Sikap dan ekstrakurikuler
  onProgress("Sikap dan ekstrakurikuler");
  const activityIds: string[] = [];
  for (const nm of ACTIVITIES) activityIds.push((await A("/extracurricular-activities", { method: "POST", body: { name: nm } })).id);
  for (let ci = 0; ci < classes.length; ci++) {
    const items: unknown[] = [];
    for (const s of studentsByClass[ci]) {
      for (const aspect of ["spiritual", "sosial"]) {
        const p = rnd.pick(PRED);
        items.push({ student_id: s.id, aspect, predicate: p, description: NOTES[p] });
      }
    }
    await A("/term-attitudes", { method: "PUT", token: wali[ci], body: { class_id: classes[ci].id, semester_id: sem1.id, items } });
    const students = studentsByClass[ci].map((s) => ({
      student_id: s.id,
      items: rnd.sample(activityIds, rnd.int(1, 2)).map((aid) => {
        const p = rnd.pick(PRED);
        return { activity_id: aid, predicate: p, description: NOTES[p] };
      }),
    }));
    await A("/term-extracurriculars", { method: "PUT", token: wali[ci], body: { class_id: classes[ci].id, semester_id: sem1.id, students } });
  }

  // 10. Jurnal mengajar
  onProgress("Jurnal mengajar");
  const jDays = schoolDays(today, 4, 0); // hari terbaru dulu, sama seperti skrip Python
  const adminTok = token;
  for (const [key, asg] of assignments) {
    const [ci, si] = key.split("-").map(Number);
    const tok = teacherTok[si];
    for (let n = 0; n < jDays.length; n++) {
      const body = { assignment_id: asg.id, journal_date: isoDate(jDays[n]), hour_no: 1, topic: `Materi ${SUBJECTS[si][1]} pertemuan ${n + 1}`, notes: "Kelas berjalan lancar.", present_count: 18 };
      const j = await A("/jurnal", { method: "POST", token: tok, body });
      if (n === 0 && si === 0 && ci === 0) {
        await A(`/jurnal/${j.id}/submit`, { method: "POST", token: tok });
        await A(`/jurnal/${j.id}/reject`, { method: "POST", token: adminTok, body: { note: "Materi belum lengkap, tambahkan rincian." } });
        await A(`/jurnal/${j.id}`, { method: "PUT", token: tok, body: { ...body, topic: `${body.topic} (diperbaiki)` } });
        await A(`/jurnal/${j.id}/submit`, { method: "POST", token: tok });
        await A(`/jurnal/${j.id}/approve`, { method: "POST", token: adminTok, body: { note: null } });
      } else if (n === jDays.length - 1 && (ci + si) % 3 === 0) {
        await A(`/jurnal/${j.id}/submit`, { method: "POST", token: tok });
      } else {
        await A(`/jurnal/${j.id}/submit`, { method: "POST", token: tok });
        await A(`/jurnal/${j.id}/approve`, { method: "POST", token: adminTok, body: { note: null } });
      }
    }
  }

  // 11. Forum materi
  onProgress("Forum diskusi");
  for (const [key, asg] of assignments) {
    const [ci, si] = key.split("-").map(Number);
    if (ci >= 2 || si >= 2) continue;
    const mats: Rec[] = await A(`/lms/rooms/${asg.id}/materials`, { token: teacherTok[si] });
    if (!mats.length) continue;
    const stok = await login(`siswa${studentsByClass[ci][0].nis}@demo.sch.id`);
    const top = await A(`/lms/materials/${mats[0].id}/comments`, { method: "POST", token: stok, body: { body: "Bu, bagian latihan nomor 5 maksudnya bagaimana?" } });
    await A(`/lms/materials/${mats[0].id}/comments`, { method: "POST", token: teacherTok[si], body: { body: "Coba kerjakan dengan cara yang sama seperti contoh di awal bab.", parent_id: top.id } });
  }

  // 12. Ujian PG untuk MTK kelas 7A
  onProgress("Ujian");
  const soal: [string, string[], string][] = [
    ["Berapakah 7 + 5?", ["10", "11", "12", "13"], "C"],
    ["Berapakah 9 × 3?", ["24", "27", "30", "33"], "B"],
    ["Berapakah 18 ÷ 2?", ["6", "8", "9", "12"], "C"],
    ["Berapakah 1/2 + 1/4?", ["1/6", "2/6", "3/4", "1/8"], "C"],
    ["Berapakah 0,5 × 10?", ["5", "0,5", "50", "15"], "A"],
  ];
  const qids: string[] = [];
  for (const [body, opts, key] of soal) {
    const q = await A("/questions", { method: "POST", token: teacherTok[0], body: { subject_id: subj.MTK.id, kind: "pg", body, options: opts.map((t, i) => ({ key: "ABCD"[i], text: t })), answer_key: key, points: 20 } });
    qids.push(q.id);
  }
  const now = Date.now();
  const exam = await A("/exams", {
    method: "POST",
    token: teacherTok[0],
    body: {
      assignment_id: assignments.get("0-0")!.id,
      title: "Latihan Bab 1 — Operasi Hitung",
      duration_minutes: 30,
      window_start: new Date(now - DAY).toISOString().replace(/\.\d{3}Z$/, "Z"),
      window_end: new Date(now + 7 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z"),
      shuffle_questions: true,
      shuffle_options: true,
      token: null,
      clear_token: false,
      generate_token: false,
    },
  });
  await A(`/exams/${exam.id}/questions`, { method: "PUT", token: teacherTok[0], body: { question_ids: qids } });
  await A(`/exams/${exam.id}/publish`, { method: "POST", token: teacherTok[0] });

  // 13. Kelulusan 10 siswa kelas 8B
  onProgress("Kelulusan dan sertifikat");
  const roster: Rec[] = await A(`/promotions?academic_year_id=${year!.id}`);
  const pick = roster.filter((r) => r.class_name === "8B" && r.decision == null).slice(0, 10);
  if (pick.length) {
    await A("/promotions/process", { method: "POST", body: { academic_year_id: year!.id, certificate_code: null, items: pick.map((r) => ({ student_id: r.student_id, decision: "lulus", to_class_id: null })) } });
  }

  // 14. Cetak rapor massal kelas 7A
  onProgress("Cetak rapor massal");
  const job = await A("/cetak-massal/jobs", { method: "POST", body: { class_id: classes[0].id, semester_id: sem1.id } });
  for (let i = 0; i < 60; i++) {
    const st = await A(`/cetak-massal/jobs/${job.id}`);
    if (st.status === "selesai" || st.status === "gagal") break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  onProgress("Selesai");
}

const DAY = 24 * 60 * 60 * 1000;

function attendanceRecords(roster: Rec[], rnd: ReturnType<typeof rng>) {
  return roster.map((s) => {
    const roll = rnd.next();
    const status = roll < 0.9 ? "H" : roll < 0.95 ? "S" : roll < 0.98 ? "I" : "A";
    return { student_id: s.id, status };
  });
}
