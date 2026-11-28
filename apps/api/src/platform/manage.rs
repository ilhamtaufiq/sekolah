//! Manajemen sekolah oleh super admin platform. Setiap aksi yang mengubah data
//! ditulis dalam satu transaksi bersama catatan audit-nya.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, MySqlConnection};
use uuid::Uuid;

use crate::{
    auth::{PlatformUser, Role, hash_password},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
};

const ROLE_ADMIN: &str = "admin";

/// Mencatat satu aksi ke jejak audit, dalam transaksi yang sama.
pub async fn audit(
    conn: &mut MySqlConnection,
    actor: Uuid,
    action: &str,
    school: Option<Uuid>,
    detail: serde_json::Value,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO platform_audit_logs (id, actor_id, action, school_id, detail) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4())
    .bind(actor)
    .bind(action)
    .bind(school)
    .bind(detail.to_string())
    .execute(conn)
    .await?;
    Ok(())
}

fn valid_slug(slug: &str) -> bool {
    slug.len() >= 3
        && slug.len() <= 40
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn issue(field: &str, message: &str) -> AppError {
    AppError::Validation(vec![FieldIssue::new(field, message)])
}

fn check_email(email: &str) -> AppResult<String> {
    let e = email.trim().to_lowercase();
    if e.len() < 5 || !e.contains('@') || e.len() > 190 {
        return Err(issue("email", "format email tidak valid"));
    }
    Ok(e)
}

fn check_password(password: &str) -> AppResult<()> {
    if password.chars().count() < 8 {
        return Err(issue("password", "password minimal 8 karakter"));
    }
    Ok(())
}

fn check_name(name: &str, field: &str) -> AppResult<String> {
    let n = name.trim().to_string();
    if n.is_empty() || n.chars().count() > 200 {
        return Err(issue(field, "1–200 karakter"));
    }
    Ok(n)
}

async fn school_exists(conn: &mut MySqlConnection, id: Uuid) -> AppResult<String> {
    sqlx::query_scalar("SELECT slug FROM schools WHERE id = ?")
        .bind(id)
        .fetch_optional(conn)
        .await?
        .ok_or(AppError::NotFound)
}

// ---------- Buat sekolah ----------

#[derive(Deserialize)]
pub struct CreateSchoolInput {
    pub slug: String,
    pub name: String,
    pub admin_name: String,
    pub admin_email: String,
    pub admin_password: String,
}

#[derive(Serialize)]
pub struct CreatedSchool {
    pub id: Uuid,
    pub slug: String,
}

pub async fn create_school(
    State(st): State<AppState>,
    actor: PlatformUser,
    Json(input): Json<CreateSchoolInput>,
) -> AppResult<(StatusCode, Json<CreatedSchool>)> {
    let slug = input.slug.trim().to_lowercase();
    if !valid_slug(&slug) {
        return Err(issue("slug", "3–40 karakter: huruf kecil, angka, atau '-'"));
    }
    let name = check_name(&input.name, "name")?;
    let admin_name = check_name(&input.admin_name, "admin_name")?;
    let admin_email = check_email(&input.admin_email)?;
    check_password(&input.admin_password)?;
    let hash = hash_password(&input.admin_password).map_err(AppError::Internal)?;

    let id = Uuid::new_v4();
    let mut tx = st.pool.begin().await?;
    sqlx::query("INSERT INTO schools (id, slug, name) VALUES (?, ?, ?)")
        .bind(id)
        .bind(&slug)
        .bind(&name)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::from_db(e, "slug sekolah sudah dipakai"))?;
    sqlx::query(
        "INSERT INTO users (id, school_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4())
    .bind(id)
    .bind(&admin_email)
    .bind(&admin_name)
    .bind(&hash)
    .bind(ROLE_ADMIN)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::from_db(e, "email admin sudah dipakai di sekolah ini"))?;
    audit(&mut tx, actor.user_id, "school.create", Some(id), json!({ "slug": slug, "name": name, "admin_email": admin_email })).await?;
    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(CreatedSchool { id, slug })))
}

// ---------- Detail sekolah ----------

