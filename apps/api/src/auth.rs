use anyhow::anyhow;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    Json,
    extract::{FromRequestParts, State},
    http::{header::AUTHORIZATION, request::Parts},
};
use chrono::Utc;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Admin,
    KepalaSekolah,
    Guru,
    WaliKelas,
    Siswa,
    OrangTua,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::KepalaSekolah => "kepala_sekolah",
            Role::Guru => "guru",
            Role::WaliKelas => "wali_kelas",
            Role::Siswa => "siswa",
            Role::OrangTua => "orang_tua",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "admin" => Role::Admin,
            "kepala_sekolah" => Role::KepalaSekolah,
            "guru" => Role::Guru,
            "wali_kelas" => Role::WaliKelas,
            "siswa" => Role::Siswa,
            "orang_tua" => Role::OrangTua,
            _ => return None,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub sch: Uuid,
    pub role: String,
    pub iat: u64,
    pub exp: u64,
}

pub struct JwtKeys {
    enc: EncodingKey,
    dec: DecodingKey,
}

impl JwtKeys {
    pub fn new(secret: &str) -> anyhow::Result<Self> {
        Ok(Self {
            enc: EncodingKey::from_secret(secret.as_bytes()).map_err(anyhow::Error::from)?,
            dec: DecodingKey::from_secret(secret.as_bytes()).map_err(anyhow::Error::from)?,
        })
    }

    pub fn issue(
        &self,
        user_id: Uuid,
        school_id: Uuid,
        role: Role,
        ttl_hours: i64,
    ) -> AppResult<String> {
        let now = Utc::now().timestamp();
        let claims = Claims {
            sub: user_id,
            sch: school_id,
            role: role.as_str().to_string(),
            iat: now as u64,
            exp: (now + ttl_hours * 3600) as u64,
        };
        encode(&Header::default(), &claims, &self.enc).map_err(|e| AppError::Internal(e.into()))
    }

    pub fn verify(&self, token: &str) -> AppResult<Claims> {
        decode::<Claims>(token, &self.dec, &Validation::default())
            .map(|d| d.claims)
            .map_err(|_| AppError::Unauthorized)
    }
}

/// Identitas pengguna terautentikasi. `school_id` selalu berasal dari token,
/// tidak pernah dari body atau query, sehingga tenant tidak bisa ditebak dari klien.
#[derive(Debug, Clone, Copy)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub school_id: Uuid,
    pub role: Role,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::Unauthorized)?;
        let token = header
            .strip_prefix("Bearer ")
            .ok_or(AppError::Unauthorized)?;

        let claims = state.keys.verify(token)?;
        let role = Role::parse(&claims.role).ok_or(AppError::Unauthorized)?;

        Ok(AuthUser {
            user_id: claims.sub,
            school_id: claims.sch,
            role,
        })
    }
}

pub fn require_role(user: &AuthUser, allowed: &[Role]) -> AppResult<()> {
    if allowed.contains(&user.role) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

pub fn hash_password(password: &str) -> anyhow::Result<String> {
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|h| h.to_string())
        .map_err(|e| anyhow!("gagal hash password: {e}"))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

// ---------- Handler ----------

#[derive(Deserialize)]
pub struct LoginRequest {
    pub school_slug: String,
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct MeResponse {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub role: String,
    pub school_id: Uuid,
    pub school_name: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: MeResponse,
}

#[derive(FromRow)]
struct LoginRow {
    id: Uuid,
    school_id: Uuid,
    name: String,
    email: String,
    password_hash: String,
    role: String,
    is_active: bool,
    school_name: String,
}

pub async fn login(
    State(st): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<LoginResponse>> {
    let row: Option<LoginRow> = sqlx::query_as(
        "SELECT u.id, u.school_id, u.name, u.email, u.password_hash, u.role, u.is_active, \
                s.name AS school_name \
         FROM users u JOIN schools s ON s.id = u.school_id \
         WHERE s.slug = $1 AND lower(u.email) = lower($2)",
    )
    .bind(req.school_slug.trim().to_lowercase())
    .bind(req.email.trim())
    .fetch_optional(&st.pool)
    .await?;

    // Pesan gagal dibuat seragam supaya tidak membocorkan email mana yang terdaftar.
    let row = row.ok_or(AppError::Unauthorized)?;
    if !row.is_active || !verify_password(&req.password, &row.password_hash) {
        return Err(AppError::Unauthorized);
    }

    let role = Role::parse(&row.role)
        .ok_or_else(|| AppError::Internal(anyhow!("role tersimpan tidak dikenal: {}", row.role)))?;
    let token = st
        .keys
        .issue(row.id, row.school_id, role, st.jwt_ttl_hours)?;

    Ok(Json(LoginResponse {
        token,
        user: MeResponse {
            id: row.id,
            name: row.name,
            email: row.email,
            role: role.as_str().to_string(),
            school_id: row.school_id,
            school_name: row.school_name,
        },
    }))
}

#[derive(FromRow)]
struct MeRow {
    id: Uuid,
    name: String,
    email: String,
    role: String,
    school_id: Uuid,
    school_name: String,
}

pub async fn me(State(st): State<AppState>, user: AuthUser) -> AppResult<Json<MeResponse>> {
    let row: MeRow = sqlx::query_as(
        "SELECT u.id, u.name, u.email, u.role, u.school_id, s.name AS school_name \
         FROM users u JOIN schools s ON s.id = u.school_id \
         WHERE u.id = $1 AND u.school_id = $2 AND u.is_active",
    )
    .bind(user.user_id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    Ok(Json(MeResponse {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        school_id: row.school_id,
        school_name: row.school_name,
    }))
}
