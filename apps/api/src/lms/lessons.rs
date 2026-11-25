//! Pembelajaran: materi berurutan (video YouTube atau PDF) dengan progres per siswa.
//!
//! Selesai per item: video = 100% durasi (lihat video.rs); PDF = semua halaman sudah dibuka.
//! Pembelajaran selesai bila semua item selesai.

use std::collections::BTreeSet;

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::room_scope;
use crate::{
    auth::{AuthUser, Role, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
    validate::Validator,
};

const MAX_ITEMS: usize = 30;
const MAX_PDF_PAGES: u32 = 2_000;

#[derive(Deserialize)]
pub struct ItemInput {
    /// "video" atau "pdf".
    pub kind: String,
    /// Materi pemilik item (materi video, atau materi yang memuat PDF).
    pub material_id: Uuid,
    /// Berkas PDF di dalam materi. Wajib untuk kind "pdf".
    pub file_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct LessonInput {
    pub title: String,
    pub description: Option<String>,
    pub items: Vec<ItemInput>,
}

#[derive(Serialize, FromRow)]
pub struct LessonSummary {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub item_count: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct ItemView {
    pub id: Uuid,
    pub position: u32,
    pub kind: String,
    pub title: String,
    pub material_id: Uuid,
    pub file_id: Option<Uuid>,
    pub youtube_id: Option<String>,
    /// Progres siswa yang login. Kosong untuk guru.
    pub progress: Option<ItemProgress>,
}

#[derive(Serialize, Clone, Copy)]
pub struct ItemProgress {
    pub percent: f64,
    pub completed: bool,
    /// Khusus PDF: halaman yang sudah dibuka dan jumlah total halaman.
    pub viewed_pages: Option<u32>,
    pub total_pages: Option<u32>,
}

#[derive(Serialize)]
pub struct LessonDetail {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub items: Vec<ItemView>,
    /// Persentase item yang selesai (siswa). Kosong untuk guru.
    pub percent: Option<f64>,
    pub completed: Option<bool>,
}

#[derive(FromRow)]
struct ItemRow {
    id: Uuid,
    position: u32,
    kind: String,
    material_id: Uuid,
    file_id: Option<Uuid>,
    material_title: String,
    file_name: Option<String>,
    youtube_id: Option<String>,
}

#[derive(Deserialize)]
pub struct PdfBeat {
    pub total_pages: u32,
    /// Nomor halaman (mulai 1) yang baru saja tampil di layar.
    pub pages: Vec<u32>,
}

#[derive(Serialize)]
pub struct PdfProgressView {
    pub viewed_pages: u32,
    pub total_pages: u32,
    pub percent: f64,
    pub completed: bool,
}

fn pdf_view(viewed: u32, total: u32, completed: bool) -> PdfProgressView {
    let percent = if total == 0 {
        0.0
    } else {
        ((viewed as f64 / total as f64) * 100.0).min(100.0).round()
    };
    PdfProgressView {
        viewed_pages: viewed,
        total_pages: total,
        percent,
        completed,
    }
}

/// Guru pengampu atau admin: membuat pembelajaran dari materi yang sudah ada di ruang kelas.
pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Path(room_id): Path<Uuid>,
    Json(input): Json<LessonInput>,
) -> AppResult<Json<LessonDetail>> {
    if !room_scope(&st.pool, &user, room_id).await?.manage {
        return Err(AppError::Forbidden);
    }

    let mut v = Validator::new();
    let title = v.text("title", &input.title, 1, 200);
    let description = v.opt_text("description", input.description.as_deref(), 5_000);
    v.require(
        !input.items.is_empty() && input.items.len() <= MAX_ITEMS,
        "items",
        "pembelajaran berisi 1–30 materi",
    );
    v.finish()?;

    // Validasi tiap item terhadap ruang kelas ini sebelum menulis apa pun.
    let mut issues = Vec::new();
    for (i, item) in input.items.iter().enumerate() {
        let field = format!("items[{i}]");
        let material: Option<(Uuid, Option<String>)> = sqlx::query_as(
            "SELECT assignment_id, youtube_id FROM lms_materials WHERE id = ? AND school_id = ?",
        )
        .bind(item.material_id)
        .bind(user.school_id)
        .fetch_optional(&st.pool)
        .await?;
        let Some((assignment, youtube_id)) = material else {
            issues.push(FieldIssue::new(
                format!("{field}.material_id"),
                "materi tidak ditemukan",
            ));
            continue;
        };
        if assignment != room_id {
            issues.push(FieldIssue::new(
                format!("{field}.material_id"),
                "materi bukan milik ruang kelas ini",
            ));
            continue;
        }
        match item.kind.as_str() {
            "video" => {
                if youtube_id.is_none() {
                    issues.push(FieldIssue::new(
                        format!("{field}.kind"),
                        "materi ini bukan video",
                    ));
                }
            }
            "pdf" => {
                let Some(file) = item.file_id else {
                    issues.push(FieldIssue::new(
                        format!("{field}.file_id"),
                        "pilih berkas PDF",
                    ));
                    continue;
                };
                let ok: Option<i64> = sqlx::query_scalar(
                    "SELECT 1 FROM lms_files WHERE id = ? AND school_id = ? AND owner_kind = 'material' \
                     AND owner_id = ? AND mime = 'application/pdf'",
                )
                .bind(file)
                .bind(user.school_id)
                .bind(item.material_id)
                .fetch_optional(&st.pool)
                .await?;
                if ok.is_none() {
                    issues.push(FieldIssue::new(
                        format!("{field}.file_id"),
                        "berkas PDF tidak ditemukan di materi ini",
                    ));
                }
            }
            _ => issues.push(FieldIssue::new(
                format!("{field}.kind"),
                "jenis harus 'video' atau 'pdf'",
            )),
        }
    }
    if !issues.is_empty() {
        return Err(AppError::Validation(issues));
    }

    let id = Uuid::new_v4();
    let mut tx = st.pool.begin().await?;
    sqlx::query(
        "INSERT INTO lms_lessons (id, school_id, assignment_id, title, description, created_by) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(room_id)
    .bind(&title)
    .bind(&description)
    .bind(user.user_id)
    .execute(&mut *tx)
    .await?;
    for (i, item) in input.items.iter().enumerate() {
        sqlx::query(
            "INSERT INTO lms_lesson_items (id, lesson_id, school_id, position, kind, material_id, file_id) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4())
        .bind(id)
        .bind(user.school_id)
        .bind((i + 1) as u32)
        .bind(&item.kind)
        .bind(item.material_id)
        .bind(item.file_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok(Json(load_detail(&st.pool, &user, id).await?))
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Path(room_id): Path<Uuid>,
) -> AppResult<Json<Vec<LessonSummary>>> {
    room_scope(&st.pool, &user, room_id).await?;
    let rows = sqlx::query_as(
        "SELECT l.id, l.title, l.description, CAST((SELECT COUNT(*) FROM lms_lesson_items i WHERE i.lesson_id = l.id) AS SIGNED) AS item_count, \
                l.created_at \
         FROM lms_lessons l WHERE l.assignment_id = ? AND l.school_id = ? ORDER BY l.created_at DESC",
    )
    .bind(room_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

/// Detail pembelajaran. Siswa melihat progresnya sendiri; guru melihat susunan materi.
pub async fn detail(
    State(st): State<AppState>,
    user: AuthUser,
    Path(lesson_id): Path<Uuid>,
) -> AppResult<Json<LessonDetail>> {
    Ok(Json(load_detail(&st.pool, &user, lesson_id).await?))
}

async fn load_detail(
    pool: &sqlx::MySqlPool,
    user: &AuthUser,
    lesson_id: Uuid,
) -> AppResult<LessonDetail> {
    let (room_id, title, description): (Uuid, String, Option<String>) = sqlx::query_as(
        "SELECT assignment_id, title, description FROM lms_lessons WHERE id = ? AND school_id = ?",
    )
    .bind(lesson_id)
    .bind(user.school_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    let scope = room_scope(pool, user, room_id).await?;

    let rows: Vec<ItemRow> = sqlx::query_as(
        "SELECT i.id, i.position, i.kind, i.material_id, i.file_id, m.title AS material_title, \
                f.file_name, m.youtube_id \
         FROM lms_lesson_items i \
         JOIN lms_materials m ON m.id = i.material_id \
         LEFT JOIN lms_files f ON f.id = i.file_id \
         WHERE i.lesson_id = ? ORDER BY i.position",
    )
    .bind(lesson_id)
    .fetch_all(pool)
    .await?;

    let mut items = Vec::with_capacity(rows.len());
    let mut done = 0usize;
    for r in rows {
        let progress = match scope.student_id {
            Some(student) => {
                let p = item_progress(pool, &r, student).await?;
                if p.completed {
                    done += 1;
                }
                Some(p)
            }
            None => None,
        };
        items.push(ItemView {
            id: r.id,
            position: r.position,
            kind: r.kind,
            title: r.file_name.unwrap_or(r.material_title),
            material_id: r.material_id,
            file_id: r.file_id,
            youtube_id: r.youtube_id,
            progress,
        });
    }

    let (percent, completed) = match scope.student_id {
        Some(_) if !items.is_empty() => {
            let pct = ((done as f64 / items.len() as f64) * 100.0).round();
            (Some(pct), Some(done == items.len()))
        }
        Some(_) => (Some(0.0), Some(false)),
        None => (None, None),
    };

    Ok(LessonDetail {
        id: lesson_id,
        title,
        description,
        items,
        percent,
        completed,
    })
}

async fn item_progress(
    pool: &sqlx::MySqlPool,
    row: &ItemRow,
    student: Uuid,
) -> AppResult<ItemProgress> {
    if row.kind == "video" {
        let video: Option<(f64, Option<f64>, Option<DateTime<Utc>>)> = sqlx::query_as(
            "SELECT watched_seconds, duration_seconds, completed_at FROM lms_video_progress \
             WHERE material_id = ? AND student_id = ?",
        )
        .bind(row.material_id)
        .bind(student)
        .fetch_optional(pool)
        .await?;
        let (watched, duration, completed_at) = video.unwrap_or((0.0, None, None));
        let v = super::video::view(watched, duration, completed_at.is_some());
        return Ok(ItemProgress {
            percent: v.percent,
            completed: v.completed,
            viewed_pages: None,
            total_pages: None,
        });
    }

    let file = row
        .file_id
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("item PDF tanpa berkas")))?;
    let pdf: Option<(u32, serde_json::Value, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT total_pages, viewed, completed_at FROM lms_pdf_progress WHERE file_id = ? AND student_id = ?",
    )
    .bind(file)
    .bind(student)
    .fetch_optional(pool)
    .await?;
    Ok(match pdf {
        Some((total, viewed, completed_at)) => {
            let n = viewed.as_array().map(|a| a.len() as u32).unwrap_or(0);
            let v = pdf_view(n, total, completed_at.is_some());
            ItemProgress {
                percent: v.percent,
                completed: v.completed,
                viewed_pages: Some(v.viewed_pages),
                total_pages: Some(v.total_pages),
            }
        }
        None => ItemProgress {
            percent: 0.0,
            completed: false,
            viewed_pages: Some(0),
            total_pages: None,
        },
    })
}

pub async fn delete(
    State(st): State<AppState>,
    user: AuthUser,
    Path(lesson_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let room: Uuid =
        sqlx::query_scalar("SELECT assignment_id FROM lms_lessons WHERE id = ? AND school_id = ?")
            .bind(lesson_id)
            .bind(user.school_id)
            .fetch_optional(&st.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    if !room_scope(&st.pool, &user, room).await?.manage {
        return Err(AppError::Forbidden);
    }
    sqlx::query("DELETE FROM lms_lessons WHERE id = ?")
        .bind(lesson_id)
        .execute(&st.pool)
        .await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// Siswa melaporkan halaman PDF yang baru tampil. Halaman yang sudah dibuka tidak dihitung dua kali.
pub async fn pdf_beat(
    State(st): State<AppState>,
    user: AuthUser,
    Path(file_id): Path<Uuid>,
    Json(input): Json<PdfBeat>,
) -> AppResult<Json<PdfProgressView>> {
    require_role(&user, &[Role::Siswa])?;
    let (room, mime): (Uuid, String) = sqlx::query_as(
        "SELECT m.assignment_id, f.mime FROM lms_files f \
         JOIN lms_materials m ON m.id = f.owner_id \
         WHERE f.id = ? AND f.school_id = ? AND f.owner_kind = 'material'",
    )
    .bind(file_id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    if mime != "application/pdf" {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "file",
            "berkas ini bukan PDF",
        )]));
    }
    let student = room_scope(&st.pool, &user, room)
        .await?
        .student_id
        .ok_or(AppError::Forbidden)?;

    let mut v = Validator::new();
    v.require(
        (1..=MAX_PDF_PAGES).contains(&input.total_pages),
        "total_pages",
        "jumlah halaman 1–2000",
    );
    v.require(
        input.pages.len() <= 50,
        "pages",
        "terlalu banyak halaman dalam satu laporan",
    );
    v.finish()?;
    if input
        .pages
        .iter()
        .any(|p| *p == 0 || *p > input.total_pages)
    {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "pages",
            "nomor halaman di luar jumlah halaman",
        )]));
    }

    let existing: Option<(serde_json::Value, Option<DateTime<Utc>>, u32)> = sqlx::query_as(
        "SELECT viewed, completed_at, total_pages FROM lms_pdf_progress WHERE file_id = ? AND student_id = ?",
    )
    .bind(file_id)
    .bind(student)
    .fetch_optional(&st.pool)
    .await?;
    let total = existing.as_ref().map(|e| e.2).unwrap_or(input.total_pages);
    if total != input.total_pages {
        return Err(AppError::Conflict(
            "jumlah halaman PDF tidak sesuai dengan catatan sebelumnya".to_string(),
        ));
    }
    let mut pages: BTreeSet<u32> = existing
        .as_ref()
        .and_then(|e| e.0.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_u64().map(|n| n as u32))
                .collect()
        })
        .unwrap_or_default();
    pages.extend(input.pages.iter().copied());

    let completed_at = existing
        .as_ref()
        .and_then(|e| e.1)
        .or_else(|| (pages.len() as u32 == total).then(Utc::now));
    let viewed_json =
        serde_json::Value::Array(pages.iter().map(|p| serde_json::json!(p)).collect());

    sqlx::query(
        "INSERT INTO lms_pdf_progress (file_id, student_id, school_id, total_pages, viewed, completed_at) \
         VALUES (?, ?, ?, ?, ?, ?) AS new \
         ON DUPLICATE KEY UPDATE viewed = new.viewed, completed_at = new.completed_at, updated_at = UTC_TIMESTAMP(6)",
    )
    .bind(file_id)
    .bind(student)
    .bind(user.school_id)
    .bind(total)
    .bind(viewed_json)
    .bind(completed_at)
    .execute(&st.pool)
    .await?;

    Ok(Json(pdf_view(
        pages.len() as u32,
        total,
        completed_at.is_some(),
    )))
}

/// Progres PDF milik siswa yang login.
pub async fn pdf_mine(
    State(st): State<AppState>,
    user: AuthUser,
    Path(file_id): Path<Uuid>,
) -> AppResult<Json<PdfProgressView>> {
    require_role(&user, &[Role::Siswa])?;
    let room: Uuid = sqlx::query_scalar(
        "SELECT m.assignment_id FROM lms_files f JOIN lms_materials m ON m.id = f.owner_id \
         WHERE f.id = ? AND f.school_id = ? AND f.owner_kind = 'material'",
    )
    .bind(file_id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    let student = room_scope(&st.pool, &user, room)
        .await?
        .student_id
        .ok_or(AppError::Forbidden)?;
    let row: Option<(serde_json::Value, Option<DateTime<Utc>>, u32)> = sqlx::query_as(
        "SELECT viewed, completed_at, total_pages FROM lms_pdf_progress WHERE file_id = ? AND student_id = ?",
    )
    .bind(file_id)
    .bind(student)
    .fetch_optional(&st.pool)
    .await?;
    Ok(Json(match row {
        Some((viewed, completed_at, total)) => {
            let n = viewed.as_array().map(|a| a.len() as u32).unwrap_or(0);
            pdf_view(n, total, completed_at.is_some())
        }
        None => pdf_view(0, 0, false),
    }))
}
