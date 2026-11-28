//! Dashboard super admin platform: lintas sekolah (tenant).
//!
//! Akun platform disimpan di tabel `platform_admins`, terpisah dari `users`.
//! Token platform memakai `sch` = UUID nol dan role `superadmin`, dan endpoint sekolah menolaknya.

use axum::{Json, extract::State};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

pub mod manage;

use crate::{
    auth::{PlatformUser, Role, verify_password},
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(Deserialize)]
pub struct LoginInput {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct PlatformLoginResponse {
    pub token: String,
    pub user: PlatformMe,
}

#[derive(Serialize, FromRow)]
pub struct PlatformMe {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub role: String,
}

#[derive(FromRow)]
struct PlatformLoginRow {
    id: Uuid,
    name: String,
    email: String,
    password_hash: String,
    is_active: bool,
}

/// Login super admin. Pesan gagal dibuat seragam.
pub async fn login(
    State(st): State<AppState>,
    Json(req): Json<LoginInput>,
) -> AppResult<Json<PlatformLoginResponse>> {
    let row: Option<PlatformLoginRow> = sqlx::query_as(
        "SELECT id, name, email, password_hash, is_active FROM platform_admins WHERE lower(email) = lower(?)",
    )
    .bind(req.email.trim())
    .fetch_optional(&st.pool)
    .await?;

    let row = row.ok_or(AppError::Unauthorized)?;
    if !row.is_active || !verify_password(&req.password, &row.password_hash) {
        return Err(AppError::Unauthorized);
    }

    let token = st
        .keys
        .issue(row.id, Uuid::nil(), Role::SuperAdmin, st.jwt_ttl_hours)?;
    Ok(Json(PlatformLoginResponse {
        token,
        user: PlatformMe {
            id: row.id,
            name: row.name,
            email: row.email,
            role: Role::SuperAdmin.as_str().to_string(),
        },
    }))
}

/// Data akun yang sedang login.
pub async fn me(State(st): State<AppState>, user: PlatformUser) -> AppResult<Json<PlatformMe>> {
    let row: PlatformMe = sqlx::query_as(
        "SELECT id, name, email, 'superadmin' AS role FROM platform_admins WHERE id = ? AND is_active = TRUE",
    )
    .bind(user.user_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;
    Ok(Json(row))
}

/// Ringkasan satu sekolah untuk dashboard platform.
#[derive(Serialize, FromRow)]
pub struct SchoolSummary {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub admins: i64,
    pub teachers: i64,
    pub students: i64,
    pub classes: i64,
    pub pending_journals: i64,
    pub last_attendance: Option<NaiveDate>,
}

/// Daftar semua sekolah beserta angka utamanya.
pub async fn schools(
    State(st): State<AppState>,
    _user: PlatformUser,
) -> AppResult<Json<Vec<SchoolSummary>>> {
    let rows: Vec<SchoolSummary> = sqlx::query_as(
        "SELECT s.id, s.slug, s.name, s.created_at, \
           (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id AND u.role = 'admin' AND u.is_active = TRUE) AS admins, \
           (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id AND u.role IN ('guru', 'wali_kelas') AND u.is_active = TRUE) AS teachers, \
           (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.status = 'aktif') AS students, \
           (SELECT COUNT(*) FROM classes c JOIN academic_years y ON y.id = c.academic_year_id \
              WHERE c.school_id = s.id AND y.is_active = TRUE) AS classes, \
           (SELECT COUNT(*) FROM teaching_journals j WHERE j.school_id = s.id AND j.status = 'menunggu') AS pending_journals, \
           (SELECT MAX(a.session_date) FROM attendance_sessions a WHERE a.school_id = s.id) AS last_attendance \
         FROM schools s ORDER BY s.name",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}
