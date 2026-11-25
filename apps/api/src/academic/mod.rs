//! Modul akademik (F2): tahun ajaran, mapel, kelas, siswa, guru, penugasan, jadwal, absensi.
//!
//! Aturan umum:
//! - Setiap query memfilter `school_id` dari token, tidak pernah dari input klien.
//! - Data master ditulis admin. Absensi bisa dicatat wali kelas dan guru mapel
//!   yang bersangkutan, atau admin.

pub mod attendance;
pub mod classes;
pub mod dashboard;
pub mod students;
pub mod subjects;
pub mod teaching;
pub mod users;
pub mod years;

use sqlx::MySqlPool;
use uuid::Uuid;

use crate::{
    auth::Role,
    error::{AppError, AppResult, FieldIssue},
};

pub const READ_ROLES: &[Role] = &[
    Role::Admin,
    Role::KepalaSekolah,
    Role::Guru,
    Role::WaliKelas,
];
pub const MASTER_WRITE: &[Role] = &[Role::Admin];
pub const ATTENDANCE_WRITE: &[Role] = &[Role::Admin, Role::Guru, Role::WaliKelas];

/// Id tahun ajaran yang aktif di sekolah, jika ada.
pub async fn active_year_id(pool: &MySqlPool, school_id: Uuid) -> AppResult<Option<Uuid>> {
    Ok(
        sqlx::query_scalar(
            "SELECT id FROM academic_years WHERE school_id = ? AND is_active = TRUE",
        )
        .bind(school_id)
        .fetch_optional(pool)
        .await?,
    )
}

/// Memastikan sebuah id ada di sekolah ini. `query` harus berbentuk
/// `SELECT 1 FROM <tabel> WHERE id = ? AND school_id = ?`.
pub async fn exists(
    pool: &MySqlPool,
    query: &'static str,
    school_id: Uuid,
    id: Uuid,
) -> AppResult<bool> {
    let found: Option<i64> = sqlx::query_scalar(query)
        .bind(id)
        .bind(school_id)
        .fetch_optional(pool)
        .await?;
    Ok(found.is_some())
}

/// Memastikan referensi ke id tertentu valid, atau mengembalikan error validasi pada `field`.
pub async fn require_exists(
    pool: &MySqlPool,
    query: &'static str,
    school_id: Uuid,
    id: Uuid,
    field: &str,
    message: &str,
) -> AppResult<()> {
    if exists(pool, query, school_id, id).await? {
        Ok(())
    } else {
        Err(AppError::Validation(vec![FieldIssue::new(field, message)]))
    }
}

/// Memastikan user adalah guru aktif (guru atau wali kelas) di sekolah ini.
pub async fn require_teacher(
    pool: &MySqlPool,
    school_id: Uuid,
    id: Uuid,
    field: &str,
) -> AppResult<()> {
    require_exists(
        pool,
        "SELECT 1 FROM users WHERE id = ? AND school_id = ? AND role IN ('guru', 'wali_kelas') AND is_active = TRUE",
        school_id,
        id,
        field,
        "guru tidak ditemukan atau tidak aktif",
    )
    .await
}
