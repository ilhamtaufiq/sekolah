use std::collections::HashSet;

use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{READ_ROLES, active_format, calc, ensure_manage, load_assignment};
use crate::{
    auth::{AuthUser, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
};

/// Satu baris di daftar nilai: seluruh siswa kelas, dengan skor bila sudah diisi.
#[derive(Serialize, FromRow)]
pub struct EntryRow {
    pub student_id: Uuid,
    pub nis: String,
    pub name: String,
    pub score: Option<f64>,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct EntryFilter {
    pub component_id: Uuid,
}

#[derive(Deserialize)]
pub struct EntryUpdate {
    pub student_id: Uuid,
    /// None = hapus nilai siswa ini untuk komponen tersebut.
    pub score: Option<f64>,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct BulkEntries {
    pub component_id: Uuid,
    pub entries: Vec<EntryUpdate>,
}

/// Komponen beserta penugasannya (untuk pemeriksaan hak akses).
struct ComponentCtx {
    assignment_id: Uuid,
}

async fn component_ctx(
    pool: &sqlx::MySqlPool,
    school_id: Uuid,
    id: Uuid,
) -> AppResult<ComponentCtx> {
    let assignment_id: Uuid = sqlx::query_scalar(
        "SELECT assignment_id FROM grade_components WHERE id = ? AND school_id = ?",
    )
    .bind(id)
    .bind(school_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(ComponentCtx { assignment_id })
}

async fn load_rows(
    pool: &sqlx::MySqlPool,
    school_id: Uuid,
    component_id: Uuid,
) -> AppResult<Vec<EntryRow>> {
    let rows = sqlx::query_as(
        "SELECT s.id AS student_id, s.nis, s.name, e.score, e.note \
         FROM grade_components c \
         JOIN teaching_assignments a ON a.id = c.assignment_id \
         JOIN class_enrollments en ON en.class_id = a.class_id AND en.academic_year_id = a.academic_year_id \
         JOIN students s ON s.id = en.student_id \
         LEFT JOIN grade_entries e ON e.component_id = c.id AND e.student_id = s.id \
         WHERE c.id = ? AND c.school_id = ? \
         ORDER BY s.name",
    )
    .bind(component_id)
    .bind(school_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<EntryFilter>,
) -> AppResult<Json<Vec<EntryRow>>> {
    require_role(&user, READ_ROLES)?;
    // Semua peran baca boleh melihat nilai; penulisan dibatasi ensure_manage saat simpan.
    component_ctx(&st.pool, user.school_id, f.component_id).await?;
    Ok(Json(
        load_rows(&st.pool, user.school_id, f.component_id).await?,
    ))
}

/// Simpan nilai massal. Seluruh permintaan ditolak bila ada satu baris yang tidak valid,
/// supaya tidak ada nilai yang tersimpan setengah.
pub async fn save(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<BulkEntries>,
) -> AppResult<Json<Vec<EntryRow>>> {
    require_role(&user, READ_ROLES)?;
    let c = component_ctx(&st.pool, user.school_id, input.component_id).await?;
    let a = load_assignment(&st.pool, user.school_id, c.assignment_id).await?;
    ensure_manage(&user, &a)?;

    let (_, format) = active_format(&st.pool, user.school_id).await?;
    let grading = &format.grading;

    let roster: HashSet<Uuid> = load_rows(&st.pool, user.school_id, input.component_id)
        .await?
        .into_iter()
        .map(|r| r.student_id)
        .collect();

    let mut issues = Vec::new();
    let mut seen = HashSet::new();
    for (i, e) in input.entries.iter().enumerate() {
        if !seen.insert(e.student_id) {
            issues.push(FieldIssue::new(
                format!("entries[{i}].student_id"),
                "siswa dimasukkan dua kali",
            ));
        }
        if !roster.contains(&e.student_id) {
            issues.push(FieldIssue::new(
                format!("entries[{i}].student_id"),
                "siswa bukan anggota kelas ini",
            ));
        }
        if let Some(score) = e.score
            && !calc::in_range(score, grading)
        {
            issues.push(FieldIssue::new(
                format!("entries[{i}].score"),
                format!("nilai harus {}–{}", grading.min_score, grading.max_score),
            ));
        }
        if e.note.as_deref().is_some_and(|n| n.chars().count() > 200) {
            issues.push(FieldIssue::new(
                format!("entries[{i}].note"),
                "catatan maksimal 200 karakter",
            ));
        }
    }
    if !issues.is_empty() {
        return Err(AppError::Validation(issues));
    }

    let mut tx = st.pool.begin().await?;
    for e in &input.entries {
        match e.score {
            Some(score) => {
                let note = e.note.as_deref().map(str::trim).filter(|n| !n.is_empty());
                sqlx::query(
                    "INSERT INTO grade_entries (id, school_id, component_id, student_id, score, note, updated_by) \
                     VALUES (?, ?, ?, ?, ?, ?, ?) AS new \
                     ON DUPLICATE KEY UPDATE score = new.score, note = new.note, \
                         updated_by = new.updated_by, updated_at = UTC_TIMESTAMP(6)",
                )
                .bind(Uuid::new_v4())
                .bind(user.school_id)
                .bind(input.component_id)
                .bind(e.student_id)
                .bind(score)
                .bind(note)
                .bind(user.user_id)
                .execute(&mut *tx)
                .await?;
            }
            None => {
                sqlx::query("DELETE FROM grade_entries WHERE component_id = ? AND student_id = ?")
                    .bind(input.component_id)
                    .bind(e.student_id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }
    tx.commit().await?;

    Ok(Json(
        load_rows(&st.pool, user.school_id, input.component_id).await?,
    ))
}
