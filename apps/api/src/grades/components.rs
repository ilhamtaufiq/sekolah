use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{READ_ROLES, ensure_manage, load_assignment, semester_range};
use crate::{
    auth::{AuthUser, require_role},
    error::{AppError, AppResult},
    state::AppState,
    validate::Validator,
};

#[derive(Serialize, FromRow)]
pub struct Component {
    pub id: Uuid,
    pub assignment_id: Uuid,
    pub semester_id: Uuid,
    pub name: String,
    pub weight: f64,
}

#[derive(Deserialize)]
pub struct ComponentFilter {
    pub assignment_id: Uuid,
    pub semester_id: Uuid,
}

#[derive(Deserialize)]
pub struct ComponentInput {
    pub assignment_id: Uuid,
    pub semester_id: Uuid,
    pub name: String,
    pub weight: f64,
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<ComponentFilter>,
) -> AppResult<Json<Vec<Component>>> {
    require_role(&user, READ_ROLES)?;
    let rows = sqlx::query_as(
        "SELECT id, assignment_id, semester_id, name, weight FROM grade_components \
         WHERE school_id = ? AND assignment_id = ? AND semester_id = ? ORDER BY name",
    )
    .bind(user.school_id)
    .bind(f.assignment_id)
    .bind(f.semester_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<ComponentInput>,
) -> AppResult<Json<Component>> {
    require_role(&user, READ_ROLES)?;
    let a = load_assignment(&st.pool, user.school_id, input.assignment_id).await?;
    ensure_manage(&user, &a)?;

    let mut v = Validator::new();
    let name = v.text("name", &input.name, 1, 60);
    v.require(
        input.weight > 0.0 && input.weight <= 100.0,
        "weight",
        "bobot harus lebih dari 0 dan maksimal 100",
    );
    v.finish()?;
    semester_range(
        &st.pool,
        user.school_id,
        input.semester_id,
        a.academic_year_id,
    )
    .await?;

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO grade_components (id, school_id, assignment_id, semester_id, name, weight) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(input.assignment_id)
    .bind(input.semester_id)
    .bind(&name)
    .bind(input.weight)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "nama komponen sudah dipakai di mapel ini"))?;

    Ok(Json(Component {
        id,
        assignment_id: input.assignment_id,
        semester_id: input.semester_id,
        name,
        weight: input.weight,
    }))
}

pub async fn delete(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, READ_ROLES)?;
    let assignment_id: Uuid = sqlx::query_scalar(
        "SELECT assignment_id FROM grade_components WHERE id = ? AND school_id = ?",
    )
    .bind(id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    let a = load_assignment(&st.pool, user.school_id, assignment_id).await?;
    ensure_manage(&user, &a)?;

    let has_entries: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM grade_entries WHERE component_id = ? LIMIT 1")
            .bind(id)
            .fetch_optional(&st.pool)
            .await?;
    if has_entries.is_some() {
        return Err(AppError::Conflict(
            "komponen sudah berisi nilai siswa dan tidak bisa dihapus".to_string(),
        ));
    }

    sqlx::query("DELETE FROM grade_components WHERE id = ? AND school_id = ?")
        .bind(id)
        .bind(user.school_id)
        .execute(&st.pool)
        .await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}
