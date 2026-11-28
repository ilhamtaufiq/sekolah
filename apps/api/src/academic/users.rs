//! Pengelolaan akun pengguna sekolah oleh admin: staf, siswa, dan orang tua.
//! Peran staf bisa diubah; akun siswa dan orang tua hanya bisa diganti nama, diaktifkan, atau direset password.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{MASTER_WRITE, READ_ROLES};
use crate::{
    auth::{AuthUser, hash_password, require_role},
    error::{AppError, AppResult},
    state::AppState,
    validate::Validator,
};

/// Peran yang bisa dibuat dari menu pengguna. Akun siswa dan orang tua dibuat dari menu siswa.
const STAFF_ROLES: &[&str] = &["admin", "kepala_sekolah", "guru", "wali_kelas"];

#[derive(Serialize, FromRow)]
pub struct StaffUser {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub role: String,
    pub is_active: bool,
}

#[derive(Deserialize)]
pub struct UserFilter {
    pub role: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateUser {
    pub name: String,
    pub email: String,
    pub password: String,
    pub role: String,
}

#[derive(Deserialize)]
pub struct UpdateUser {
    pub name: String,
    pub role: String,
    pub is_active: bool,
    /// Kosong = password tidak berubah.
    pub password: Option<String>,
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Query(filter): Query<UserFilter>,
) -> AppResult<Json<Vec<StaffUser>>> {
    require_role(&user, READ_ROLES)?;
    let rows = sqlx::query_as(
        "SELECT id, name, email, role, is_active FROM users \
         WHERE school_id = ? \
           AND role IN ('admin', 'kepala_sekolah', 'guru', 'wali_kelas', 'siswa', 'orang_tua') \
           AND (? IS NULL OR role = ?) \
         ORDER BY role, name",
    )
    .bind(user.school_id)
    .bind(&filter.role)
    .bind(&filter.role)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

fn validate_role(v: &mut Validator, role: &str) -> String {
    let role = role.trim().to_string();
    v.require(
        STAFF_ROLES.contains(&role.as_str()),
        "role",
        "peran tidak dikenal untuk akun staf",
    );
    role
}

pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<CreateUser>,
) -> AppResult<Json<StaffUser>> {
    require_role(&user, MASTER_WRITE)?;

    let mut v = Validator::new();
    let name = v.text("name", &input.name, 2, 200);
    let email = v.text("email", &input.email, 5, 255).to_lowercase();
    v.require(email.contains('@'), "email", "format email tidak valid");
    v.require(
        input.password.chars().count() >= 8,
        "password",
        "minimal 8 karakter",
    );
    let role = validate_role(&mut v, &input.role);
    v.finish()?;

    let id = Uuid::new_v4();
    let hash = hash_password(&input.password).map_err(AppError::Internal)?;
    sqlx::query(
        "INSERT INTO users (id, school_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(&email)
    .bind(&name)
    .bind(&hash)
    .bind(&role)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "email sudah terdaftar di sekolah ini"))?;

    Ok(Json(StaffUser {
        id,
        name,
        email,
        role,
        is_active: true,
    }))
}

pub async fn update(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateUser>,
) -> AppResult<Json<StaffUser>> {
    require_role(&user, MASTER_WRITE)?;

    // Peran akun saat ini menentukan batas perubahan peran.
    let current_role: Option<String> =
        sqlx::query_scalar("SELECT role FROM users WHERE id = ? AND school_id = ?")
            .bind(id)
            .bind(user.school_id)
            .fetch_optional(&st.pool)
            .await?;
    let current_role = current_role.ok_or(AppError::NotFound)?;

    let mut v = Validator::new();
    let name = v.text("name", &input.name, 2, 200);
    let role = if matches!(current_role.as_str(), "siswa" | "orang_tua") {
        v.require(
            input.role == current_role,
            "role",
            "peran akun siswa dan orang tua tidak bisa diubah dari menu ini",
        );
        current_role.clone()
    } else {
        validate_role(&mut v, &input.role)
    };
    if let Some(pw) = &input.password {
        v.require(pw.chars().count() >= 8, "password", "minimal 8 karakter");
    }
    // Admin tidak boleh mengunci dirinya sendiri keluar dari sistem.
    if id == user.user_id {
        v.require(
            role == "admin",
            "role",
            "anda tidak bisa menurunkan peran sendiri",
        );
        v.require(
            input.is_active,
            "is_active",
            "anda tidak bisa menonaktifkan akun sendiri",
        );
    }
    v.finish()?;

    let result = if let Some(pw) = &input.password {
        let hash = hash_password(pw).map_err(AppError::Internal)?;
        sqlx::query(
            "UPDATE users SET name = ?, role = ?, is_active = ?, password_hash = ? WHERE id = ? AND school_id = ?",
        )
        .bind(&name)
        .bind(&role)
        .bind(input.is_active)
        .bind(&hash)
        .bind(id)
        .bind(user.school_id)
        .execute(&st.pool)
        .await?
    } else {
        sqlx::query(
            "UPDATE users SET name = ?, role = ?, is_active = ? WHERE id = ? AND school_id = ?",
        )
        .bind(&name)
        .bind(&role)
        .bind(input.is_active)
        .bind(id)
        .bind(user.school_id)
        .execute(&st.pool)
        .await?
    };
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = ?")
        .bind(id)
        .fetch_one(&st.pool)
        .await?;
    Ok(Json(StaffUser {
        id,
        name,
        email,
        role,
        is_active: input.is_active,
    }))
}
