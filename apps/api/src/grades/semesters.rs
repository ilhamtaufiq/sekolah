use axum::{
    Json,
    extract::{Query, State},
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::READ_ROLES;
use crate::{
    academic::active_year_id,
    auth::{AuthUser, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
    validate::Validator,
};

#[derive(Serialize, FromRow)]
pub struct Semester {
    pub id: Uuid,
    pub academic_year_id: Uuid,
    pub ordinal: u8,
    pub name: String,
    pub starts_on: NaiveDate,
    pub ends_on: NaiveDate,
}

#[derive(Deserialize)]
pub struct SemesterFilter {
    pub academic_year_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct SemesterInput {
    /// Kosong = tahun ajaran aktif.
    pub academic_year_id: Option<Uuid>,
    pub ordinal: u8,
    pub starts_on: NaiveDate,
    pub ends_on: NaiveDate,
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<SemesterFilter>,
) -> AppResult<Json<Vec<Semester>>> {
    require_role(&user, READ_ROLES)?;
    let rows = sqlx::query_as(
        "SELECT id, academic_year_id, ordinal, name, starts_on, ends_on FROM semesters \
         WHERE school_id = ? AND academic_year_id = COALESCE(?, \
               (SELECT id FROM academic_years WHERE school_id = ? AND is_active = TRUE)) \
         ORDER BY ordinal",
    )
    .bind(user.school_id)
    .bind(f.academic_year_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<SemesterInput>,
) -> AppResult<Json<Semester>> {
    require_role(&user, &[crate::auth::Role::Admin])?;

    let mut v = Validator::new();
    v.require(
        input.ordinal == 1 || input.ordinal == 2,
        "ordinal",
        "semester harus 1 (ganjil) atau 2 (genap)",
    );
    v.require(
        input.ends_on > input.starts_on,
        "ends_on",
        "tanggal selesai harus setelah tanggal mulai",
    );
    v.finish()?;

    let year = match input.academic_year_id {
        Some(id) => id,
        None => active_year_id(&st.pool, user.school_id)
            .await?
            .ok_or_else(|| {
                AppError::Validation(vec![FieldIssue::new(
                    "academic_year_id",
                    "belum ada tahun ajaran aktif",
                )])
            })?,
    };
    let (year_starts, year_ends): (NaiveDate, NaiveDate) = sqlx::query_as(
        "SELECT starts_on, ends_on FROM academic_years WHERE id = ? AND school_id = ?",
    )
    .bind(year)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| {
        AppError::Validation(vec![FieldIssue::new(
            "academic_year_id",
            "tahun ajaran tidak ditemukan",
        )])
    })?;
    if input.starts_on < year_starts || input.ends_on > year_ends {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "starts_on",
            "rentang semester harus berada di dalam tahun ajaran",
        )]));
    }

    let id = Uuid::new_v4();
    let name = if input.ordinal == 1 {
        "Ganjil"
    } else {
        "Genap"
    };
    sqlx::query(
        "INSERT INTO semesters (id, school_id, academic_year_id, ordinal, name, starts_on, ends_on) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(year)
    .bind(input.ordinal)
    .bind(name)
    .bind(input.starts_on)
    .bind(input.ends_on)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "semester ini sudah ada di tahun ajaran tersebut"))?;

    Ok(Json(Semester {
        id,
        academic_year_id: year,
        ordinal: input.ordinal,
        name: name.to_string(),
        starts_on: input.starts_on,
        ends_on: input.ends_on,
    }))
}
