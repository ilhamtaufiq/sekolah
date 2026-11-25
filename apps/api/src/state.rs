use std::sync::Arc;

use sqlx::PgPool;

use crate::auth::JwtKeys;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub keys: Arc<JwtKeys>,
    pub jwt_ttl_hours: i64,
}
