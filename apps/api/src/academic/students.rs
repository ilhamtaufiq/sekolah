use axum::{
    Json,
    extract::{Path, Query, State},
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

const STATUSES: &[&str] = &["aktif", "lulus", "pindah", "keluar"];

#[derive(Serialize, FromRow)]
pub struct Student {
    pub id: Uuid,
    pub nis: String,
    pub nisn: Option<String>,
    pub name: String,
    pub gender: Option<String>,
    pub birth_date: Option<NaiveDate>,
    pub status: String,
}

#[derive(Deserialize)]
pub struct StudentFilter {
    pub q: Option<String>,
    pub status: Option<String>,
}

#[derive(Deserialize)]
pub struct StudentInput {
    pub nis: String,
    pub nisn: Option<String>,
    pub name: String,
    pub gender: Option<String>,
    pub birth_date: Option<NaiveDate>,
    pub status: String,
}

struct Clean {
    nis: String,
    nisn: Option<String>,
    name: String,
    gender: Option<String>,
    status: String,
}

fn validate(input: &StudentInput) -> AppResult<Clean> {
    let mut v = Validator::new();
    let nis = v.text("nis", &input.nis, 1, 20);
    let nisn = v.opt_text("nisn", input.nisn.as_deref(), 20);
    let name = v.text("name", &input.name, 2, 200);
    let gender = input
        .gender
        .as_deref()
        .map(str::trim)
        .filter(|g| !g.is_empty())
        .map(str::to_uppercase);
    if let Some(g) = &gender {
        v.require(g == "L" || g == "P", "gender", "isi L atau P");
    }
    let status = input.status.trim().to_string();
    v.require(
        STATUSES.contains(&status.as_str()),
        "status",
        "status tidak dikenal",
    );
    v.finish()?;
    Ok(Clean {
        nis,
        nisn,
        name,
        gender,
        status,
    })
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Query(filter): Query<StudentFilter>,
) -> AppResult<Json<Vec<Student>>> {
    require_role(&user, READ_ROLES)?;
    let pattern = filter
        .q
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(|q| format!("%{q}%"));

    let rows = sqlx::query_as(
        "SELECT id, nis, nisn, name, gender, birth_date, status FROM students \
         WHERE school_id = ? \
           AND (? IS NULL OR name LIKE ? OR nis LIKE ?) \
           AND (? IS NULL OR status = ?) \
         ORDER BY name \
         LIMIT 500",
    )
    .bind(user.school_id)
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .bind(&filter.status)
    .bind(&filter.status)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<StudentInput>,
) -> AppResult<Json<Student>> {
    require_role(&user, MASTER_WRITE)?;
    let c = validate(&input)?;
    let id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO students (id, school_id, nis, nisn, name, gender, birth_date, status) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(&c.nis)
    .bind(&c.nisn)
    .bind(&c.name)
    .bind(&c.gender)
    .bind(input.birth_date)
    .bind(&c.status)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "NIS sudah terdaftar di sekolah ini"))?;

    Ok(Json(Student {
        id,
        nis: c.nis,
        nisn: c.nisn,
        name: c.name,
        gender: c.gender,
        birth_date: input.birth_date,
        status: c.status,
    }))
}

pub async fn update(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<StudentInput>,
) -> AppResult<Json<Student>> {
    require_role(&user, MASTER_WRITE)?;
    let c = validate(&input)?;

    let result = sqlx::query(
        "UPDATE students SET nis = ?, nisn = ?, name = ?, gender = ?, birth_date = ?, status = ? \
         WHERE id = ? AND school_id = ?",
    )
    .bind(&c.nis)
    .bind(&c.nisn)
    .bind(&c.name)
    .bind(&c.gender)
    .bind(input.birth_date)
    .bind(&c.status)
    .bind(id)
    .bind(user.school_id)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "NIS sudah terdaftar di sekolah ini"))?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(Json(Student {
        id,
        nis: c.nis,
        nisn: c.nisn,
        name: c.name,
        gender: c.gender,
        birth_date: input.birth_date,
        status: c.status,
    }))
}

#[derive(Deserialize)]
pub struct AccountInput {
    pub email: String,
    pub password: String,
}

/// Membuat akun login siswa. Hanya admin. Satu siswa paling banyak satu akun.
pub async fn create_account(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<AccountInput>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, MASTER_WRITE)?;

    let mut v = Validator::new();
    let email = v.text("email", &input.email, 5, 255).to_lowercase();
    v.require(email.contains('@'), "email", "format email tidak valid");
    v.require(
        input.password.chars().count() >= 8,
        "password",
        "minimal 8 karakter",
    );
    v.finish()?;

    let (name, existing): (String, Option<Uuid>) =
        sqlx::query_as("SELECT name, user_id FROM students WHERE id = ? AND school_id = ?")
            .bind(id)
            .bind(user.school_id)
            .fetch_optional(&st.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    if existing.is_some() {
        return Err(AppError::Conflict("siswa ini sudah punya akun".to_string()));
    }

    let account_id = Uuid::new_v4();
    let hash = crate::auth::hash_password(&input.password).map_err(AppError::Internal)?;
    let mut tx = st.pool.begin().await?;
    sqlx::query(
        "INSERT INTO users (id, school_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, 'siswa')",
    )
    .bind(account_id)
    .bind(user.school_id)
    .bind(&email)
    .bind(&name)
    .bind(&hash)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::from_db(e, "email sudah terdaftar di sekolah ini"))?;
    sqlx::query("UPDATE students SET user_id = ? WHERE id = ? AND school_id = ?")
        .bind(account_id)
        .bind(id)
        .bind(user.school_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Json(
        serde_json::json!({ "user_id": account_id, "email": email }),
    ))
}
