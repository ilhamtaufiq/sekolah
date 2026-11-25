use axum::{
    Router,
    routing::{get, post},
};
use tower_http::trace::TraceLayer;

use crate::{auth, health, report_format, state::AppState};

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
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
