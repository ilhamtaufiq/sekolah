use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{
    MASTER_WRITE, READ_ROLES, active_year_id, require_exists, require_teacher, students::Student,
};
use crate::{
    auth::{AuthUser, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
    validate::Validator,
};

#[derive(Serialize, FromRow)]
pub struct ClassRow {
    pub id: Uuid,
    pub academic_year_id: Uuid,
    pub name: String,
    pub grade_level: u8,
    pub homeroom_teacher_id: Option<Uuid>,
    pub homeroom_teacher_name: Option<String>,
    pub student_count: i64,
}

#[derive(Deserialize)]
pub struct ClassFilter {
    pub academic_year_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct ClassInput {
    pub name: String,
    pub grade_level: u8,
    pub homeroom_teacher_id: Option<Uuid>,
    /// Kosong = tahun ajaran yang aktif (hanya saat membuat).
    pub academic_year_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct EnrollInput {
    pub student_ids: Vec<Uuid>,
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Query(filter): Query<ClassFilter>,
) -> AppResult<Json<Vec<ClassRow>>> {
    require_role(&user, READ_ROLES)?;
    let rows = sqlx::query_as(
        "SELECT c.id, c.academic_year_id, c.name, c.grade_level, c.homeroom_teacher_id, u.name AS homeroom_teacher_name, CAST((SELECT COUNT(*) FROM class_enrollments e WHERE e.class_id = c.id) AS SIGNED) AS student_count FROM classes c LEFT JOIN users u ON u.id = c.homeroom_teacher_id WHERE c.school_id = ? AND c.academic_year_id = COALESCE(?, \
         (SELECT id FROM academic_years WHERE school_id = ? AND is_active = TRUE)) \
         ORDER BY c.grade_level, c.name",
    )
        .bind(user.school_id)
        .bind(filter.academic_year_id)
        .bind(user.school_id)
        .fetch_all(&st.pool)
        .await?;
    Ok(Json(rows))
}

async fn fetch_class(pool: &sqlx::MySqlPool, school_id: Uuid, id: Uuid) -> AppResult<ClassRow> {
    sqlx::query_as(
        "SELECT c.id, c.academic_year_id, c.name, c.grade_level, c.homeroom_teacher_id, u.name AS homeroom_teacher_name, CAST((SELECT COUNT(*) FROM class_enrollments e WHERE e.class_id = c.id) AS SIGNED) AS student_count FROM classes c LEFT JOIN users u ON u.id = c.homeroom_teacher_id WHERE c.id = ? AND c.school_id = ?",
    )
        .bind(id)
        .bind(school_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

async fn validate_class(
    pool: &sqlx::MySqlPool,
    school_id: Uuid,
    input: &ClassInput,
) -> AppResult<String> {
    let mut v = Validator::new();
    let name = v.text("name", &input.name, 1, 40);
    v.require(
        (1..=12).contains(&input.grade_level),
        "grade_level",
        "tingkat harus 1–12",
    );
    v.finish()?;

    if let Some(teacher) = input.homeroom_teacher_id {
        require_teacher(pool, school_id, teacher, "homeroom_teacher_id").await?;
    }
    Ok(name)
}

pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<ClassInput>,
) -> AppResult<Json<ClassRow>> {
    require_role(&user, MASTER_WRITE)?;
    let name = validate_class(&st.pool, user.school_id, &input).await?;

    let year = match input.academic_year_id {
        Some(id) => {
            require_exists(
                &st.pool,
                "SELECT 1 FROM academic_years WHERE id = ? AND school_id = ?",
                user.school_id,
                id,
                "academic_year_id",
                "tahun ajaran tidak ditemukan",
            )
            .await?;
            id
        }
        None => active_year_id(&st.pool, user.school_id)
            .await?
            .ok_or_else(|| {
                AppError::Validation(vec![FieldIssue::new(
                    "academic_year_id",
                    "belum ada tahun ajaran aktif; aktifkan tahun ajaran dulu",
                )])
            })?,
    };

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO classes (id, school_id, academic_year_id, name, grade_level, homeroom_teacher_id) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(year)
    .bind(&name)
    .bind(input.grade_level)
    .bind(input.homeroom_teacher_id)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "nama kelas sudah dipakai di tahun ajaran ini"))?;

    Ok(Json(fetch_class(&st.pool, user.school_id, id).await?))
}

pub async fn update(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<ClassInput>,
) -> AppResult<Json<ClassRow>> {
    require_role(&user, MASTER_WRITE)?;
    let name = validate_class(&st.pool, user.school_id, &input).await?;

    let result = sqlx::query(
        "UPDATE classes SET name = ?, grade_level = ?, homeroom_teacher_id = ? WHERE id = ? AND school_id = ?",
    )
    .bind(&name)
    .bind(input.grade_level)
    .bind(input.homeroom_teacher_id)
    .bind(id)
    .bind(user.school_id)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "nama kelas sudah dipakai di tahun ajaran ini"))?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(Json(fetch_class(&st.pool, user.school_id, id).await?))
}

