/*
 * Data contoh (dummy) untuk dashboard per peran dan perbandingan periode.
 * Belum ada snapshot per semester di backend, jadi nilai "periode lalu" dan
 * sebagian data guru/siswa diambil dari sini. Ganti dengan endpoint asli
 * ketika tersedia; komponen tidak perlu berubah strukturnya.
 */

/** Nilai semester lalu, untuk selisih di ringkasan sekolah. */
export const previousSemester = {
  active_students: 76,
  classes: 4,
  teachers: 8,
  attendance_rate: 89.1,
};

/** Persentase hadir minggu lalu, untuk selisih tren kehadiran. */
export const previousWeekAttendance = 88.4;

export const teacherDummy = {
  schedule: [
    { time: "07:00–07:45", className: "7A", subject: "Matematika", room: "R-7A", state: "selesai" as const },
    { time: "07:45–08:30", className: "7B", subject: "Matematika", room: "R-7B", state: "berlangsung" as const },
    { time: "09:15–10:00", className: "8A", subject: "Matematika", room: "R-8A", state: "akan datang" as const },
  ],
  journalsMissing: [
    { date: "25 Nov", className: "7A", subject: "Matematika", hour: 1 },
    { date: "26 Nov", className: "7B", subject: "Matematika", hour: 2 },
  ],
  toGrade: [
    { task: "Latihan bab 1", className: "7A", submitted: 18, total: 20, due: "24 Nov" },
    { task: "Kuis pecahan", className: "8A", submitted: 9, total: 20, due: "27 Nov" },
  ],
  classAverage: [
    { className: "7A", average: 81 },
    { className: "7B", average: 76 },
    { className: "8A", average: 84 },
    { className: "8B", average: 73 },
  ],
  attendanceMyClasses: { present: 92, total: 100 },
};

export const studentDummy = {
  upcomingTasks: [
    { title: "Latihan bab 1", subject: "Matematika", due: "2 Des", daysLeft: 5 },
    { title: "Ringkasan bacaan", subject: "Bahasa Indonesia", due: "4 Des", daysLeft: 7 },
  ],
  recentGrades: [
    { subject: "Matematika", score: 86, predicate: "B", delta: 3 },
    { subject: "IPA", score: 91, predicate: "A", delta: 5 },
    { subject: "Bahasa Indonesia", score: 74, predicate: "C", delta: -2 },
  ],
  learningProgress: [
    { title: "Bab 1 · Pecahan", percent: 100 },
    { title: "Bab 2 · Desimal", percent: 70 },
    { title: "Video: Operasi bilangan", percent: 40 },
  ],
  nextExam: { title: "PTS Semester 1", date: "4 Des", time: "08:00" },
  attendanceMonth: { present: 18, sick: 1, permit: 1, absent: 0 },
};
