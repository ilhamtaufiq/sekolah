use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{READ_ROLES, active_format, calc, ensure_manage, load_assignment, semester_range};
use crate::{
    auth::{AuthUser, require_role},
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(Serialize, FromRow, Clone)]
pub struct FinalRow {
    pub student_id: Uuid,
    pub nis: String,
    pub name: String,
    pub score: Option<f64>,
    pub predicate: Option<String>,
    pub kkm_met: Option<bool>,
    /// True bila ada komponen yang belum berisi nilai untuk siswa ini.
    pub incomplete: bool,
    pub format_version: Option<i32>,
}

#[derive(Deserialize)]
pub struct FinalFilter {
    pub assignment_id: Uuid,
    pub semester_id: Uuid,
}

#[derive(Deserialize)]
pub struct ComputeInput {
    pub assignment_id: Uuid,
    pub semester_id: Uuid,
}

/// Hitung ulang nilai akhir seluruh siswa kelas untuk satu penugasan dan semester,
/// lalu simpan sebagai snapshot beserta versi format yang dipakai.
/// Siswa yang belum lengkap nilai komponennya ditandai `incomplete` dan tidak punya skor.
pub async fn compute(
    pool: &sqlx::MySqlPool,
    school_id: Uuid,
    assignment_id: Uuid,
    semester_id: Uuid,
) -> AppResult<Vec<FinalRow>> {
    let a = load_assignment(pool, school_id, assignment_id).await?;
    semester_range(pool, school_id, semester_id, a.academic_year_id).await?;
    let (version, format) = active_format(pool, school_id).await?;
    let grading = &format.grading;

    let components: Vec<(Uuid, f64)> = sqlx::query_as(
        "SELECT id, weight FROM grade_components WHERE school_id = ? AND assignment_id = ? AND semester_id = ?",
    )
    .bind(school_id)
    .bind(assignment_id)
    .bind(semester_id)
    .fetch_all(pool)
    .await?;

    let students: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT s.id, s.nis, s.name FROM class_enrollments en JOIN students s ON s.id = en.student_id \
         WHERE en.class_id = ? AND en.academic_year_id = ? AND en.school_id = ? ORDER BY s.name",
    )
    .bind(a.class_id)
    .bind(a.academic_year_id)
    .bind(school_id)
    .fetch_all(pool)
    .await?;

    // Semua nilai untuk penugasan dan semester ini dalam satu query.
    let entries: Vec<(Uuid, Uuid, f64)> = sqlx::query_as(
        "SELECT e.student_id, c.id, e.score FROM grade_entries e \
         JOIN grade_components c ON c.id = e.component_id \
         WHERE e.school_id = ? AND c.assignment_id = ? AND c.semester_id = ?",
    )
    .bind(school_id)
    .bind(assignment_id)
    .bind(semester_id)
    .fetch_all(pool)
    .await?;

    let mut rows = Vec::with_capacity(students.len());
    let mut tx = pool.begin().await?;
    for (student_id, nis, name) in students {
        let parts: Vec<(f64, f64)> = components
            .iter()
            .filter_map(|(cid, weight)| {
                entries
                    .iter()
                    .find(|(sid, eid, _)| *sid == student_id && eid == cid)
                    .map(|(_, _, score)| (*weight, *score))
            })
            .collect();
        let incomplete = components.is_empty() || parts.len() != components.len();

        let score = if incomplete {
            None
        } else {
            calc::weighted_score(&parts, grading.decimal_places)
        };
        let predicate = score
            .and_then(|s| calc::predicate_for(s, grading))
            .map(|p| p.label.clone());
        let kkm = score.map(|s| calc::kkm_met(s, grading));

        sqlx::query(
            "INSERT INTO final_grades (id, school_id, assignment_id, semester_id, student_id, score, predicate, kkm_met, format_version) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) AS new \
             ON DUPLICATE KEY UPDATE score = new.score, predicate = new.predicate, kkm_met = new.kkm_met, \
                 format_version = new.format_version, computed_at = UTC_TIMESTAMP(6)",
        )
        .bind(Uuid::new_v4())
        .bind(school_id)
        .bind(assignment_id)
        .bind(semester_id)
        .bind(student_id)
        .bind(score)
        .bind(&predicate)
        .bind(kkm)
        .bind(version)
        .execute(&mut *tx)
        .await?;

        rows.push(FinalRow {
            student_id,
            nis,
            name,
            score,
            predicate,
            kkm_met: kkm,
            incomplete,
            format_version: Some(version),
        });
    }
    tx.commit().await?;
    Ok(rows)
}

pub async fn compute_handler(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<ComputeInput>,
) -> AppResult<Json<Vec<FinalRow>>> {
    require_role(&user, READ_ROLES)?;
    let a = load_assignment(&st.pool, user.school_id, input.assignment_id).await?;
    ensure_manage(&user, &a)?;
    let has_components: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM grade_components WHERE school_id = ? AND assignment_id = ? AND semester_id = ? LIMIT 1",
    )
    .bind(user.school_id)
    .bind(input.assignment_id)
    .bind(input.semester_id)
    .fetch_optional(&st.pool)
    .await?;
    if has_components.is_none() {
        return Err(AppError::Validation(vec![crate::error::FieldIssue::new(
            "assignment_id",
            "belum ada komponen nilai untuk mapel dan semester ini",
        )]));
    }
    Ok(Json(
        compute(
            &st.pool,
            user.school_id,
            input.assignment_id,
            input.semester_id,
        )
        .await?,
    ))
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<FinalFilter>,
) -> AppResult<Json<Vec<FinalRow>>> {
    require_role(&user, READ_ROLES)?;
    let rows = sqlx::query_as(
        "SELECT s.id AS student_id, s.nis, s.name, f.score, f.predicate, f.kkm_met, \
                (f.score IS NULL) AS incomplete, f.format_version \
         FROM final_grades f JOIN students s ON s.id = f.student_id \
         WHERE f.school_id = ? AND f.assignment_id = ? AND f.semester_id = ? ORDER BY s.name",
    )
    .bind(user.school_id)
    .bind(f.assignment_id)
    .bind(f.semester_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}