pub async fn list_students(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Student>>> {
    require_role(&user, READ_ROLES)?;
    fetch_class(&st.pool, user.school_id, id).await?;

    let rows = sqlx::query_as(
        "SELECT s.id, s.nis, s.nisn, s.name, s.gender, s.birth_date, s.status \
         FROM class_enrollments e JOIN students s ON s.id = e.student_id \
         WHERE e.class_id = ? AND e.school_id = ? ORDER BY s.name",
    )
    .bind(id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

/// Menambahkan siswa ke rombel. Seluruh permintaan ditolak bila ada siswa yang
/// tidak aktif atau sudah berada di kelas lain pada tahun ajaran yang sama.
pub async fn add_students(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<EnrollInput>,
) -> AppResult<Json<Vec<Student>>> {
    require_role(&user, MASTER_WRITE)?;

    let mut ids = input.student_ids.clone();
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "student_ids",
            "pilih minimal satu siswa",
        )]));
    }

    let class = fetch_class(&st.pool, user.school_id, id).await?;
    let year = class.academic_year_id;

    let mut tx = st.pool.begin().await?;
    // Kunci kelas supaya dua penambahan bersamaan tidak saling melewati pengecekan.
    sqlx::query("SELECT id FROM classes WHERE id = ? FOR UPDATE")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;

    let mut issues = Vec::new();
    for sid in &ids {
        let row: Option<(String, String, Uuid)> = sqlx::query_as(
            "SELECT s.name, s.status, COALESCE(c.id, UNHEX(REPEAT('0', 32))) \
             FROM students s \
             LEFT JOIN class_enrollments e ON e.student_id = s.id AND e.academic_year_id = ? \
             LEFT JOIN classes c ON c.id = e.class_id \
             WHERE s.id = ? AND s.school_id = ?",
        )
        .bind(year)
        .bind(sid)
        .bind(user.school_id)
        .fetch_optional(&mut *tx)
        .await?;

        match row {
            None => issues.push(FieldIssue::new(
                "student_ids",
                format!("siswa {sid} tidak ditemukan"),
            )),
            Some((name, status, _)) if status != "aktif" => {
                issues.push(FieldIssue::new(
                    "student_ids",
                    format!("{name} tidak berstatus aktif"),
                ));
            }
            Some((name, _, current_class)) if current_class != id => {
                // Sudah di kelas lain pada tahun yang sama, atau kosong (nol) jika belum.
                if current_class != Uuid::nil() {
                    issues.push(FieldIssue::new(
                        "student_ids",
                        format!("{name} sudah terdaftar di kelas lain pada tahun ajaran ini"),
                    ));
                }
            }
            Some(_) => {} // sudah di kelas ini: dilewati
        }
    }
    if !issues.is_empty() {
        return Err(AppError::Validation(issues));
    }

    for sid in &ids {
        // Siswa yang sudah di kelas ini sudah lolos pengecekan; INSERT IGNORE menjaga idempotensi.
        sqlx::query(
            "INSERT IGNORE INTO class_enrollments (id, school_id, academic_year_id, class_id, student_id) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4())
        .bind(user.school_id)
        .bind(year)
        .bind(id)
        .bind(sid)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    list_students(State(st), user, Path(id)).await
}

pub async fn remove_student(
    State(st): State<AppState>,
    user: AuthUser,
    Path((id, student_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, MASTER_WRITE)?;
    let result = sqlx::query(
        "DELETE FROM class_enrollments WHERE class_id = ? AND student_id = ? AND school_id = ?",
    )
    .bind(id)
    .bind(student_id)
    .bind(user.school_id)
    .execute(&st.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "removed": true })))
}
