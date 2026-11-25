//! Nilai dan raport (F3).
//!
//! - Komponen nilai per penugasan dan semester (tugas, UH, PTS, PAS, bobot masing-masing).
//! - Nilai akhir mapel = rata-rata berbobot komponen, lalu predikat dan KKM dari format raport aktif.
//! - Catatan sikap, ekstrakurikuler, dan wali kelas per siswa per semester.
//! - Raport PDF dirender dengan Typst memakai pengaturan format raport yang aktif.

pub mod calc;
pub mod components;
pub mod entries;
pub mod finals;
pub mod notes;
pub mod render;
pub mod reports;
pub mod semesters;

use sqlx::MySqlPool;
use uuid::Uuid;

use crate::{
    auth::{AuthUser, Role},
    error::{AppError, AppResult},
    report_format::{self, model::ReportFormat},
};

pub const READ_ROLES: &[Role] = &[
    Role::Admin,
    Role::KepalaSekolah,
    Role::Guru,
    Role::WaliKelas,
];

/// Penugasan yang dibutuhkan untuk pemeriksaan hak akses.
pub struct AssignmentCtx {
    pub class_id: Uuid,
    pub teacher_id: Uuid,
    pub academic_year_id: Uuid,
}

pub async fn load_assignment(
    pool: &MySqlPool,
    school_id: Uuid,
    id: Uuid,
) -> AppResult<AssignmentCtx> {
    let (class_id, teacher_id, academic_year_id): (Uuid, Uuid, Uuid) = sqlx::query_as(
        "SELECT class_id, teacher_id, academic_year_id FROM teaching_assignments WHERE id = ? AND school_id = ?",
    )
    .bind(id)
    .bind(school_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(AssignmentCtx {
        class_id,
        teacher_id,
        academic_year_id,
    })
}

/// Admin, atau guru pengampu penugasan ini. Selainnya ditolak.
pub fn ensure_manage(user: &AuthUser, a: &AssignmentCtx) -> AppResult<()> {
    if user.role == Role::Admin || user.user_id == a.teacher_id {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Admin, atau wali kelas dari kelas tersebut.
pub async fn ensure_homeroom_or_admin(
    pool: &MySqlPool,
    user: &AuthUser,
    school_id: Uuid,
    class_id: Uuid,
) -> AppResult<()> {
    if user.role == Role::Admin {
        return Ok(());
    }
    let homeroom: Option<Uuid> = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT homeroom_teacher_id FROM classes WHERE id = ? AND school_id = ?",
    )
    .bind(class_id)
    .bind(school_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    if homeroom == Some(user.user_id) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Format raport aktif: (versi, konfigurasi).
pub async fn active_format(pool: &MySqlPool, school_id: Uuid) -> AppResult<(i32, ReportFormat)> {
    let current = report_format::load_current(pool, school_id).await?;
    Ok((current.version, current.config))
}

/// Memastikan semester termasuk tahun ajaran tertentu dan mengembalikan rentang tanggalnya.
pub async fn semester_range(
    pool: &MySqlPool,
    school_id: Uuid,
    semester_id: Uuid,
    academic_year_id: Uuid,
) -> AppResult<(chrono::NaiveDate, chrono::NaiveDate)> {
    let (year, starts, ends): (Uuid, chrono::NaiveDate, chrono::NaiveDate) = sqlx::query_as(
        "SELECT academic_year_id, starts_on, ends_on FROM semesters WHERE id = ? AND school_id = ?",
    )
    .bind(semester_id)
    .bind(school_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::Validation(vec![crate::error::FieldIssue::new(
            "semester_id",
            "semester tidak ditemukan",
        )])
    })?;
    if year != academic_year_id {
        return Err(AppError::Validation(vec![crate::error::FieldIssue::new(
            "semester_id",
            "semester bukan milik tahun ajaran kelas/penugasan ini",
        )]));
    }
    Ok((starts, ends))
}