#[derive(Serialize, FromRow)]
pub struct SchoolRecord {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
pub struct UserRecord {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub role: String,
    pub is_active: bool,
}

#[derive(Serialize)]
pub struct SchoolDetail {
    #[serde(flatten)]
    pub school: SchoolRecord,
    pub summary: SchoolSummaryCounts,
    pub users: Vec<UserRecord>,
}

#[derive(Serialize, FromRow)]
pub struct SchoolSummaryCounts {
    pub admins: i64,
    pub teachers: i64,
    pub students: i64,
    pub classes: i64,
}

pub async fn detail(
    State(st): State<AppState>,
    _actor: PlatformUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<SchoolDetail>> {
    let school: SchoolRecord = sqlx::query_as(
        "SELECT id, slug, name, is_active, created_at FROM schools WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    let summary: SchoolSummaryCounts = sqlx::query_as(
        "SELECT \
           (SELECT COUNT(*) FROM users u WHERE u.school_id = ? AND u.role = 'admin' AND u.is_active = TRUE) AS admins, \
           (SELECT COUNT(*) FROM users u WHERE u.school_id = ? AND u.role IN ('guru', 'wali_kelas') AND u.is_active = TRUE) AS teachers, \
           (SELECT COUNT(*) FROM students st WHERE st.school_id = ? AND st.status = 'aktif') AS students, \
           (SELECT COUNT(*) FROM classes c JOIN academic_years y ON y.id = c.academic_year_id \
              WHERE c.school_id = ? AND y.is_active = TRUE) AS classes",
    )
    .bind(id)
    .bind(id)
    .bind(id)
    .bind(id)
    .fetch_one(&st.pool)
    .await?;
    let users: Vec<UserRecord> = sqlx::query_as(
        "SELECT id, name, email, role, is_active FROM users WHERE school_id = ? ORDER BY role, name",
    )
    .bind(id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(SchoolDetail { school, summary, users }))
}

// ---------- Ubah nama dan slug ----------

#[derive(Deserialize)]
pub struct UpdateSchoolInput {
    pub name: String,
    pub slug: String,
}

pub async fn update(
    State(st): State<AppState>,
    actor: PlatformUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateSchoolInput>,
) -> AppResult<Json<SchoolRecord>> {
    let name = check_name(&input.name, "name")?;
    let slug = input.slug.trim().to_lowercase();
    if !valid_slug(&slug) {
        return Err(issue("slug", "3–40 karakter: huruf kecil, angka, atau '-'"));
    }
    let mut tx = st.pool.begin().await?;
    let old_slug = school_exists(&mut tx, id).await?;
    let old_name: String = sqlx::query_scalar("SELECT name FROM schools WHERE id = ?")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("UPDATE schools SET name = ?, slug = ? WHERE id = ?")
        .bind(&name)
        .bind(&slug)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::from_db(e, "slug sekolah sudah dipakai"))?;
    audit(
        &mut tx,
        actor.user_id,
        "school.update",
        Some(id),
        json!({ "from": { "name": old_name, "slug": old_slug }, "to": { "name": name, "slug": slug } }),
    )
    .await?;
    tx.commit().await?;

    let record: SchoolRecord = sqlx::query_as("SELECT id, slug, name, is_active, created_at FROM schools WHERE id = ?")
        .bind(id)
        .fetch_one(&st.pool)
        .await?;
    Ok(Json(record))
}

// ---------- Aktifkan / nonaktifkan ----------

#[derive(Deserialize)]
pub struct StatusInput {
    pub is_active: bool,
}

pub async fn set_status(
    State(st): State<AppState>,
    actor: PlatformUser,
    Path(id): Path<Uuid>,
    Json(input): Json<StatusInput>,
) -> AppResult<Json<SchoolRecord>> {
    let mut tx = st.pool.begin().await?;
    school_exists(&mut tx, id).await?;
    sqlx::query("UPDATE schools SET is_active = ? WHERE id = ?")
        .bind(input.is_active)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let action = if input.is_active { "school.activate" } else { "school.deactivate" };
    audit(&mut tx, actor.user_id, action, Some(id), json!({ "is_active": input.is_active })).await?;
    tx.commit().await?;

    let record: SchoolRecord = sqlx::query_as("SELECT id, slug, name, is_active, created_at FROM schools WHERE id = ?")
        .bind(id)
        .fetch_one(&st.pool)
        .await?;
    Ok(Json(record))
}

// ---------- Tambah admin dan reset password ----------

#[derive(Deserialize)]
pub struct NewAdminInput {
    pub name: String,
    pub email: String,
    pub password: String,
}

pub async fn add_admin(
    State(st): State<AppState>,
    actor: PlatformUser,
    Path(id): Path<Uuid>,
    Json(input): Json<NewAdminInput>,
) -> AppResult<(StatusCode, Json<UserRecord>)> {
    let name = check_name(&input.name, "name")?;
    let email = check_email(&input.email)?;
    check_password(&input.password)?;
    let hash = hash_password(&input.password).map_err(AppError::Internal)?;

    let user_id = Uuid::new_v4();
    let mut tx = st.pool.begin().await?;
    school_exists(&mut tx, id).await?;
    sqlx::query(
        "INSERT INTO users (id, school_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(id)
    .bind(&email)
    .bind(&name)
    .bind(&hash)
    .bind(ROLE_ADMIN)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::from_db(e, "email sudah dipakai di sekolah ini"))?;
    audit(&mut tx, actor.user_id, "user.create_admin", Some(id), json!({ "user_id": user_id, "email": email })).await?;
    tx.commit().await?;

    let record = UserRecord { id: user_id, name, email, role: ROLE_ADMIN.to_string(), is_active: true };
    Ok((StatusCode::CREATED, Json(record)))
}

#[derive(Deserialize)]
pub struct ResetPasswordInput {
    pub password: String,
}

pub async fn reset_password(
    State(st): State<AppState>,
    actor: PlatformUser,
    Path((id, user_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<ResetPasswordInput>,
) -> AppResult<StatusCode> {
    check_password(&input.password)?;
    let hash = hash_password(&input.password).map_err(AppError::Internal)?;

    let mut tx = st.pool.begin().await?;
    school_exists(&mut tx, id).await?;
    let email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = ? AND school_id = ?")
        .bind(user_id)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    let email = email.ok_or(AppError::NotFound)?;
    // Sesi lama tetap berlaku sampai kedaluwarsa; password baru dipakai untuk login berikutnya.
    sqlx::query("UPDATE users SET password_hash = ? WHERE id = ? AND school_id = ?")
        .bind(&hash)
        .bind(user_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    audit(&mut tx, actor.user_id, "user.reset_password", Some(id), json!({ "user_id": user_id, "email": email })).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Jejak audit ----------

#[derive(Deserialize)]
pub struct AuditFilter {
    pub school_id: Option<Uuid>,
    pub limit: Option<i64>,
}

#[derive(Serialize, FromRow)]
pub struct AuditRow {
    pub id: Uuid,
    pub actor_name: String,
    pub action: String,
    pub school_id: Option<Uuid>,
    pub school_name: Option<String>,
    pub detail: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn audit_list(
    State(st): State<AppState>,
    _actor: PlatformUser,
    Query(f): Query<AuditFilter>,
) -> AppResult<Json<Vec<AuditRow>>> {
    let limit = f.limit.unwrap_or(100).clamp(1, 500);
    let rows: Vec<AuditRow> = sqlx::query_as(
        "SELECT l.id, COALESCE(p.name, '(akun dihapus)') AS actor_name, l.action, l.school_id, \
           s.name AS school_name, l.detail, l.created_at \
         FROM platform_audit_logs l \
         LEFT JOIN platform_admins p ON p.id = l.actor_id \
         LEFT JOIN schools s ON s.id = l.school_id \
         WHERE (? IS NULL OR l.school_id = ?) \
         ORDER BY l.created_at DESC \
         LIMIT ?",
    )
    .bind(f.school_id)
    .bind(f.school_id)
    .bind(limit)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

// ---------- Token admin sekolah untuk seed data demo ----------

#[derive(Serialize)]
pub struct AdminTokenResponse {
    pub token: String,
    pub user: AdminTokenUser,
}

#[derive(Serialize)]
pub struct AdminTokenUser {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub role: String,
    pub school_id: Uuid,
    pub school_name: String,
}

#[derive(FromRow)]
struct AdminRow {
    id: Uuid,
    name: String,
    email: String,
}

/// Token untuk admin aktif pertama di sekolah. Dipakai super admin untuk mengisi data demo
/// dari dashboard. Setiap pemakaiannya dicatat di jejak audit.
pub async fn admin_token(
    State(st): State<AppState>,
    actor: PlatformUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<AdminTokenResponse>> {
    let mut tx = st.pool.begin().await?;
    let school_name: String = sqlx::query_scalar("SELECT name FROM schools WHERE id = ? AND is_active = TRUE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound)?;
    let admin: AdminRow = sqlx::query_as(
        "SELECT id, name, email FROM users WHERE school_id = ? AND role = 'admin' AND is_active = TRUE \
         ORDER BY created_at LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;
    audit(&mut tx, actor.user_id, "school.demo_token", Some(id), json!({ "as_user": admin.email })).await?;
    tx.commit().await?;

    let token = st.keys.issue(admin.id, id, Role::Admin, 1)?;
    Ok(Json(AdminTokenResponse {
        token,
        user: AdminTokenUser {
            id: admin.id,
            name: admin.name,
            email: admin.email,
            role: Role::Admin.as_str().to_string(),
            school_id: id,
            school_name,
        },
    }))
}
