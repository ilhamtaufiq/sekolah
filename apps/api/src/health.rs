use axum::extract::State;

use crate::{error::AppResult, state::AppState};

/// Liveness: proses hidup. Tidak menyentuh database.
pub async fn healthz() -> &'static str {
    "ok"
}

/// Readiness: database bisa dijangkau. Dipakai Coolify sebelum mengalihkan trafik.
pub async fn readyz(State(st): State<AppState>) -> AppResult<&'static str> {
    sqlx::query("SELECT 1").execute(&st.pool).await?;
    Ok("ready")
}
