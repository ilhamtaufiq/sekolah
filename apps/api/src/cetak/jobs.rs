//! Endpoint cetak massal: buat job, lihat status, daftar job sekolah, dan unduh ZIP.
//!
//! Admin dan wali kelas boleh membuat job (wali kelas hanya untuk kelas yang diampunya).
//! Status dan unduhan hanya untuk admin atau pembuat job, dan selalu dibatasi ke sekolah yang sama.

use axum::{
    Json,
    body::Body,
    extract::{Path as AxPath, State},
    http::{HeaderValue, StatusCode, header},
    response::Response,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{ANTREAN, SELESAI, worker, zip_dir};
use crate::{
    auth::{AuthUser, Role, require_role},
    error::{AppError, AppResult, FieldIssue},
    grades,
    state::AppState,
};

const ROLES: &[Role] = &[Role::Admin, Role::WaliKelas];

#[derive(Deserialize)]
pub struct CreateInput {
    pub class_id: Uuid,
    pub semester_id: Uuid,
}

#[derive(Serialize)]
pub struct CreatedJob {
    pub id: Uuid,
    pub status: &'static str,
}

#[derive(Serialize, FromRow)]
pub struct JobRow {
    pub id: Uuid,
    pub class_id: Uuid,
    pub class_name: String,
    pub semester_id: Uuid,
    pub semester_name: String,
    pub status: String,
    pub total: u32,
    pub selesai: u32,
    /// Daftar siswa yang gagal: [{ nis, nama, pesan }]. Null bila semua berhasil.
    pub errors: Option<serde_json::Value>,
    pub error_message: Option<String>,
    pub created_by: Uuid,
    pub created_by_name: String,
    pub created_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

fn ensure_owner(user: &AuthUser, created_by: Uuid) -> AppResult<()> {
    if user.role == Role::Admin || user.user_id == created_by {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Membuat job baru dan langsung mengembalikan id-nya. Pemrosesan berjalan di latar belakang.
pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<CreateInput>,
) -> AppResult<(StatusCode, Json<CreatedJob>)> {
    require_role(&user, ROLES)?;
    let school = user.school_id;
    grades::ensure_homeroom_or_admin(&st.pool, &user, school, input.class_id).await?;

    let academic_year_id: Uuid = sqlx::query_scalar(
        "SELECT academic_year_id FROM classes WHERE id = ? AND school_id = ?",
    )
    .bind(input.class_id)
    .bind(school)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    grades::semester_range(&st.pool, school, input.semester_id, academic_year_id).await?;

    let siswa: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM class_enrollments WHERE class_id = ? AND academic_year_id = ? AND school_id = ?",
    )
    .bind(input.class_id)
    .bind(academic_year_id)
    .bind(school)
    .fetch_one(&st.pool)
    .await?;
    if siswa == 0 {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "class_id",
            "kelas ini belum punya siswa",
        )]));
    }

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO report_jobs (id, school_id, class_id, semester_id, status, total, created_by) \
         VALUES (?, ?, ?, ?, 'antrean', ?, ?)",
    )
    .bind(id)
    .bind(school)
    .bind(input.class_id)
    .bind(input.semester_id)
    .bind(siswa as u32)
    .bind(user.user_id)
    .execute(&st.pool)
    .await?;

    worker::kick(st.clone(), school);
    Ok((
        StatusCode::CREATED,
        Json(CreatedJob {
            id,
            status: ANTREAN,
        }),
    ))
}

/// Daftar job sekolah. Admin melihat semua; wali kelas hanya job yang dibuatnya.
pub async fn list(State(st): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<JobRow>>> {
    require_role(&user, ROLES)?;
    let rows: Vec<JobRow> = if user.role == Role::Admin {
        sqlx::query_as(
            "SELECT j.id, j.class_id, c.name AS class_name, j.semester_id, sm.name AS semester_name, \
             j.status, j.total, j.selesai, j.errors, j.error_message, j.created_by, u.name AS created_by_name, \
             j.created_at, j.finished_at \
             FROM report_jobs j \
             JOIN classes c ON c.id = j.class_id \
             JOIN semesters sm ON sm.id = j.semester_id \
             JOIN users u ON u.id = j.created_by \
             WHERE j.school_id = ? ORDER BY j.created_at DESC LIMIT 50",
        )
        .bind(user.school_id)
        .fetch_all(&st.pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT j.id, j.class_id, c.name AS class_name, j.semester_id, sm.name AS semester_name, \
             j.status, j.total, j.selesai, j.errors, j.error_message, j.created_by, u.name AS created_by_name, \
             j.created_at, j.finished_at \
             FROM report_jobs j \
             JOIN classes c ON c.id = j.class_id \
             JOIN semesters sm ON sm.id = j.semester_id \
             JOIN users u ON u.id = j.created_by \
             WHERE j.school_id = ? AND j.created_by = ? ORDER BY j.created_at DESC LIMIT 50",
        )
        .bind(user.school_id)
        .bind(user.user_id)
        .fetch_all(&st.pool)
        .await?
    };
    Ok(Json(rows))
}

/// Status satu job, termasuk progres dan siswa yang gagal.
pub async fn status(
    State(st): State<AppState>,
    user: AuthUser,
    AxPath(id): AxPath<Uuid>,
) -> AppResult<Json<JobRow>> {
    require_role(&user, ROLES)?;
    let job: JobRow = sqlx::query_as(
        "SELECT j.id, j.class_id, c.name AS class_name, j.semester_id, sm.name AS semester_name, \
         j.status, j.total, j.selesai, j.errors, j.error_message, j.created_by, u.name AS created_by_name, \
         j.created_at, j.finished_at \
         FROM report_jobs j \
         JOIN classes c ON c.id = j.class_id \
         JOIN semesters sm ON sm.id = j.semester_id \
         JOIN users u ON u.id = j.created_by \
         WHERE j.id = ? AND j.school_id = ?",
    )
        .bind(id)
        .bind(user.school_id)
        .fetch_optional(&st.pool)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_owner(&user, job.created_by)?;
    Ok(Json(job))
}

/// Unduh ZIP hasil. Hanya setelah job selesai.
pub async fn download(
    State(st): State<AppState>,
    user: AuthUser,
    AxPath(id): AxPath<Uuid>,
) -> AppResult<Response> {
    require_role(&user, ROLES)?;
    let (status, file_name, created_by): (String, Option<String>, Uuid) = sqlx::query_as(
        "SELECT status, file_path, created_by FROM report_jobs WHERE id = ? AND school_id = ?",
    )
    .bind(id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    ensure_owner(&user, created_by)?;

    if status != SELESAI {
        return Err(AppError::Conflict("hasil cetak belum siap".to_string()));
    }
    let file_name = file_name.ok_or(AppError::NotFound)?;
    let bytes = tokio::fs::read(zip_dir(&st.upload_dir, user.school_id).join(&file_name))
        .await
        .map_err(|_| AppError::NotFound)?;

    let filename = format!("rapor-massal-{}.zip", &id.simple().to_string()[..8]);
    Response::builder()
        .header(header::CONTENT_TYPE, HeaderValue::from_static("application/zip"))
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
                .map_err(|e| AppError::Internal(e.into()))?,
        )
        .body(Body::from(bytes))
        .map_err(|e| AppError::Internal(e.into()))
}
