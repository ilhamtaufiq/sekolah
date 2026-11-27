//! Profil sekolah dan istilah UI yang bergantung pada jenis lembaga.
//!
//! `JenisLembaga::terms` adalah satu-satunya sumber istilah. Frontend membacanya
//! lewat `GET /api/school-profile` dan tidak menyimpan daftar istilah sendiri.
//! GET dapat dibaca semua peran yang sudah login (istilah dipakai semua halaman);
//! PUT hanya untuk admin.

use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::{AuthUser, Role, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JenisLembaga {
    Sd,
    Smp,
    Sma,
    Pkbm,
    Paud,
    Tk,
}

impl JenisLembaga {
    pub const ALL: [JenisLembaga; 6] = [
        JenisLembaga::Sd,
        JenisLembaga::Smp,
        JenisLembaga::Sma,
        JenisLembaga::Pkbm,
        JenisLembaga::Paud,
        JenisLembaga::Tk,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            JenisLembaga::Sd => "sd",
            JenisLembaga::Smp => "smp",
            JenisLembaga::Sma => "sma",
            JenisLembaga::Pkbm => "pkbm",
            JenisLembaga::Paud => "paud",
            JenisLembaga::Tk => "tk",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|j| j.as_str() == s)
    }

    /// Istilah UI untuk jenis lembaga ini. Ubah di sini, bukan di frontend.
    pub fn terms(self) -> Terms {
        let (student, class) = match self {
            JenisLembaga::Sd | JenisLembaga::Smp | JenisLembaga::Sma => ("Siswa", "Kelas"),
            JenisLembaga::Pkbm => ("Warga belajar", "Rombel"),
            JenisLembaga::Paud | JenisLembaga::Tk => ("Peserta didik", "Kelas"),
        };
        Terms { student, class }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Terms {
    /// Sebutan untuk peserta didik, misalnya "Siswa" atau "Warga belajar".
    pub student: &'static str,
    /// Sebutan untuk kelompok belajar, misalnya "Kelas" atau "Rombel".
    pub class: &'static str,
}

#[derive(Serialize)]
pub struct SchoolProfile {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub jenis_lembaga: &'static str,
    pub terms: Terms,
}

#[derive(FromRow)]
struct ProfileRow {
    id: Uuid,
    name: String,
    slug: String,
    jenis_lembaga: String,
}

#[derive(Deserialize)]
pub struct ProfileInput {
    pub jenis_lembaga: String,
}

fn to_profile(row: ProfileRow) -> AppResult<SchoolProfile> {
    // CHECK constraint di database menjamin nilai ini; cabang error hanya untuk data rusak.
    let jenis = JenisLembaga::parse(&row.jenis_lembaga).ok_or_else(|| {
        AppError::Internal(anyhow::anyhow!(
            "jenis_lembaga tersimpan tidak dikenal: {}",
            row.jenis_lembaga
        ))
    })?;
    Ok(SchoolProfile {
        id: row.id,
        name: row.name,
        slug: row.slug,
        jenis_lembaga: jenis.as_str(),
        terms: jenis.terms(),
    })
}

async fn fetch_profile(st: &AppState, school_id: Uuid) -> AppResult<SchoolProfile> {
    let row: ProfileRow =
        sqlx::query_as("SELECT id, name, slug, jenis_lembaga FROM schools WHERE id = ?")
            .bind(school_id)
            .fetch_optional(&st.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    to_profile(row)
}

pub async fn get(State(st): State<AppState>, user: AuthUser) -> AppResult<Json<SchoolProfile>> {
    Ok(Json(fetch_profile(&st, user.school_id).await?))
}

pub async fn update(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<ProfileInput>,
) -> AppResult<Json<SchoolProfile>> {
    require_role(&user, &[Role::Admin])?;
    let jenis = JenisLembaga::parse(input.jenis_lembaga.trim()).ok_or_else(|| {
        AppError::Validation(vec![FieldIssue::new(
            "jenis_lembaga",
            "pilih salah satu: sd, smp, sma, pkbm, paud, tk",
        )])
    })?;

    sqlx::query("UPDATE schools SET jenis_lembaga = ? WHERE id = ?")
        .bind(jenis.as_str())
        .bind(user.school_id)
        .execute(&st.pool)
        .await?;

    Ok(Json(fetch_profile(&st, user.school_id).await?))
}
