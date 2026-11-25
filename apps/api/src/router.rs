use axum::{
    Router,
    routing::{delete, get, post, put},
};
use tower_http::trace::TraceLayer;

use crate::{academic, auth, exams, health, report_format, state::AppState};

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
        .route("/api/exams/{id}/attempts", get(exams::manage::attempts))
        .route("/api/exams/{id}/analysis", get(exams::manage::analysis))
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
            "/api/student/attempts/{id}/submit",
            post(exams::attempts::submit),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
