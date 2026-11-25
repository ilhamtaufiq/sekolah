//! Penugasan guru (mapel × kelas) dan jadwal pelajaran.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::NaiveTime;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlPool};
use uuid::Uuid;

use super::{MASTER_WRITE, READ_ROLES, require_exists, require_teacher};
use crate::{
    auth::{AuthUser, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
    validate::Validator,
};

// ---------- Penugasan ----------

#[derive(Serialize, FromRow)]
pub struct Assignment {
    pub id: Uuid,
    pub academic_year_id: Uuid,
    pub class_id: Uuid,
    pub class_name: String,
    pub subject_id: Uuid,
    pub subject_name: String,
    pub teacher_id: Uuid,
    pub teacher_name: String,
}

#[derive(Deserialize)]
pub struct AssignmentFilter {
    pub academic_year_id: Option<Uuid>,
    pub class_id: Option<Uuid>,
    pub teacher_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct AssignmentInput {
    pub class_id: Uuid,
    pub subject_id: Uuid,
    pub teacher_id: Uuid,
}

pub async fn list_assignments(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<AssignmentFilter>,
) -> AppResult<Json<Vec<Assignment>>> {
    require_role(&user, READ_ROLES)?;
    let rows = sqlx::query_as(
        "SELECT a.id, a.academic_year_id, a.class_id, c.name AS class_name, a.subject_id, s.name AS subject_name, a.teacher_id, u.name AS teacher_name FROM teaching_assignments a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id JOIN users u ON u.id = a.teacher_id WHERE a.school_id = ? \
         AND a.academic_year_id = COALESCE(?, (SELECT id FROM academic_years WHERE school_id = ? AND is_active = TRUE)) \
         AND (? IS NULL OR a.class_id = ?) AND (? IS NULL OR a.teacher_id = ?) \
         ORDER BY c.name, s.name",
    )
        .bind(user.school_id)
        .bind(f.academic_year_id)
        .bind(user.school_id)
        .bind(f.class_id)
        .bind(f.class_id)
        .bind(f.teacher_id)
        .bind(f.teacher_id)
        .fetch_all(&st.pool)
        .await?;
    Ok(Json(rows))
}

async fn fetch_assignment(pool: &MySqlPool, school_id: Uuid, id: Uuid) -> AppResult<Assignment> {
    sqlx::query_as(
        "SELECT a.id, a.academic_year_id, a.class_id, c.name AS class_name, a.subject_id, s.name AS subject_name, a.teacher_id, u.name AS teacher_name FROM teaching_assignments a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id JOIN users u ON u.id = a.teacher_id WHERE a.id = ? AND a.school_id = ?",
    )
        .bind(id)
        .bind(school_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

pub async fn create_assignment(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<AssignmentInput>,
) -> AppResult<Json<Assignment>> {
    require_role(&user, MASTER_WRITE)?;
    let sid = user.school_id;
    require_exists(
        &st.pool,
        "SELECT 1 FROM classes WHERE id = ? AND school_id = ?",
        sid,
        input.class_id,
        "class_id",
        "kelas tidak ditemukan",
    )
    .await?;
    require_exists(
        &st.pool,
        "SELECT 1 FROM subjects WHERE id = ? AND school_id = ?",
        sid,
        input.subject_id,
        "subject_id",
        "mapel tidak ditemukan",
    )
    .await?;
    require_teacher(&st.pool, sid, input.teacher_id, "teacher_id").await?;

    // Tahun ajaran penugasan mengikuti tahun ajaran kelasnya.
    let year: Uuid = sqlx::query_scalar("SELECT academic_year_id FROM classes WHERE id = ?")
        .bind(input.class_id)
        .fetch_one(&st.pool)
        .await?;

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO teaching_assignments (id, school_id, academic_year_id, class_id, subject_id, teacher_id) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(sid)
    .bind(year)
    .bind(input.class_id)
    .bind(input.subject_id)
    .bind(input.teacher_id)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "mapel ini sudah punya guru di kelas tersebut"))?;

    Ok(Json(fetch_assignment(&st.pool, sid, id).await?))
}

pub async fn delete_assignment(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, MASTER_WRITE)?;
    let result = sqlx::query("DELETE FROM teaching_assignments WHERE id = ? AND school_id = ?")
        .bind(id)
        .bind(user.school_id)
        .execute(&st.pool)
        .await
        .map_err(|e| AppError::from_db(e, "penugasan tidak bisa dihapus"))?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "deleted": true })))
}

// ---------- Jadwal ----------

#[derive(Serialize, FromRow)]
pub struct ScheduleSlot {
    pub id: Uuid,
    pub assignment_id: Uuid,
    pub class_id: Uuid,
    pub class_name: String,
    pub subject_name: String,
    pub teacher_id: Uuid,
    pub teacher_name: String,
    pub day_of_week: u8,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub room: Option<String>,
}

