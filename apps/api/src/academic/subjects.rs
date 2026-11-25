use axum::{
    Json,
    extract::{Path, State},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{MASTER_WRITE, READ_ROLES};
use crate::{
    auth::{AuthUser, require_role},
    error::{AppError, AppResult},
    state::AppState,
    validate::Validator,
};

#[derive(Serialize, FromRow)]
pub struct Subject {
    pub id: Uuid,
    pub code: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct SubjectInput {
    pub code: String,
    pub name: String,
}

fn validate(input: &SubjectInput) -> AppResult<(String, String)> {
    let mut v = Validator::new();
    let code = v.text("code", &input.code, 1, 20).to_uppercase();
    let name = v.text("name", &input.name, 2, 120);
    v.finish()?;
    Ok((code, name))
}

pub async fn list(State(st): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<Subject>>> {
    require_role(&user, READ_ROLES)?;
    let rows =
        sqlx::query_as("SELECT id, code, name FROM subjects WHERE school_id = ? ORDER BY name")
            .bind(user.school_id)
            .fetch_all(&st.pool)
            .await?;
    Ok(Json(rows))
}

pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<SubjectInput>,
) -> AppResult<Json<Subject>> {
    require_role(&user, MASTER_WRITE)?;
    let (code, name) = validate(&input)?;
    let id = Uuid::new_v4();

    sqlx::query("INSERT INTO subjects (id, school_id, code, name) VALUES (?, ?, ?, ?)")
        .bind(id)
        .bind(user.school_id)
        .bind(&code)
        .bind(&name)
        .execute(&st.pool)
        .await
        .map_err(|e| AppError::from_db(e, "kode mapel sudah dipakai"))?;

    Ok(Json(Subject { id, code, name }))
}

pub async fn update(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<SubjectInput>,
) -> AppResult<Json<Subject>> {
    require_role(&user, MASTER_WRITE)?;
    let (code, name) = validate(&input)?;

    let result =
        sqlx::query("UPDATE subjects SET code = ?, name = ? WHERE id = ? AND school_id = ?")
            .bind(&code)
            .bind(&name)
            .bind(id)
            .bind(user.school_id)
            .execute(&st.pool)
            .await
            .map_err(|e| AppError::from_db(e, "kode mapel sudah dipakai"))?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(Subject { id, code, name }))
}
