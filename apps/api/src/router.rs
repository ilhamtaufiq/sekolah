use axum::{
    Router,
    routing::{delete, get, post, put},
};
use tower_http::trace::TraceLayer;

use crate::{academic, auth, grades, health, report_format, state::AppState};

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
        .route(
            "/api/report-cards/generate",
            post(grades::reports::generate),
        )
        .route("/api/report-cards/{id}/pdf", get(grades::reports::download))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