#[derive(Deserialize)]
pub struct ScheduleFilter {
    pub academic_year_id: Option<Uuid>,
    pub class_id: Option<Uuid>,
    pub teacher_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct ScheduleInput {
    pub assignment_id: Uuid,
    pub day_of_week: u8,
    /// Format HH:MM:SS.
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub room: Option<String>,
}

pub async fn list_schedules(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<ScheduleFilter>,
) -> AppResult<Json<Vec<ScheduleSlot>>> {
    require_role(&user, READ_ROLES)?;
    let rows = sqlx::query_as(
        "SELECT sl.id, sl.assignment_id, a.class_id, c.name AS class_name, s.name AS subject_name, a.teacher_id, u.name AS teacher_name, sl.day_of_week, sl.start_time, sl.end_time, sl.room FROM schedule_slots sl JOIN teaching_assignments a ON a.id = sl.assignment_id JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id JOIN users u ON u.id = a.teacher_id WHERE sl.school_id = ? \
         AND a.academic_year_id = COALESCE(?, (SELECT id FROM academic_years WHERE school_id = ? AND is_active = TRUE)) \
         AND (? IS NULL OR a.class_id = ?) AND (? IS NULL OR a.teacher_id = ?) \
         ORDER BY sl.day_of_week, sl.start_time",
    )
        .bind(user.school_id)
        .bind(f.academic_year_id)
        .bind(user.school_id)
        .bind(f.class_id)
        .bind(f.class_id)
        .bind(f.teacher_id)
        .bind(f.teacher_id)
        .fetch_all(&st.pool)
        .await?;
    Ok(Json(rows))
}

async fn fetch_slot(pool: &MySqlPool, school_id: Uuid, id: Uuid) -> AppResult<ScheduleSlot> {
    sqlx::query_as(
        "SELECT sl.id, sl.assignment_id, a.class_id, c.name AS class_name, s.name AS subject_name, a.teacher_id, u.name AS teacher_name, sl.day_of_week, sl.start_time, sl.end_time, sl.room FROM schedule_slots sl JOIN teaching_assignments a ON a.id = sl.assignment_id JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id JOIN users u ON u.id = a.teacher_id WHERE sl.id = ? AND sl.school_id = ?",
    )
        .bind(id)
        .bind(school_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

pub async fn create_schedule(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<ScheduleInput>,
) -> AppResult<Json<ScheduleSlot>> {
    require_role(&user, MASTER_WRITE)?;
    let sid = user.school_id;

    let mut v = Validator::new();
    v.require(
        (1..=7).contains(&input.day_of_week),
        "day_of_week",
        "hari harus 1 (Senin) sampai 7 (Minggu)",
    );
    v.require(
        input.end_time > input.start_time,
        "end_time",
        "jam selesai harus setelah jam mulai",
    );
    let room = v.opt_text("room", input.room.as_deref(), 40);
    v.finish()?;

    // Kelas dan guru diambil dari penugasan.
    let (class_id, teacher_id): (Uuid, Uuid) = sqlx::query_as(
        "SELECT class_id, teacher_id FROM teaching_assignments WHERE id = ? AND school_id = ?",
    )
    .bind(input.assignment_id)
    .bind(sid)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| {
        AppError::Validation(vec![FieldIssue::new(
            "assignment_id",
            "penugasan tidak ditemukan",
        )])
    })?;

    let id = Uuid::new_v4();
    let mut tx = st.pool.begin().await?;
    // Kunci kelas dan guru agar dua jadwal baru yang bentrok tidak lolos bersamaan.
    sqlx::query("SELECT id FROM classes WHERE id = ? FOR UPDATE")
        .bind(class_id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("SELECT id FROM users WHERE id = ? FOR UPDATE")
        .bind(teacher_id)
        .fetch_one(&mut *tx)
        .await?;

    let clash: Option<(String, String, String)> = sqlx::query_as(
        "SELECT c.name, s.name, u.name \
         FROM schedule_slots sl \
         JOIN teaching_assignments a ON a.id = sl.assignment_id \
         JOIN classes c ON c.id = a.class_id \
         JOIN subjects s ON s.id = a.subject_id \
         JOIN users u ON u.id = a.teacher_id \
         WHERE sl.school_id = ? AND sl.day_of_week = ? \
           AND sl.start_time < ? AND sl.end_time > ? \
           AND (a.class_id = ? OR a.teacher_id = ?) \
         LIMIT 1",
    )
    .bind(sid)
    .bind(input.day_of_week)
    .bind(input.end_time)
    .bind(input.start_time)
    .bind(class_id)
    .bind(teacher_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((class_name, subject, teacher)) = clash {
        return Err(AppError::Conflict(format!(
            "bentrok dengan jadwal {subject} di kelas {class_name} (guru: {teacher}) pada jam tersebut"
        )));
    }

    sqlx::query(
        "INSERT INTO schedule_slots (id, school_id, assignment_id, day_of_week, start_time, end_time, room) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(sid)
    .bind(input.assignment_id)
    .bind(input.day_of_week)
    .bind(input.start_time)
    .bind(input.end_time)
    .bind(&room)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(fetch_slot(&st.pool, sid, id).await?))
}

pub async fn delete_schedule(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, MASTER_WRITE)?;
    let result = sqlx::query("DELETE FROM schedule_slots WHERE id = ? AND school_id = ?")
        .bind(id)
        .bind(user.school_id)
        .execute(&st.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "deleted": true })))
}
