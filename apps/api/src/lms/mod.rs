//! LMS (F4): ruang kelas per penugasan, materi, tugas, pengumpulan, dan pengumuman.
//!
//! Hak akses:
//! - Admin, guru pengampu, dan wali kelas kelas itu: mengelola ruang.
//! - Siswa yang terdaftar di kelas itu: membaca, dan mengumpulkan tugas miliknya sendiri.
//! - Lainnya: 403.

pub mod announcements;
pub mod materials;
pub mod storage;
pub mod tasks;

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use sqlx::{FromRow, MySqlPool};
use uuid::Uuid;

use crate::{
    auth::{AuthUser, Role},
    error::{AppError, AppResult},
    state::AppState,
};

/// Hasil pemeriksaan hak akses ke satu ruang kelas.
#[derive(Debug, Clone, Copy)]
pub struct Scope {
    /// Boleh mengelola (materi, tugas, nilai, pengumuman).
    pub manage: bool,
    /// Id siswa jika pengguna adalah siswa di kelas ini.
    pub student_id: Option<Uuid>,
}

/// Memeriksa hak akses ke ruang kelas (penugasan). 404 jika penugasan tidak ada di sekolah ini.
pub async fn room_scope(
    pool: &MySqlPool,
    user: &AuthUser,
    assignment_id: Uuid,
) -> AppResult<Scope> {
    let (class_id, teacher_id, homeroom): (Uuid, Uuid, Option<Uuid>) = sqlx::query_as(
        "SELECT a.class_id, a.teacher_id, c.homeroom_teacher_id \
         FROM teaching_assignments a JOIN classes c ON c.id = a.class_id \
         WHERE a.id = ? AND a.school_id = ?",
    )
    .bind(assignment_id)
    .bind(user.school_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;

    match user.role {
        Role::Admin => Ok(Scope {
            manage: true,
            student_id: None,
        }),
        Role::Guru | Role::WaliKelas
            if teacher_id == user.user_id || homeroom == Some(user.user_id) =>
        {
            Ok(Scope {
                manage: true,
                student_id: None,
            })
        }
        Role::Siswa => {
            let student_id: Option<Uuid> =
                sqlx::query_scalar("SELECT id FROM students WHERE user_id = ? AND school_id = ?")
                    .bind(user.user_id)
                    .bind(user.school_id)
                    .fetch_optional(pool)
                    .await?;
            let student_id = student_id.ok_or(AppError::Forbidden)?;
            let enrolled: Option<i64> = sqlx::query_scalar(
                "SELECT 1 FROM class_enrollments WHERE class_id = ? AND student_id = ? AND school_id = ?",
            )
            .bind(class_id)
            .bind(student_id)
            .bind(user.school_id)
            .fetch_optional(pool)
            .await?;
            if enrolled.is_some() {
                Ok(Scope {
                    manage: false,
                    student_id: Some(student_id),
                })
            } else {
                Err(AppError::Forbidden)
            }
        }
        _ => Err(AppError::Forbidden),
    }
}

/// Penugasan yang memuat sebuah tugas. 404 jika tidak ada di sekolah ini.
pub async fn task_assignment(pool: &MySqlPool, school_id: Uuid, task_id: Uuid) -> AppResult<Uuid> {
    sqlx::query_scalar("SELECT assignment_id FROM lms_tasks WHERE id = ? AND school_id = ?")
        .bind(task_id)
        .bind(school_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

#[derive(Serialize, FromRow)]
pub struct Room {
    pub id: Uuid,
    pub class_name: String,
    pub subject_name: String,
    pub teacher_name: String,
}

/// Daftar ruang kelas yang bisa diakses pengguna di tahun ajaran aktif.
pub async fn rooms(State(st): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<Room>>> {
    let rows: Vec<Room> =
        match user.role {
            Role::Admin => sqlx::query_as(
                "SELECT a.id, c.name AS class_name, s.name AS subject_name, u.name AS teacher_name \
             FROM teaching_assignments a \
             JOIN classes c ON c.id = a.class_id \
             JOIN subjects s ON s.id = a.subject_id \
             JOIN users u ON u.id = a.teacher_id \
             JOIN academic_years y ON y.id = a.academic_year_id \
             WHERE a.school_id = ? AND y.is_active = TRUE ORDER BY c.name, s.name",
            )
            .bind(user.school_id)
            .fetch_all(&st.pool)
            .await?,
            Role::Guru | Role::WaliKelas => sqlx::query_as(
                "SELECT a.id, c.name AS class_name, s.name AS subject_name, u.name AS teacher_name \
             FROM teaching_assignments a \
             JOIN classes c ON c.id = a.class_id \
             JOIN subjects s ON s.id = a.subject_id \
             JOIN users u ON u.id = a.teacher_id \
             JOIN academic_years y ON y.id = a.academic_year_id \
             WHERE a.school_id = ? AND y.is_active = TRUE \
               AND (a.teacher_id = ? OR c.homeroom_teacher_id = ?) \
             ORDER BY c.name, s.name",
            )
            .bind(user.school_id)
            .bind(user.user_id)
            .bind(user.user_id)
            .fetch_all(&st.pool)
            .await?,
            Role::Siswa => sqlx::query_as(
                "SELECT a.id, c.name AS class_name, s.name AS subject_name, u.name AS teacher_name \
             FROM teaching_assignments a \
             JOIN classes c ON c.id = a.class_id \
             JOIN subjects s ON s.id = a.subject_id \
             JOIN users u ON u.id = a.teacher_id \
             JOIN academic_years y ON y.id = a.academic_year_id \
             JOIN class_enrollments e ON e.class_id = a.class_id \
             JOIN students st ON st.id = e.student_id AND st.user_id = ? \
             WHERE a.school_id = ? AND y.is_active = TRUE \
             ORDER BY c.name, s.name",
            )
            .bind(user.user_id)
            .bind(user.school_id)
            .fetch_all(&st.pool)
            .await?,
            Role::KepalaSekolah | Role::OrangTua => return Err(AppError::Forbidden),
        };
    Ok(Json(rows))
}

#[derive(Serialize, FromRow)]
pub struct FileView {
    pub id: Uuid,
    pub file_name: String,
    pub mime: String,
    pub size_bytes: u64,
}

/// Berkas milik satu pemilik (materi atau pengumpulan).
pub async fn load_files(pool: &MySqlPool, kind: &str, owner_id: Uuid) -> AppResult<Vec<FileView>> {
    Ok(sqlx::query_as(
        "SELECT id, file_name, mime, size_bytes FROM lms_files \
         WHERE owner_kind = ? AND owner_id = ? ORDER BY created_at",
    )
    .bind(kind)
    .bind(owner_id)
    .fetch_all(pool)
    .await?)
}

/// Unduhan berkas. Hak akses dicek dari pemilik berkas, bukan dari URL.
pub async fn download(
    State(st): State<AppState>,
    user: AuthUser,
    Path(file_id): Path<Uuid>,
) -> AppResult<Response> {
    let (kind, owner_id, file_name, mime, stored): (String, Uuid, String, String, String) = sqlx::query_as(
        "SELECT owner_kind, owner_id, file_name, mime, stored_name FROM lms_files WHERE id = ? AND school_id = ?",
    )
    .bind(file_id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let (assignment_id, owner_student): (Uuid, Option<Uuid>) = if kind == "material" {
        let a: Uuid = sqlx::query_scalar("SELECT assignment_id FROM lms_materials WHERE id = ?")
            .bind(owner_id)
            .fetch_optional(&st.pool)
            .await?
            .ok_or(AppError::NotFound)?;
        (a, None)
    } else {
        let (a, sid): (Uuid, Uuid) = sqlx::query_as(
            "SELECT t.assignment_id, s.student_id FROM lms_submissions s \
             JOIN lms_tasks t ON t.id = s.task_id WHERE s.id = ?",
        )
        .bind(owner_id)
        .fetch_optional(&st.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        (a, Some(sid))
    };

    let scope = room_scope(&st.pool, &user, assignment_id).await?;
    if let Some(owner) = owner_student
        && !scope.manage
        && scope.student_id != Some(owner)
    {
        return Err(AppError::Forbidden);
    }

    let bytes = storage::read(&st.upload_dir, user.school_id, &stored).await?;
    let disposition = format!(
        "attachment; filename=\"{}\"",
        storage::ascii_name(&file_name)
    );
    let mut resp = bytes.into_response();
    let headers = resp.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition).unwrap_or(HeaderValue::from_static("attachment")),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    Ok(resp)
}
