use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{delete, get, post, put},
};
use tower_http::trace::TraceLayer;

use crate::{academic, auth, exams, grades, health, kelulusan, lms, report_format, state::AppState};

pub fn build(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health::healthz))
        .route("/readyz", get(health::readyz))
        .route("/api/auth/login", post(auth::login))
        .route("/api/me", get(auth::me))
        .route(
            "/api/report-format",
            get(report_format::get_format).put(report_format::update_format),
        )
        .route("/api/report-format/history", get(report_format::history))
        .route(
            "/api/report-format/restore/{version}/{expected_version}",
            post(report_format::restore_version),
        )
        // Akademik (F2)
        .route(
            "/api/academic-years",
            get(academic::years::list).post(academic::years::create),
        )
        .route("/api/academic-years/{id}", put(academic::years::update))
        .route(
            "/api/academic-years/{id}/activate",
            post(academic::years::activate),
        )
        .route(
            "/api/subjects",
            get(academic::subjects::list).post(academic::subjects::create),
        )
        .route("/api/subjects/{id}", put(academic::subjects::update))
        .route(
            "/api/classes",
            get(academic::classes::list).post(academic::classes::create),
        )
        .route("/api/classes/{id}", put(academic::classes::update))
        .route(
            "/api/classes/{id}/students",
            get(academic::classes::list_students).post(academic::classes::add_students),
        )
        .route(
            "/api/classes/{id}/students/{student_id}",
            delete(academic::classes::remove_student),
        )
        .route(
            "/api/students",
            get(academic::students::list).post(academic::students::create),
        )
        .route("/api/students/{id}", put(academic::students::update))
        .route(
            "/api/students/{id}/account",
            post(academic::students::create_account),
        )
        .route(
            "/api/users",
            get(academic::users::list).post(academic::users::create),
        )
        .route("/api/users/{id}", put(academic::users::update))
        .route(
            "/api/assignments",
            get(academic::teaching::list_assignments).post(academic::teaching::create_assignment),
        )
        .route(
            "/api/assignments/{id}",
            delete(academic::teaching::delete_assignment),
        )
        .route(
            "/api/schedules",
            get(academic::teaching::list_schedules).post(academic::teaching::create_schedule),
        )
        .route(
            "/api/schedules/{id}",
            delete(academic::teaching::delete_schedule),
        )
        .route(
            "/api/attendance/sessions",
            get(academic::attendance::list_sessions).put(academic::attendance::save),
        )
        .route(
            "/api/attendance/sessions/{id}",
            get(academic::attendance::get_session),
        )
        .route("/api/dashboard/summary", get(academic::dashboard::summary))
        // Nilai dan raport (F3)
        .route(
            "/api/semesters",
            get(grades::semesters::list).post(grades::semesters::create),
        )
        .route(
            "/api/grade-components",
            get(grades::components::list).post(grades::components::create),
        )
        .route(
            "/api/grade-components/{id}",
            delete(grades::components::delete),
        )
        .route(
            "/api/grade-entries",
            get(grades::entries::list).put(grades::entries::save),
        )
        .route("/api/final-grades", get(grades::finals::list))
        .route(
            "/api/final-grades/compute",
            post(grades::finals::compute_handler),
        )
        .route(
            "/api/term-notes",
            get(grades::notes::list).put(grades::notes::save),
        )
        .route("/api/report-cards", get(grades::reports::list))
        .route("/api/me/report-cards", get(grades::reports::mine))
        .route(
            "/api/report-cards/generate",
            post(grades::reports::generate),
        )
        .route("/api/report-cards/{id}/pdf", get(grades::reports::download))
        // Rapor: sikap, ekstrakurikuler, dan ketuntasan tujuan (0012)
        .route(
            "/api/term-attitudes",
            get(grades::notes::list_attitudes).put(grades::notes::save_attitudes),
        )
        .route(
            "/api/term-extracurriculars",
            get(grades::notes::list_extracurriculars).put(grades::notes::save_extracurriculars),
        )
        .route(
            "/api/extracurricular-activities",
            get(grades::notes::list_activities).post(grades::notes::create_activity),
        )
        .route(
            "/api/extracurricular-activities/{id}",
            delete(grades::notes::delete_activity),
        )
        .route("/api/term-mastery", get(grades::finals::mastery))
        // LMS (F4)
        .route("/api/lms/rooms", get(lms::rooms))
        .route(
            "/api/lms/rooms/{id}/materials",
            get(lms::materials::list).post(lms::materials::create),
        )
        .route("/api/lms/materials/{id}", delete(lms::materials::delete))
        .route(
            "/api/lms/materials/{id}/progress",
            get(lms::video::mine).post(lms::video::beat),
        )
        .route(
            "/api/lms/rooms/{id}/progress",
            get(lms::video::room_summary),
        )
        .route(
            "/api/lms/rooms/{id}/lessons",
            get(lms::lessons::list).post(lms::lessons::create),
        )
        .route(
            "/api/lms/lessons/{id}",
            get(lms::lessons::detail).delete(lms::lessons::delete),
        )
        .route(
            "/api/lms/files/{id}/pdf-progress",
            get(lms::lessons::pdf_mine).post(lms::lessons::pdf_beat),
        )
        .route(
            "/api/lms/materials/{id}/files",
            post(lms::materials::upload)
                .layer(DefaultBodyLimit::max(lms::storage::MAX_REQUEST_BYTES)),
        )
        .route(
            "/api/lms/rooms/{id}/tasks",
            get(lms::tasks::list).post(lms::tasks::create),
        )
        .route("/api/lms/tasks/{id}", get(lms::tasks::detail))
        .route(
            "/api/lms/tasks/{id}/submission",
            put(lms::tasks::submit).layer(DefaultBodyLimit::max(lms::storage::MAX_REQUEST_BYTES)),
        )
        .route("/api/lms/submissions/{id}/grade", put(lms::tasks::grade))
        .route(
            "/api/lms/rooms/{id}/announcements",
            get(lms::announcements::list).post(lms::announcements::create),
        )
        .route("/api/lms/files/{id}", get(lms::download))
        // Forum per materi (lms_comments)
        .route(
            "/api/lms/materials/{id}/comments",
            get(lms::comments::list).post(lms::comments::create),
        )
        .route("/api/lms/comments/{id}", delete(lms::comments::delete))
        // Ujian CBT (F5)
        .route(
            "/api/questions",
            get(exams::questions::list).post(exams::questions::create),
        )
        .route(
            "/api/questions/{id}",
            put(exams::questions::update).delete(exams::questions::delete),
        )
        .route(
            "/api/exams",
            get(exams::manage::list).post(exams::manage::create),
        )
        .route(
            "/api/exams/{id}",
            get(exams::manage::get).put(exams::manage::update),
        )
        .route(
            "/api/exams/{id}/questions",
            put(exams::manage::set_questions),
        )
        .route("/api/exams/{id}/publish", post(exams::manage::publish))
        .route("/api/exams/{id}/preview", get(exams::manage::preview))
        .route("/api/exams/{id}/attempts", get(exams::manage::attempts))
        .route("/api/exams/{id}/analysis", get(exams::manage::analysis))
        .route(
            "/api/exams/{id}/attempts/{attempt_id}",
            get(exams::manage::attempt_answers),
        )
        .route(
            "/api/attempts/{id}/answers/{question_id}/score",
            put(exams::manage::grade_essay),
        )
        .route("/api/student/exams", get(exams::attempts::list))
        .route(
            "/api/student/exams/{id}/start",
            post(exams::attempts::start),
        )
        .route(
            "/api/student/attempts/{id}",
            get(exams::attempts::get_attempt),
        )
        .route(
            "/api/student/attempts/{id}/answers/{question_id}",
            put(exams::attempts::save_answer),
        )
        .route(
            "/api/student/attempts/{id}/events",
            post(exams::attempts::record_event),
        )
        .route(
            "/api/student/attempts/{id}/unlock",
            post(exams::attempts::unlock),
        )
        .route(
            "/api/student/attempts/{id}/submit",
            post(exams::attempts::submit),
        )
        // Jurnal mengajar (persetujuan kepala sekolah)
        .route(
            "/api/jurnal",
            get(crate::jurnal::crud::list).post(crate::jurnal::crud::create),
        )
        .route("/api/jurnal/rekap", get(crate::jurnal::rekap::range))
        .route(
            "/api/jurnal/rekap/assignments/{id}",
            get(crate::jurnal::rekap::assignment),
        )
        .route(
            "/api/jurnal/{id}",
            get(crate::jurnal::crud::get).put(crate::jurnal::crud::update),
        )
        .route("/api/jurnal/{id}/submit", post(crate::jurnal::crud::submit))
        .route("/api/jurnal/{id}/approve", post(crate::jurnal::review::approve))
        .route("/api/jurnal/{id}/reject", post(crate::jurnal::review::reject))
        // Jenjang dan jenis lembaga
        .route(
            "/api/school-profile",
            get(crate::school_profile::get).put(crate::school_profile::update),
        )
        // Kelulusan: kenaikan kelas dan sertifikat (F6)
        .route("/api/promotions", get(kelulusan::kenaikan::roster))
        .route("/api/promotions/process", post(kelulusan::kenaikan::process))
        .route("/api/certificates", get(kelulusan::sertifikat::list))
        .route("/api/me/certificates", get(kelulusan::sertifikat::mine))
        .route(
            "/api/certificates/{id}/pdf",
            get(kelulusan::sertifikat::download),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
