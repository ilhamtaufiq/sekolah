use axum::{
    Json,
    extract::{Path, State},
};
use chrono::NaiveDate;
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
pub struct AcademicYear {
    pub id: Uuid,
    pub name: String,
    pub starts_on: NaiveDate,
    pub ends_on: NaiveDate,
    pub is_active: bool,
}

#[derive(Deserialize)]
pub struct YearInput {
    pub name: String,
    pub starts_on: NaiveDate,
    pub ends_on: NaiveDate,
}

fn validate(input: &YearInput) -> AppResult<(String, NaiveDate, NaiveDate)> {
    let mut v = Validator::new();
    let name = v.text("name", &input.name, 4, 20);
    v.require(
        input.ends_on > input.starts_on,
        "ends_on",
        "tanggal selesai harus setelah tanggal mulai",
    );
    v.finish()?;
    Ok((name, input.starts_on, input.ends_on))
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Vec<AcademicYear>>> {
    require_role(&user, READ_ROLES)?;
    let rows = sqlx::query_as(
        "SELECT id, name, starts_on, ends_on, is_active FROM academic_years \
         WHERE school_id = ? ORDER BY starts_on DESC",
    )
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<YearInput>,
) -> AppResult<Json<AcademicYear>> {
    require_role(&user, MASTER_WRITE)?;
    let (name, starts_on, ends_on) = validate(&input)?;
    let id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO academic_years (id, school_id, name, starts_on, ends_on) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(&name)
    .bind(starts_on)
    .bind(ends_on)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "nama tahun ajaran sudah dipakai"))?;

    Ok(Json(AcademicYear {
        id,
        name,
        starts_on,
        ends_on,
        is_active: false,
    }))
}

pub async fn update(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<YearInput>,
) -> AppResult<Json<AcademicYear>> {
    require_role(&user, MASTER_WRITE)?;
    let (name, starts_on, ends_on) = validate(&input)?;

    let result = sqlx::query(
        "UPDATE academic_years SET name = ?, starts_on = ?, ends_on = ? WHERE id = ? AND school_id = ?",
    )
    .bind(&name)
    .bind(starts_on)
    .bind(ends_on)
    .bind(id)
    .bind(user.school_id)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "nama tahun ajaran sudah dipakai"))?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    let is_active: bool = sqlx::query_scalar("SELECT is_active FROM academic_years WHERE id = ?")
        .bind(id)
        .fetch_one(&st.pool)
        .await?;
    Ok(Json(AcademicYear {
        id,
        name,
        starts_on,
        ends_on,
        is_active,
    }))
}

/// Mengaktifkan satu tahun ajaran dan menonaktifkan yang lain, dalam satu transaksi.
pub async fn activate(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<AcademicYear>> {
    require_role(&user, MASTER_WRITE)?;

    let mut tx = st.pool.begin().await?;
    sqlx::query("SELECT id FROM schools WHERE id = ? FOR UPDATE")
        .bind(user.school_id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("UPDATE academic_years SET is_active = FALSE WHERE school_id = ?")
        .bind(user.school_id)
        .execute(&mut *tx)
        .await?;
    let result =
        sqlx::query("UPDATE academic_years SET is_active = TRUE WHERE id = ? AND school_id = ?")
            .bind(id)
            .bind(user.school_id)
            .execute(&mut *tx)
            .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    let year: AcademicYear = sqlx::query_as(
        "SELECT id, name, starts_on, ends_on, is_active FROM academic_years WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(year))
}
