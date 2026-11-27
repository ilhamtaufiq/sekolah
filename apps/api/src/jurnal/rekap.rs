//! Rekap jurnal yang disetujui: per penugasan, untuk rentang tanggal tertentu.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlPool};
use uuid::Uuid;

use super::{READ_ROLES, assignment_ctx, assignment_not_found, own_scope};
use crate::{
    auth::{AuthUser, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
};

#[derive(Deserialize)]
pub struct RekapFilter {
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub class_id: Option<Uuid>,
    pub teacher_id: Option<Uuid>,
    pub assignment_id: Option<Uuid>,
}

/// Ringkasan jurnal disetujui untuk satu penugasan.
#[derive(Serialize, FromRow)]
pub struct RekapRow {
    pub assignment_id: Uuid,
    pub class_name: String,
    pub subject_name: String,
    pub teacher_name: String,
    /// Jumlah jam pelajaran yang sudah disetujui.
    pub jumlah_jam: i64,
    /// Jumlah tanggal berbeda yang punya jurnal disetujui.
    pub jumlah_hari: i64,
    /// Jumlah jam yang mencatat jumlah hadir.
    pub jam_dengan_hadir: i64,
    /// Total hadir dari jam yang mencatat jumlah hadir.
    pub total_hadir: i64,
}

fn validate_range(from: Option<NaiveDate>, to: Option<NaiveDate>) -> AppResult<()> {
    match (from, to) {
        (Some(f), Some(t)) if t < f => Err(AppError::Validation(vec![FieldIssue::new(
            "to",
            "tanggal akhir tidak boleh sebelum tanggal awal",
        )])),
        _ => Ok(()),
    }
}

async fn run(pool: &MySqlPool, school_id: Uuid, f: &RekapFilter, teacher: Option<Uuid>) -> AppResult<Vec<RekapRow>> {
    Ok(sqlx::query_as(
        "SELECT a.id AS assignment_id, c.name AS class_name, s.name AS subject_name, t.name AS teacher_name, \
                CAST(COUNT(j.id) AS SIGNED) AS jumlah_jam, \
                CAST(COUNT(DISTINCT j.journal_date) AS SIGNED) AS jumlah_hari, \
                CAST(COUNT(j.present_count) AS SIGNED) AS jam_dengan_hadir, \
                CAST(COALESCE(SUM(j.present_count), 0) AS SIGNED) AS total_hadir \
         FROM teaching_assignments a \
         JOIN classes c ON c.id = a.class_id \
         JOIN subjects s ON s.id = a.subject_id \
         JOIN users t ON t.id = a.teacher_id \
         JOIN teaching_journals j ON j.assignment_id = a.id AND j.status = 'disetujui' \
              AND (? IS NULL OR j.journal_date >= ?) \
              AND (? IS NULL OR j.journal_date <= ?) \
         WHERE a.school_id = ? \
           AND (? IS NULL OR a.class_id = ?) \
           AND (? IS NULL OR a.teacher_id = ?) \
           AND (? IS NULL OR a.id = ?) \
         GROUP BY a.id, c.name, s.name, t.name \
         ORDER BY c.name, s.name",
    )
    .bind(f.from)
    .bind(f.from)
    .bind(f.to)
    .bind(f.to)
    .bind(school_id)
    .bind(f.class_id)
    .bind(f.class_id)
    .bind(teacher)
    .bind(teacher)
    .bind(f.assignment_id)
    .bind(f.assignment_id)
    .fetch_all(pool)
    .await?)
}

/// Rekap seluruh penugasan dalam rentang tanggal. Guru hanya melihat penugasannya sendiri.
pub async fn range(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<RekapFilter>,
) -> AppResult<Json<Vec<RekapRow>>> {
    require_role(&user, READ_ROLES)?;
    validate_range(f.from, f.to)?;
    let teacher = own_scope(&user).or(f.teacher_id);
    Ok(Json(run(&st.pool, user.school_id, &f, teacher).await?))
}

/// Rekap satu penugasan dalam rentang tanggal. Penugasan tanpa jurnal disetujui menghasilkan nol.
pub async fn assignment(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Query(f): Query<RekapFilter>,
) -> AppResult<Json<RekapRow>> {
    require_role(&user, READ_ROLES)?;
    validate_range(f.from, f.to)?;
    let sid = user.school_id;

    let ctx = assignment_ctx(&st.pool, sid, id)
        .await?
        .ok_or_else(assignment_not_found)?;
    if own_scope(&user).is_some_and(|me| me != ctx.teacher_id) {
        return Err(AppError::Forbidden);
    }

    let mut base: RekapRow = sqlx::query_as(
        "SELECT a.id AS assignment_id, c.name AS class_name, s.name AS subject_name, t.name AS teacher_name, \
                CAST(0 AS SIGNED) AS jumlah_jam, CAST(0 AS SIGNED) AS jumlah_hari, \
                CAST(0 AS SIGNED) AS jam_dengan_hadir, CAST(0 AS SIGNED) AS total_hadir \
         FROM teaching_assignments a \
         JOIN classes c ON c.id = a.class_id \
         JOIN subjects s ON s.id = a.subject_id \
         JOIN users t ON t.id = a.teacher_id \
         WHERE a.id = ? AND a.school_id = ?",
    )
    .bind(id)
    .bind(sid)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(assignment_not_found)?;

    let f = RekapFilter {
        assignment_id: Some(id),
        class_id: None,
        teacher_id: None,
        ..f
    };
    if let Some(row) = run(&st.pool, sid, &f, None).await?.into_iter().next() {
        base = row;
    }
    Ok(Json(base))
}
