//! Ujian CBT (F5): bank soal, paket ujian, percobaan siswa, penilaian, dan analisis butir.
//!
//! Batasan keamanan yang disadari: browser tidak bisa dikunci. Log kejadian hanya jejak,
//! bukan pencegahan. Waktu dan penilaian dijalankan di server.

pub mod attempts;
pub mod manage;
pub mod questions;
pub mod rules;

use sqlx::MySqlPool;
use uuid::Uuid;

use crate::{
    auth::{AuthUser, Role},
    error::{AppError, AppResult},
};

pub const TEACH_ROLES: &[Role] = &[Role::Admin, Role::Guru, Role::WaliKelas];

/// Admin, atau guru yang mengajar mapel ini di sekolahnya.
pub async fn can_manage_subject(
    pool: &MySqlPool,
    user: &AuthUser,
    subject_id: Uuid,
) -> AppResult<bool> {
    if user.role == Role::Admin {
        return Ok(true);
    }
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM teaching_assignments WHERE school_id = ? AND teacher_id = ? AND subject_id = ? LIMIT 1",
    )
    .bind(user.school_id)
    .bind(user.user_id)
    .bind(subject_id)
    .fetch_optional(pool)
    .await?;
    Ok(found.is_some())
}

/// Id siswa dari akun yang login. Akun non-siswa ditolak.
pub async fn student_id_for(pool: &MySqlPool, user: &AuthUser) -> AppResult<Uuid> {
    sqlx::query_scalar("SELECT id FROM students WHERE user_id = ? AND school_id = ?")
        .bind(user.user_id)
        .bind(user.school_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::Forbidden)
}
