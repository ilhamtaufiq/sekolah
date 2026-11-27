import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./features/auth/LoginPage";
import { FormatSettingsPage } from "./features/report-format/FormatSettingsPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { YearsPage } from "./features/academic/YearsPage";
import { SubjectsPage } from "./features/academic/SubjectsPage";
import { ClassesPage, ClassDetailPage } from "./features/academic/ClassesPage";
import { StudentsPage } from "./features/academic/StudentsPage";
import { StaffPage } from "./features/academic/StaffPage";
import { SchedulePage } from "./features/academic/SchedulePage";
import { AttendancePage } from "./features/academic/AttendancePage";
import { GradesPage } from "./features/grades/GradesPage";
import { ReportsPage } from "./features/grades/ReportsPage";
import { RoomsPage, RoomPage } from "./features/lms/RoomsPage";
import { TaskPage } from "./features/lms/TaskPage";
import { SchoolProfilePage } from "./features/school/SchoolProfilePage";

/** Siswa tidak punya beranda admin; langsung ke ruang kelas. */
function HomeRoute() {
  const { user } = useAuth();
  if (user?.role === "siswa") return <Navigate to="/ruang-kelas" replace />;
  return <DashboardPage />;
}
import { BankPage } from "./features/exams/BankPage";
import { ExamsPage } from "./features/exams/ExamsPage";
import { ExamDetailPage } from "./features/exams/ExamDetailPage";
import { StudentExamsPage } from "./features/exams/StudentExamsPage";
import { TakeExamPage } from "./features/exams/TakeExamPage";
import { PreviewExamPage } from "./features/exams/PreviewExamPage";
import { MyReportsPage } from "./features/grades/MyReportsPage";
import { LessonPage } from "./features/lms/LessonPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<HomeRoute />} />
          <Route path="tahun-ajaran" element={<YearsPage />} />
          <Route path="mapel" element={<SubjectsPage />} />
          <Route path="kelas" element={<ClassesPage />} />
          <Route path="kelas/:id" element={<ClassDetailPage />} />
          <Route path="siswa" element={<StudentsPage />} />
          <Route path="staf" element={<StaffPage />} />
          <Route path="jadwal" element={<SchedulePage />} />
          <Route path="absensi" element={<AttendancePage />} />
          <Route path="nilai" element={<GradesPage />} />
          <Route path="raport" element={<ReportsPage />} />
          <Route path="pengaturan/format-raport" element={<FormatSettingsPage />} />
          <Route path="pengaturan/profil" element={<SchoolProfilePage />} />
          <Route path="ruang-kelas" element={<RoomsPage />} />
          <Route path="ruang-kelas/:id" element={<RoomPage />} />
          <Route path="tugas/:id" element={<TaskPage />} />
          <Route path="bank-soal" element={<BankPage />} />
          <Route path="ujian" element={<ExamsPage />} />
          <Route path="ujian/:id" element={<ExamDetailPage />} />
          <Route path="ujian/:id/tes" element={<PreviewExamPage />} />
          <Route path="raport-saya" element={<MyReportsPage />} />
          <Route path="pembelajaran/:id" element={<LessonPage />} />
          <Route path="ujian-saya" element={<StudentExamsPage />} />
          <Route path="kerjakan/:attemptId" element={<TakeExamPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
