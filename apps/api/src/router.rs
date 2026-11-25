use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{delete, get, post, put},
};
use tower_http::trace::TraceLayer;

use crate::{academic, auth, health, lms, report_format, state::AppState};

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
        // LMS (F4)
        .route("/api/lms/rooms", get(lms::rooms))
        .route(
            "/api/lms/rooms/{id}/materials",
            get(lms::materials::list).post(lms::materials::create),
        )
        .route("/api/lms/materials/{id}", delete(lms::materials::delete))
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
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
