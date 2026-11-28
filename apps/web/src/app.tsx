import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./features/auth/LoginPage";
import { FormatSettingsPage } from "./features/report-format/FormatSettingsPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { StudentDashboard } from "./features/dashboard/StudentDashboard";
import { TeacherDashboard } from "./features/dashboard/TeacherDashboard";
import { YearsPage } from "./features/academic/YearsPage";
import { SubjectsPage } from "./features/academic/SubjectsPage";
import { ClassesPage, ClassDetailPage } from "./features/academic/ClassesPage";
import { StudentsPage } from "./features/academic/StudentsPage";
import { StaffPage } from "./features/academic/StaffPage";
import { SchedulePage } from "./features/academic/SchedulePage";
import { AttendancePage } from "./features/academic/AttendancePage";
import { GradesPage } from "./features/grades/GradesPage";
import { ReportsPage } from "./features/grades/ReportsPage";
import { CetakMassalPage } from "./features/grades/CetakMassalPage";
import { RoomsPage, RoomPage } from "./features/lms/RoomsPage";
import { TaskPage } from "./features/lms/TaskPage";
// Jurnal mengajar
import { JurnalPage } from "./features/jurnal/JurnalPage";
import { JournalFormPage } from "./features/jurnal/JournalFormPage";
import { PersetujuanJurnalPage } from "./features/jurnal/PersetujuanJurnalPage";
import { SchoolProfilePage } from "./features/school/SchoolProfilePage";

/** Siswa tidak punya beranda admin; langsung ke ruang kelas. */
function HomeRoute() {
  const { user } = useAuth();
  if (user?.role === "siswa") return <StudentDashboard />;
  if (user?.role === "guru" || user?.role === "wali_kelas") return <TeacherDashboard />;
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
import { KenaikanPage } from "./features/kelulusan/KenaikanPage";
import { SertifikatSayaPage } from "./features/kelulusan/SertifikatSayaPage";
import { PlatformLoginPage } from "./features/platform/PlatformLoginPage";
import { PlatformPage } from "./features/platform/PlatformPage";
import { PlatformSchoolPage } from "./features/platform/PlatformSchoolPage";
import { PlatformAuditPage } from "./features/platform/PlatformAuditPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // Super admin hanya punya dashboard platform, tidak punya halaman sekolah.
  if (user.role === "superadmin") return <Navigate to="/platform" replace />;
  return <>{children}</>;
}

function RequirePlatform({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "superadmin") return <Navigate to="/platform/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/platform/login" element={<PlatformLoginPage />} />
        <Route
          path="/platform"
          element={
            <RequirePlatform>
              <PlatformPage />
            </RequirePlatform>
          }
        />
        <Route
          path="/platform/sekolah/:id"
          element={
            <RequirePlatform>
              <PlatformSchoolPage />
            </RequirePlatform>
          }
        />
        <Route
          path="/platform/audit"
          element={
            <RequirePlatform>
              <PlatformAuditPage />
            </RequirePlatform>
          }
        />
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
          <Route path="cetak-massal" element={<CetakMassalPage />} />
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
          {/* Jurnal mengajar */}
          <Route path="jurnal" element={<JurnalPage />} />
          <Route path="jurnal/:id" element={<JournalFormPage />} />
          <Route path="persetujuan-jurnal" element={<PersetujuanJurnalPage />} />
          <Route path="kenaikan" element={<KenaikanPage />} />
          <Route path="sertifikat-saya" element={<SertifikatSayaPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
