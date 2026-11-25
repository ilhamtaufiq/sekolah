use std::sync::Arc;

use sqlx::MySqlPool;

use crate::auth::JwtKeys;

#[derive(Clone)]
pub struct AppState {
    pub pool: MySqlPool,
    pub keys: Arc<JwtKeys>,
    pub jwt_ttl_hours: i64,
    pub upload_dir: std::path::PathBuf,
}
