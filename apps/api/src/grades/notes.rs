use std::collections::HashMap;

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{READ_ROLES, ensure_homeroom_or_admin, semester_range};
use crate::{
    auth::{AuthUser, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
};

/// Baris catatan dari database: (id siswa, nis, nama, sikap, ekstrakurikuler, wali kelas).
type NoteDbRow = (
    Uuid,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
);

#[derive(Serialize, Clone, Default)]
pub struct Absences {
    pub sakit: i64,
    pub izin: i64,
    pub alpa: i64,
}

#[derive(Serialize, Clone)]
pub struct TermNoteRow {
    pub student_id: Uuid,
    pub nis: String,
    pub name: String,
    pub attitude: Option<String>,
    pub extracurricular: Option<String>,
    pub homeroom_note: Option<String>,
    pub absences: Absences,
}

#[derive(Deserialize)]
pub struct NoteFilter {
    pub class_id: Uuid,
    pub semester_id: Uuid,
}

#[derive(Deserialize)]
pub struct NoteUpdate {
    pub student_id: Uuid,
    pub attitude: Option<String>,
    pub extracurricular: Option<String>,
    pub homeroom_note: Option<String>,
}

#[derive(Deserialize)]
pub struct NotesInput {
    pub class_id: Uuid,
    pub semester_id: Uuid,
    pub notes: Vec<NoteUpdate>,
}

/// Rekap ketidakhadiran dari absensi harian F2 dalam rentang semester, per siswa.
pub async fn term_absences(
    pool: &sqlx::MySqlPool,
    school_id: Uuid,
    class_id: Uuid,
    starts: NaiveDate,
    ends: NaiveDate,
) -> AppResult<HashMap<Uuid, Absences>> {
    let rows: Vec<(Uuid, i64, i64, i64)> = sqlx::query_as(
        "SELECT r.student_id, \
                CAST(COALESCE(SUM(r.status = 'S'), 0) AS SIGNED), \
                CAST(COALESCE(SUM(r.status = 'I'), 0) AS SIGNED), \
                CAST(COALESCE(SUM(r.status = 'A'), 0) AS SIGNED) \
         FROM attendance_records r \
         JOIN attendance_sessions ss ON ss.id = r.session_id \
         WHERE ss.school_id = ? AND ss.class_id = ? AND ss.kind = 'harian' \
           AND ss.session_date BETWEEN ? AND ? \
         GROUP BY r.student_id",
    )
    .bind(school_id)
    .bind(class_id)
    .bind(starts)
    .bind(ends)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(sid, sakit, izin, alpa)| (sid, Absences { sakit, izin, alpa }))
        .collect())
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<NoteFilter>,
) -> AppResult<Json<Vec<TermNoteRow>>> {
    require_role(&user, READ_ROLES)?;
    let year: Uuid =
        sqlx::query_scalar("SELECT academic_year_id FROM classes WHERE id = ? AND school_id = ?")
            .bind(f.class_id)
            .bind(user.school_id)
            .fetch_optional(&st.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    let (starts, ends) = semester_range(&st.pool, user.school_id, f.semester_id, year).await?;

    let rows: Vec<NoteDbRow> = sqlx::query_as(
        "SELECT s.id, s.nis, s.name, n.attitude, n.extracurricular, n.homeroom_note \
         FROM class_enrollments en JOIN students s ON s.id = en.student_id \
         LEFT JOIN student_term_notes n ON n.student_id = s.id AND n.semester_id = ? \
         WHERE en.class_id = ? AND en.school_id = ? ORDER BY s.name",
    )
    .bind(f.semester_id)
    .bind(f.class_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;

    let absences = term_absences(&st.pool, user.school_id, f.class_id, starts, ends).await?;
    Ok(Json(
        rows.into_iter()
            .map(
                |(sid, nis, name, attitude, extracurricular, homeroom_note)| TermNoteRow {
                    student_id: sid,
                    nis,
                    name,
                    attitude,
                    extracurricular,
                    homeroom_note,
                    absences: absences.get(&sid).cloned().unwrap_or_default(),
                },
            )
            .collect(),
    ))
}

pub async fn save(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<NotesInput>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, READ_ROLES)?;
    ensure_homeroom_or_admin(&st.pool, &user, user.school_id, input.class_id).await?;
    let year: Uuid =
        sqlx::query_scalar("SELECT academic_year_id FROM classes WHERE id = ? AND school_id = ?")
            .bind(input.class_id)
            .bind(user.school_id)
            .fetch_optional(&st.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    semester_range(&st.pool, user.school_id, input.semester_id, year).await?;

    let roster: std::collections::HashSet<Uuid> = sqlx::query_scalar(
        "SELECT student_id FROM class_enrollments WHERE class_id = ? AND school_id = ?",
    )
    .bind(input.class_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?
    .into_iter()
    .collect();

    let mut issues = Vec::new();
    for (i, n) in input.notes.iter().enumerate() {
        if !roster.contains(&n.student_id) {
            issues.push(FieldIssue::new(
                format!("notes[{i}].student_id"),
                "siswa bukan anggota kelas ini",
            ));
        }
        for (field, value) in [
            ("attitude", &n.attitude),
            ("extracurricular", &n.extracurricular),
            ("homeroom_note", &n.homeroom_note),
        ] {
            if value.as_deref().is_some_and(|v| v.chars().count() > 1000) {
                issues.push(FieldIssue::new(
                    format!("notes[{i}].{field}"),
                    "maksimal 1000 karakter",
                ));
            }
        }
    }
    if !issues.is_empty() {
        return Err(AppError::Validation(issues));
    }

    let clean = |v: &Option<String>| {
        v.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let mut tx = st.pool.begin().await?;
    for n in &input.notes {
        sqlx::query(
            "INSERT INTO student_term_notes (id, school_id, class_id, semester_id, student_id, attitude, extracurricular, homeroom_note) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new \
             ON DUPLICATE KEY UPDATE attitude = new.attitude, extracurricular = new.extracurricular, \
                 homeroom_note = new.homeroom_note, updated_at = UTC_TIMESTAMP(6)",
        )
        .bind(Uuid::new_v4())
        .bind(user.school_id)
        .bind(input.class_id)
        .bind(input.semester_id)
        .bind(n.student_id)
        .bind(clean(&n.attitude))
        .bind(clean(&n.extracurricular))
        .bind(clean(&n.homeroom_note))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "saved": input.notes.len() })))
}
