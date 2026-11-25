use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::room_scope;
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
    validate::Validator,
};

#[derive(Serialize, FromRow)]
pub struct Announcement {
    pub id: Uuid,
    pub title: String,
    pub body: String,
    pub created_by_name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct AnnouncementInput {
    pub title: String,
    pub body: String,
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Path(room_id): Path<Uuid>,
) -> AppResult<Json<Vec<Announcement>>> {
    room_scope(&st.pool, &user, room_id).await?;
    let rows = sqlx::query_as(
        "SELECT a.id, a.title, a.body, u.name AS created_by_name, a.created_at \
         FROM lms_announcements a JOIN users u ON u.id = a.created_by \
         WHERE a.assignment_id = ? AND a.school_id = ? ORDER BY a.created_at DESC",
    )
    .bind(room_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Path(room_id): Path<Uuid>,
    Json(input): Json<AnnouncementInput>,
) -> AppResult<Json<Announcement>> {
    if !room_scope(&st.pool, &user, room_id).await?.manage {
        return Err(AppError::Forbidden);
    }
    let mut v = Validator::new();
    let title = v.text("title", &input.title, 1, 200);
    let body = v.text("body", &input.body, 1, 10_000);
    v.finish()?;

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO lms_announcements (id, school_id, assignment_id, title, body, created_by) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(room_id)
    .bind(&title)
    .bind(&body)
    .bind(user.user_id)
    .execute(&st.pool)
    .await?;

    let row: Announcement = sqlx::query_as(
        "SELECT a.id, a.title, a.body, u.name AS created_by_name, a.created_at \
         FROM lms_announcements a JOIN users u ON u.id = a.created_by WHERE a.id = ?",
    )
    .bind(id)
    .fetch_one(&st.pool)
    .await?;
    Ok(Json(row))
}
