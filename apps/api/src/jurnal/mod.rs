//! Jurnal mengajar: catatan per jam pelajaran untuk satu penugasan pada satu tanggal,
//! disetujui kepala sekolah.
//!
//! Aturan:
//! - Guru atau wali kelas hanya mencatat jurnal untuk penugasannya sendiri.
//! - Guru hanya bisa mengubah jurnal miliknya saat draft atau ditolak.
//! - Kepala sekolah dan admin menyetujui atau menolak jurnal yang menunggu.
//! - Rekap hanya menghitung jurnal yang disetujui.
//! - Setiap query memfilter `school_id` dari token.

pub mod crud;
pub mod rekap;
pub mod review;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlPool};
use uuid::Uuid;

use crate::{
    auth::{AuthUser, Role},
    error::{AppError, AppResult, FieldIssue},
    validate::Validator,
};

pub const READ_ROLES: &[Role] = &[
    Role::Admin,
    Role::KepalaSekolah,
    Role::Guru,
    Role::WaliKelas,
];
pub const WRITE_ROLES: &[Role] = &[Role::Guru, Role::WaliKelas];
pub const REVIEW_ROLES: &[Role] = &[Role::Admin, Role::KepalaSekolah];

pub const STATUSES: &[&str] = &["draft", "menunggu", "disetujui", "ditolak"];

const MAX_HOUR: u8 = 20;
const MAX_TOPIC: usize = 200;
const MAX_NOTES: usize = 2000;
pub const MAX_DECISION_NOTE_CHARS: usize = 1000;

/// Guru dan wali kelas hanya melihat jurnalnya sendiri. Admin dan kepala sekolah melihat seluruh sekolah.
pub fn own_scope(user: &AuthUser) -> Option<Uuid> {
    match user.role {
        Role::Guru | Role::WaliKelas => Some(user.user_id),
        _ => None,
    }
}

/// Pilihan kolom dan join untuk satu jurnal lengkap. Tambahkan `WHERE` setelahnya.
pub const SELECT_VIEW: &str = "SELECT j.id, j.assignment_id, c.name AS class_name, s.name AS subject_name, \
        j.teacher_id, t.name AS teacher_name, j.journal_date, j.hour_no, j.topic, j.notes, \
        j.present_count, j.status, j.submitted_at, j.decided_by, d.name AS decided_by_name, \
        j.decided_at, j.decision_note, j.created_at, j.updated_at \
     FROM teaching_journals j \
     JOIN teaching_assignments a ON a.id = j.assignment_id \
     JOIN classes c ON c.id = a.class_id \
     JOIN subjects s ON s.id = a.subject_id \
     JOIN users t ON t.id = j.teacher_id \
     LEFT JOIN users d ON d.id = j.decided_by";

#[derive(Serialize, FromRow)]
pub struct JournalView {
    pub id: Uuid,
    pub assignment_id: Uuid,
    pub class_name: String,
    pub subject_name: String,
    pub teacher_id: Uuid,
    pub teacher_name: String,
    pub journal_date: NaiveDate,
    pub hour_no: u8,
    pub topic: String,
    pub notes: Option<String>,
    pub present_count: Option<u16>,
    pub status: String,
    pub submitted_at: Option<DateTime<Utc>>,
    pub decided_by: Option<Uuid>,
    pub decided_by_name: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub decision_note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Isi jurnal yang bisa diubah guru.
#[derive(Deserialize)]
pub struct JournalInput {
    pub journal_date: NaiveDate,
    pub hour_no: u8,
    pub topic: String,
    pub notes: Option<String>,
    pub present_count: Option<u16>,
}

/// Data penugasan yang dibutuhkan untuk validasi jurnal.
#[derive(FromRow)]
pub struct AssignmentCtx {
    pub class_id: Uuid,
    pub teacher_id: Uuid,
    pub starts_on: NaiveDate,
    pub ends_on: NaiveDate,
}

pub async fn fetch(pool: &MySqlPool, school_id: Uuid, id: Uuid) -> AppResult<JournalView> {
    let sql = format!("{SELECT_VIEW} WHERE j.id = ? AND j.school_id = ?");
    sqlx::query_as(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(id)
        .bind(school_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

pub async fn assignment_ctx(
    pool: &MySqlPool,
    school_id: Uuid,
    id: Uuid,
) -> AppResult<Option<AssignmentCtx>> {
    Ok(sqlx::query_as(
        "SELECT a.class_id, a.teacher_id, y.starts_on, y.ends_on \
         FROM teaching_assignments a \
         JOIN academic_years y ON y.id = a.academic_year_id \
         WHERE a.id = ? AND a.school_id = ?",
    )
    .bind(id)
    .bind(school_id)
    .fetch_optional(pool)
    .await?)
}

pub async fn enrolled_count(pool: &MySqlPool, school_id: Uuid, class_id: Uuid) -> AppResult<i64> {
    Ok(sqlx::query_scalar(
        "SELECT COUNT(*) FROM class_enrollments WHERE class_id = ? AND school_id = ?",
    )
    .bind(class_id)
    .bind(school_id)
    .fetch_one(pool)
    .await?)
}

/// Validasi isi jurnal. Tanggal harus sudah lewat (atau hari ini) dan berada dalam tahun ajaran penugasan.
pub fn check_input(
    input: &JournalInput,
    ctx: &AssignmentCtx,
    enrolled: i64,
    today: NaiveDate,
) -> AppResult<(String, Option<String>)> {
    let mut v = Validator::new();
    v.require(
        input.journal_date <= today,
        "journal_date",
        "tanggal jurnal tidak boleh di masa depan",
    );
    v.require(
        input.journal_date >= ctx.starts_on && input.journal_date <= ctx.ends_on,
        "journal_date",
        "tanggal di luar tahun ajaran penugasan ini",
    );
    v.require(
        (1..=MAX_HOUR).contains(&input.hour_no),
        "hour_no",
        "jam ke harus 1–20",
    );
    let topic = v.text("topic", &input.topic, 3, MAX_TOPIC);
    let notes = v.opt_text("notes", input.notes.as_deref(), MAX_NOTES);
    if let Some(n) = input.present_count {
        v.require(
            i64::from(n) <= enrolled,
            "present_count",
            &format!("jumlah hadir tidak boleh lebih dari {enrolled} siswa di kelas"),
        );
    }
    v.finish()?;
    Ok((topic, notes))
}

/// Penugasan tidak ditemukan di sekolah ini.
pub fn assignment_not_found() -> AppError {
    AppError::Validation(vec![FieldIssue::new(
        "assignment_id",
        "penugasan tidak ditemukan",
    )])
}
