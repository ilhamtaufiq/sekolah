//! Pengaturan format raport per sekolah.
//!
//! Aturan:
//! - Setiap perubahan membuat versi baru (monoton naik) dan mencatat riwayat.
//! - Klien wajib mengirim `expected_version`. Jika tidak cocok, respons 409,
//!   sehingga dua admin tidak saling menimpa diam-diam.
//! - Restore tidak menulis ulang sejarah: ia membuat versi baru dari isi versi lama.

pub mod model;

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlPool};
use uuid::Uuid;

use crate::{
    auth::{AuthUser, Role, require_role},
    error::{AppError, AppResult},
    state::AppState,
};
pub use model::ReportFormat;

const READ_ROLES: &[Role] = &[
    Role::Admin,
    Role::KepalaSekolah,
    Role::Guru,
    Role::WaliKelas,
];
const WRITE_ROLES: &[Role] = &[Role::Admin];
const HISTORY_LIMIT: i64 = 50;

#[derive(Serialize)]
pub struct FormatResponse {
    pub version: i32,
    pub config: ReportFormat,
    pub updated_at: Option<DateTime<Utc>>,
    pub updated_by: Option<String>,
}

#[derive(Serialize)]
pub struct HistoryItem {
    pub version: i32,
    pub action: String,
    pub changed_by: Option<String>,
    pub changed_at: DateTime<Utc>,
    pub config: ReportFormat,
}

#[derive(Deserialize)]
pub struct UpdateRequest {
    pub expected_version: i32,
    pub config: ReportFormat,
}

#[derive(FromRow)]
struct CurrentRow {
    version: i32,
    config: serde_json::Value,
    updated_at: DateTime<Utc>,
    updated_by: Option<String>,
}

#[derive(FromRow)]
struct HistoryRow {
    version: i32,
    action: String,
    changed_by: Option<String>,
    changed_at: DateTime<Utc>,
    config: serde_json::Value,
}

// ---------- Handler ----------

pub async fn get_format(
    State(st): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<FormatResponse>> {
    require_role(&user, READ_ROLES)?;
    Ok(Json(load_current(&st.pool, user.school_id).await?))
}

pub async fn update_format(
    State(st): State<AppState>,
    user: AuthUser,
    Json(req): Json<UpdateRequest>,
) -> AppResult<Json<FormatResponse>> {
    require_role(&user, WRITE_ROLES)?;

    let config = req.config.normalize();
    let issues = config.validate();
    if !issues.is_empty() {
        return Err(AppError::Validation(issues));
    }

    write_version(
        &st.pool,
        user.school_id,
        user.user_id,
        req.expected_version,
        &config,
        "update",
    )
    .await?;
    Ok(Json(load_current(&st.pool, user.school_id).await?))
}

pub async fn history(
    State(st): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Vec<HistoryItem>>> {
    require_role(&user, READ_ROLES)?;

    let rows: Vec<HistoryRow> = sqlx::query_as(
        "SELECT h.version, h.action, u.name AS changed_by, h.changed_at, h.config \
         FROM report_format_history h \
         LEFT JOIN users u ON u.id = h.changed_by \
         WHERE h.school_id = ? \
         ORDER BY h.version DESC \
         LIMIT ?",
    )
    .bind(user.school_id)
    .bind(HISTORY_LIMIT)
    .fetch_all(&st.pool)
    .await?;

    let items = rows
        .into_iter()
        .map(|r| {
            Ok(HistoryItem {
                version: r.version,
                action: r.action,
                changed_by: r.changed_by,
                changed_at: r.changed_at,
                config: from_json(r.config)?,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;

    Ok(Json(items))
}

/// Membuat versi baru dari isi versi lama. Versi lama tidak diubah.
pub async fn restore_version(
    State(st): State<AppState>,
    user: AuthUser,
    Path((version, expected_version)): Path<(i32, i32)>,
) -> AppResult<Json<FormatResponse>> {
    require_role(&user, WRITE_ROLES)?;

    let raw: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT config FROM report_format_history WHERE school_id = ? AND version = ?",
    )
    .bind(user.school_id)
    .bind(version)
    .fetch_optional(&st.pool)
    .await?;

    // Skema lama tetap divalidasi ulang, karena aturan bisa berubah antar rilis.
    let config = from_json(raw.ok_or(AppError::NotFound)?)?.normalize();
    let issues = config.validate();
    if !issues.is_empty() {
        return Err(AppError::Validation(issues));
    }

    write_version(
        &st.pool,
        user.school_id,
        user.user_id,
        expected_version,
        &config,
        "restore",
    )
    .await?;
    Ok(Json(load_current(&st.pool, user.school_id).await?))
}

// ---------- Repository ----------

async fn load_current(pool: &MySqlPool, school_id: Uuid) -> AppResult<FormatResponse> {
    let row: Option<CurrentRow> = sqlx::query_as(
        "SELECT r.version, r.config, r.updated_at, u.name AS updated_by \
         FROM report_format_settings r \
         LEFT JOIN users u ON u.id = r.updated_by \
         WHERE r.school_id = ?",
    )
    .bind(school_id)
    .fetch_optional(pool)
    .await?;

    Ok(match row {
        Some(r) => FormatResponse {
            version: r.version,
            config: from_json(r.config)?,
            updated_at: Some(r.updated_at),
            updated_by: r.updated_by,
        },
        // Sekolah yang belum pernah mengatur memakai default dengan versi 0.
        None => FormatResponse {
            version: 0,
            config: ReportFormat::default(),
            updated_at: None,
            updated_by: None,
        },
    })
}

/// Menulis versi baru secara atomik. Baris sekolah dikunci dulu supaya
/// dua penulisan bersamaan untuk sekolah yang sama berjalan berurutan.
async fn write_version(
    pool: &MySqlPool,
    school_id: Uuid,
    user_id: Uuid,
    expected: i32,
    config: &ReportFormat,
    action: &str,
) -> AppResult<i32> {
    let mut tx = pool.begin().await?;

    sqlx::query("SELECT id FROM schools WHERE id = ? FOR UPDATE")
        .bind(school_id)
        .fetch_one(&mut *tx)
        .await?;

    let current: Option<i32> =
        sqlx::query_scalar("SELECT version FROM report_format_settings WHERE school_id = ?")
            .bind(school_id)
            .fetch_optional(&mut *tx)
            .await?;
    let current = current.unwrap_or(0);

    if current != expected {
        return Err(AppError::Conflict(format!(
            "versi pengaturan sudah berubah (sekarang v{current}); muat ulang sebelum menyimpan"
        )));
    }

    let next = current + 1;
    let json = serde_json::to_value(config).map_err(|e| AppError::Internal(e.into()))?;

    // Alias baris (AS new) tersedia sejak MySQL 8.0.19 dan menggantikan VALUES() yang deprecated.
    sqlx::query(
        "INSERT INTO report_format_settings (school_id, version, config, updated_by, updated_at) \
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6)) AS new \
         ON DUPLICATE KEY UPDATE \
             version = new.version, config = new.config, \
             updated_by = new.updated_by, updated_at = UTC_TIMESTAMP(6)",
    )
    .bind(school_id)
    .bind(next)
    .bind(json.clone())
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO report_format_history (school_id, version, config, action, changed_by) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(school_id)
    .bind(next)
    .bind(json)
    .bind(action)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(next)
}

fn from_json(value: serde_json::Value) -> AppResult<ReportFormat> {
    serde_json::from_value(value)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("format tersimpan tidak valid: {e}")))
}
