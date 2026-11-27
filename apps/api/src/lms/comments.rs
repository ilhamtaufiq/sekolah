//! Forum diskusi per materi. Siswa dan guru di ruang kelas yang sama bisa berkomentar.
//!
//! Hak akses (mengikuti `room_scope`):
//! - Membaca dan menulis: siapa pun yang boleh membuka ruang itu.
//! - Menghapus: guru pengelola ruang (dan admin) bisa menghapus komentar siapa pun di
//!   ruangnya; pengguna lain hanya komentarnya sendiri.
//! - Balasan hanya satu tingkat: `parent_id` harus menunjuk komentar utama.

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlPool};
use uuid::Uuid;

use super::room_scope;
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
    validate::Validator,
};

/// Batas panjang isi komentar, dalam karakter.
const MAX_BODY_CHARS: usize = 2000;

#[derive(Serialize)]
pub struct Comment {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub author_user_id: Uuid,
    pub author_name: String,
    pub author_role: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
    /// Pengguna yang sedang melihat boleh menghapus komentar ini.
    pub can_delete: bool,
}

#[derive(FromRow)]
struct CommentRow {
    id: Uuid,
    parent_id: Option<Uuid>,
    author_user_id: Uuid,
    author_name: String,
    author_role: String,
    body: String,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct CommentInput {
    pub body: String,
    #[serde(default)]
    pub parent_id: Option<Uuid>,
}

/// Ruang kelas (penugasan) tempat sebuah materi berada. 404 jika materi tidak ada di sekolah ini.
async fn material_room(pool: &MySqlPool, school_id: Uuid, material_id: Uuid) -> AppResult<Uuid> {
    sqlx::query_scalar("SELECT assignment_id FROM lms_materials WHERE id = ? AND school_id = ?")
        .bind(material_id)
        .bind(school_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

async fn load_comment(pool: &MySqlPool, school_id: Uuid, id: Uuid) -> AppResult<CommentRow> {
    sqlx::query_as(
        "SELECT c.id, c.parent_id, c.author_user_id, u.name AS author_name, u.role AS author_role, \
                c.body, c.created_at \
         FROM lms_comments c JOIN users u ON u.id = c.author_user_id \
         WHERE c.id = ? AND c.school_id = ?",
    )
    .bind(id)
    .bind(school_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Daftar komentar satu materi, urut waktu. Klien menyusun balasan di bawah induknya.
pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Path(material_id): Path<Uuid>,
) -> AppResult<Json<Vec<Comment>>> {
    let room = material_room(&st.pool, user.school_id, material_id).await?;
    let scope = room_scope(&st.pool, &user, room).await?;

    let rows: Vec<CommentRow> = sqlx::query_as(
        "SELECT c.id, c.parent_id, c.author_user_id, u.name AS author_name, u.role AS author_role, \
                c.body, c.created_at \
         FROM lms_comments c JOIN users u ON u.id = c.author_user_id \
         WHERE c.material_id = ? AND c.school_id = ? ORDER BY c.created_at, c.id",
    )
    .bind(material_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;

    let out = rows
        .into_iter()
        .map(|r| Comment {
            can_delete: scope.manage || r.author_user_id == user.user_id,
            id: r.id,
            parent_id: r.parent_id,
            author_user_id: r.author_user_id,
            author_name: r.author_name,
            author_role: r.author_role,
            body: r.body,
            created_at: r.created_at,
        })
        .collect();
    Ok(Json(out))
}

/// Menambah komentar atau balasan. Isi kosong atau lebih dari 2000 karakter ditolak.
pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Path(material_id): Path<Uuid>,
    Json(input): Json<CommentInput>,
) -> AppResult<Json<Comment>> {
    let room = material_room(&st.pool, user.school_id, material_id).await?;
    room_scope(&st.pool, &user, room).await?;

    let mut v = Validator::new();
    let body = v.text("body", &input.body, 1, MAX_BODY_CHARS);
    v.finish()?;

    if let Some(parent) = input.parent_id {
        // Induk harus komentar di materi yang sama, dan harus komentar utama (bukan balasan).
        let parent_of: Option<Option<Uuid>> = sqlx::query_scalar(
            "SELECT parent_id FROM lms_comments WHERE id = ? AND material_id = ? AND school_id = ?",
        )
        .bind(parent)
        .bind(material_id)
        .bind(user.school_id)
        .fetch_optional(&st.pool)
        .await?;
        match parent_of {
            None => {
                return Err(AppError::Validation(vec![FieldIssue::new(
                    "parent_id",
                    "komentar induk tidak ditemukan pada materi ini",
                )]));
            }
            Some(Some(_)) => {
                return Err(AppError::Validation(vec![FieldIssue::new(
                    "parent_id",
                    "balasan hanya bisa dibuat untuk komentar utama",
                )]));
            }
            Some(None) => {}
        }
    }

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO lms_comments (id, school_id, material_id, author_user_id, parent_id, body) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(material_id)
    .bind(user.user_id)
    .bind(input.parent_id)
    .bind(&body)
    .execute(&st.pool)
    .await?;

    let row = load_comment(&st.pool, user.school_id, id).await?;
    Ok(Json(Comment {
        can_delete: true,
        id: row.id,
        parent_id: row.parent_id,
        author_user_id: row.author_user_id,
        author_name: row.author_name,
        author_role: row.author_role,
        body: row.body,
        created_at: row.created_at,
    }))
}

/// Menghapus komentar (beserta balasannya). Guru pengelola ruang boleh menghapus komentar siapa pun
/// di ruangnya; selain itu hanya komentar sendiri.
pub async fn delete(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let (material_id, author): (Uuid, Uuid) = sqlx::query_as(
        "SELECT material_id, author_user_id FROM lms_comments WHERE id = ? AND school_id = ?",
    )
    .bind(id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    if author != user.user_id {
        let room = material_room(&st.pool, user.school_id, material_id).await?;
        if !room_scope(&st.pool, &user, room).await?.manage {
            return Err(AppError::Forbidden);
        }
    }

    sqlx::query("DELETE FROM lms_comments WHERE id = ? AND school_id = ?")
        .bind(id)
        .bind(user.school_id)
        .execute(&st.pool)
        .await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}
