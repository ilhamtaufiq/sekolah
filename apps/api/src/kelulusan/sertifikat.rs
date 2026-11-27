use axum::{
    Json,
    body::Body,
    extract::{Path, State},
    http::{HeaderValue, header},
    response::Response,
};
use chrono::{DateTime, Datelike, Local, Utc};
use serde::Serialize;
use sqlx::{FromRow, MySqlConnection, MySqlPool};
use uuid::Uuid;

use super::{LEADERSHIP, render};
use crate::{
    auth::{AuthUser, Role, require_role},
    error::{AppError, AppResult},
    grades::active_format,
    state::AppState,
};

const MONTHS: [&str; 12] = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober",
    "November", "Desember",
];

#[derive(Serialize, Clone)]
pub struct Issued {
    pub student_id: Uuid,
    pub nomor: String,
}

/// Mengembalikan sertifikat siswa, membuatnya bila belum ada.
///
/// Dipanggil di dalam transaksi yang sudah mengunci baris sekolah, sehingga
/// nomor urut tidak bisa bentrok antar proses. Bila siswa sudah punya sertifikat,
/// nomor lama dipakai dan tidak ada yang dibuat lagi.
pub async fn ensure_for_student(
    conn: &mut MySqlConnection,
    school_id: Uuid,
    student_id: Uuid,
    academic_year_id: Uuid,
    kode: &str,
    issued_by: Uuid,
) -> AppResult<Issued> {
    let existing: Option<String> =
        sqlx::query_scalar("SELECT nomor FROM certificates WHERE school_id = ? AND student_id = ?")
            .bind(school_id)
            .bind(student_id)
            .fetch_optional(&mut *conn)
            .await?;
    if let Some(nomor) = existing {
        return Ok(Issued { student_id, nomor });
    }

    // Nomor urut direset tiap tahun terbit.
    let tahun = Local::now().year() as u16;
    let seq: i64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE(MAX(seq), 0) + 1 AS SIGNED) FROM certificates WHERE school_id = ? AND tahun = ?",
    )
    .bind(school_id)
    .bind(tahun)
    .fetch_one(&mut *conn)
    .await?;

    let nomor = format!("{seq:03}/{kode}/{tahun}");
    sqlx::query(
        "INSERT INTO certificates (id, school_id, student_id, academic_year_id, nomor, tahun, seq, issued_by) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4())
    .bind(school_id)
    .bind(student_id)
    .bind(academic_year_id)
    .bind(&nomor)
    .bind(tahun)
    .bind(seq)
    .bind(issued_by)
    .execute(&mut *conn)
    .await
    .map_err(|e| AppError::from_db(e, "nomor sertifikat bentrok, ulangi prosesnya"))?;

    Ok(Issued { student_id, nomor })
}

#[derive(Serialize, FromRow)]
pub struct CertificateRow {
    pub id: Uuid,
    pub student_id: Uuid,
    pub nis: String,
    pub name: String,
    pub nomor: String,
    pub tahun: u16,
    pub academic_year: String,
    pub issued_at: DateTime<Utc>,
}

/// Semua sertifikat di sekolah. Untuk admin dan kepala sekolah.
pub async fn list(State(st): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<CertificateRow>>> {
    require_role(&user, LEADERSHIP)?;
    let rows = sqlx::query_as(
        "SELECT c.id, c.student_id, s.nis, s.name, c.nomor, c.tahun, ay.name AS academic_year, c.issued_at \
         FROM certificates c \
         JOIN students s ON s.id = c.student_id \
         JOIN academic_years ay ON ay.id = c.academic_year_id \
         WHERE c.school_id = ? ORDER BY c.tahun DESC, c.seq DESC",
    )
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

/// Sertifikat milik siswa yang sedang login.
pub async fn mine(State(st): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<CertificateRow>>> {
    require_role(&user, &[Role::Siswa])?;
    let rows = sqlx::query_as(
        "SELECT c.id, c.student_id, s.nis, s.name, c.nomor, c.tahun, ay.name AS academic_year, c.issued_at \
         FROM certificates c \
         JOIN students s ON s.id = c.student_id \
         JOIN academic_years ay ON ay.id = c.academic_year_id \
         WHERE s.user_id = ? AND c.school_id = ? ORDER BY c.tahun DESC, c.seq DESC",
    )
    .bind(user.user_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(FromRow)]
struct RenderRow {
    nomor: String,
    issued_at: DateTime<Utc>,
    nis: String,
    name: String,
    school_name: String,
    academic_year: String,
    class_name: Option<String>,
}

fn indonesian_date(d: chrono::NaiveDate) -> String {
    format!("{} {} {}", d.day(), MONTHS[(d.month() - 1) as usize], d.year())
}

async fn load_render_row(pool: &MySqlPool, school_id: Uuid, id: Uuid) -> AppResult<RenderRow> {
    sqlx::query_as(
        "SELECT c.nomor, c.issued_at, s.nis, s.name, sc.name AS school_name, ay.name AS academic_year, cl.name AS class_name \
         FROM certificates c \
         JOIN students s ON s.id = c.student_id \
         JOIN schools sc ON sc.id = c.school_id \
         JOIN academic_years ay ON ay.id = c.academic_year_id \
         LEFT JOIN student_promotions p ON p.academic_year_id = c.academic_year_id AND p.student_id = c.student_id \
         LEFT JOIN classes cl ON cl.id = p.from_class_id \
         WHERE c.id = ? AND c.school_id = ?",
    )
    .bind(id)
    .bind(school_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Unduh PDF sertifikat. Admin dan kepala sekolah boleh; siswa hanya miliknya sendiri.
pub async fn download(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Response> {
    let owner: Option<Uuid> = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT s.user_id FROM certificates c JOIN students s ON s.id = c.student_id \
         WHERE c.id = ? AND c.school_id = ?",
    )
    .bind(id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let allowed = match user.role {
        Role::Admin | Role::KepalaSekolah => true,
        Role::Siswa => owner == Some(user.user_id),
        Role::Guru | Role::WaliKelas | Role::OrangTua => false,
    };
    if !allowed {
        return Err(AppError::Forbidden);
    }

    let row = load_render_row(&st.pool, user.school_id, id).await?;
    let (_, format) = active_format(&st.pool, user.school_id).await?;
    let date_text = indonesian_date(row.issued_at.with_timezone(&Local).date_naive());
    let data = serde_json::json!({
        "kop": { "title": format.kop.title, "address": format.kop.address },
        "nomor": row.nomor,
        "student": {
            "name": row.name,
            "nis": row.nis,
            "class_name": row.class_name.unwrap_or_else(|| "-".to_string()),
            "academic_year": row.academic_year,
        },
        "school_name": row.school_name,
        "date_text": date_text,
        "city": format.signatures.city,
        "kepala_name": format.signatures.kepala_sekolah_name,
    });

    let bytes = tokio::task::spawn_blocking(move || render::render_pdf(&data))
        .await
        .map_err(|e| AppError::Internal(e.into()))?
        .map_err(|e| AppError::Internal(anyhow::anyhow!("render sertifikat gagal: {e}")))?;

    // NIS dipakai di nama berkas, jadi hanya karakter aman yang dipertahankan.
    let safe_nis: String = row
        .nis
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    let filename = format!("sertifikat-{safe_nis}.pdf");
    Response::builder()
        .header(header::CONTENT_TYPE, HeaderValue::from_static("application/pdf"))
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
                .map_err(|e| AppError::Internal(e.into()))?,
        )
        .body(Body::from(bytes))
        .map_err(|e| AppError::Internal(e.into()))
}
