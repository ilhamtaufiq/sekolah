use axum::{
    Json,
    extract::{Multipart, Path, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{FileView, load_files, room_scope, storage};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
    validate::Validator,
};

#[derive(Serialize)]
pub struct Material {
    pub id: Uuid,
    pub title: String,
    pub body: Option<String>,
    pub youtube_id: Option<String>,
    pub created_by_name: String,
    pub created_at: DateTime<Utc>,
    pub files: Vec<FileView>,
}

#[derive(FromRow)]
struct MaterialRow {
    id: Uuid,
    title: String,
    body: Option<String>,
    youtube_id: Option<String>,
    created_by_name: String,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct MaterialInput {
    pub title: String,
    pub body: Option<String>,
    /// Tautan YouTube. Jika diisi, materi menjadi video yang progres tontonnya dilacak.
    pub youtube_url: Option<String>,
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Path(room_id): Path<Uuid>,
) -> AppResult<Json<Vec<Material>>> {
    room_scope(&st.pool, &user, room_id).await?;
    let rows: Vec<MaterialRow> = sqlx::query_as(
        "SELECT m.id, m.title, m.body, m.youtube_id, u.name AS created_by_name, m.created_at \
         FROM lms_materials m JOIN users u ON u.id = m.created_by \
         WHERE m.assignment_id = ? AND m.school_id = ? ORDER BY m.created_at DESC",
    )
    .bind(room_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let files = load_files(&st.pool, "material", r.id).await?;
        out.push(Material {
            id: r.id,
            title: r.title,
            body: r.body,
            youtube_id: r.youtube_id,
            created_by_name: r.created_by_name,
            created_at: r.created_at,
            files,
        });
    }
    Ok(Json(out))
}

pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Path(room_id): Path<Uuid>,
    Json(input): Json<MaterialInput>,
) -> AppResult<Json<Material>> {
    let scope = room_scope(&st.pool, &user, room_id).await?;
    if !scope.manage {
        return Err(AppError::Forbidden);
    }

    let mut v = Validator::new();
    let title = v.text("title", &input.title, 1, 200);
    let body = v.opt_text("body", input.body.as_deref(), 20_000);
    let youtube_id = match input
        .youtube_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
    {
        Some(url) => match super::video::parse_youtube_id(url) {
            Some(id) => Some(id),
            None => {
                v.require(false, "youtube_url", "tautan YouTube tidak valid");
                None
            }
        },
        None => None,
    };
    v.finish()?;

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO lms_materials (id, school_id, assignment_id, title, body, created_by, youtube_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(room_id)
    .bind(&title)
    .bind(&body)
    .bind(user.user_id)
    .bind(&youtube_id)
    .execute(&st.pool)
    .await?;

    let created_at: DateTime<Utc> =
        sqlx::query_scalar("SELECT created_at FROM lms_materials WHERE id = ?")
            .bind(id)
            .fetch_one(&st.pool)
            .await?;
    let creator: String = sqlx::query_scalar("SELECT name FROM users WHERE id = ?")
        .bind(user.user_id)
        .fetch_one(&st.pool)
        .await?;
    Ok(Json(Material {
        id,
        title,
        body,
        youtube_id,
        created_by_name: creator,
        created_at,
        files: vec![],
    }))
}

/// Menghapus materi beserta berkasnya (baris dan file di disk).
pub async fn delete(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let room: Uuid = sqlx::query_scalar(
        "SELECT assignment_id FROM lms_materials WHERE id = ? AND school_id = ?",
    )
    .bind(id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    if !room_scope(&st.pool, &user, room).await?.manage {
        return Err(AppError::Forbidden);
    }

    let stored: Vec<String> = sqlx::query_scalar(
        "SELECT stored_name FROM lms_files WHERE owner_kind = 'material' AND owner_id = ?",
    )
    .bind(id)
    .fetch_all(&st.pool)
    .await?;

    let mut tx = st.pool.begin().await?;
    sqlx::query("DELETE FROM lms_files WHERE owner_kind = 'material' AND owner_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM lms_materials WHERE id = ? AND school_id = ?")
        .bind(id)
        .bind(user.school_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    for s in stored {
        storage::remove(&st.upload_dir, user.school_id, &s).await;
    }
    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// Mengunggah satu lampiran materi (field multipart bernama `file`).
pub async fn upload(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    mut multipart: Multipart,
) -> AppResult<Json<FileView>> {
    let room: Uuid = sqlx::query_scalar(
        "SELECT assignment_id FROM lms_materials WHERE id = ? AND school_id = ?",
    )
    .bind(id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    if !room_scope(&st.pool, &user, room).await?.manage {
        return Err(AppError::Forbidden);
    }

    let mut saved: Option<FileView> = None;
    while let Some(mut field) = multipart.next_field().await.map_err(storage::form_error)? {
        if field.name() != Some("file") {
            continue;
        }
        let raw_name = field.file_name().unwrap_or("").to_string();
        let bytes = storage::read_limited(&mut field).await?;
        let checked = storage::check(&raw_name, &bytes).map_err(storage::file_issue)?;

        let stored = storage::new_stored_name();
        storage::write(&st.upload_dir, user.school_id, &stored, &bytes).await?;
        let file_id = Uuid::new_v4();
        let insert = sqlx::query(
            "INSERT INTO lms_files (id, school_id, owner_kind, owner_id, file_name, stored_name, mime, size_bytes, uploaded_by) \
             VALUES (?, ?, 'material', ?, ?, ?, ?, ?, ?)",
        )
        .bind(file_id)
        .bind(user.school_id)
        .bind(id)
        .bind(&checked.display_name)
        .bind(&stored)
        .bind(checked.mime)
        .bind(bytes.len() as u64)
        .bind(user.user_id)
        .execute(&st.pool)
        .await;
        if let Err(e) = insert {
            storage::remove(&st.upload_dir, user.school_id, &stored).await;
            return Err(e.into());
        }
        saved = Some(FileView {
            id: file_id,
            file_name: checked.display_name,
            mime: checked.mime.to_string(),
            size_bytes: bytes.len() as u64,
        });
        break;
    }

    saved.map(Json).ok_or_else(|| {
        storage::file_issue("berkas wajib dilampirkan pada field 'file'".to_string())
    })
}
