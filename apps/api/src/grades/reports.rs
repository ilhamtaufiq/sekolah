use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use axum::{
    Json,
    body::Body,
    extract::{Path as AxPath, Query, State},
    http::{HeaderValue, header},
    response::Response,
};
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlPool};
use uuid::Uuid;

use super::{
    READ_ROLES, active_format, ensure_homeroom_or_admin, finals, notes, render, semester_range,
};
use crate::{
    auth::{AuthUser, Role, require_role},
    error::{AppError, AppResult, FieldIssue},
    report_format::model::{PaperSize, ReportFormat},
    state::AppState,
};

/// Nilai satu mapel untuk raport: (mapel, skor, predikat, tuntas).
type GradeRow = (String, Option<f64>, Option<String>, Option<bool>);
/// Pekerjaan render: (id siswa, data JSON raport).
type RenderJob = (Uuid, serde_json::Value);
/// Pasangan (id siswa, path relatif file PDF).
type PathEntry = (Uuid, String);
/// Catatan semester: (sikap, ekstrakurikuler, wali kelas).
type TermNoteParts = (Option<String>, Option<String>, Option<String>);

const MONTHS: [&str; 12] = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
];

fn reports_dir() -> PathBuf {
    std::env::var("REPORTS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("reports"))
}

fn indonesian_date(d: NaiveDate) -> String {
    format!(
        "{} {} {}",
        d.day(),
        MONTHS[(d.month() - 1) as usize],
        d.year()
    )
}

#[derive(Deserialize)]
pub struct GenerateInput {
    pub class_id: Uuid,
    pub semester_id: Uuid,
}

#[derive(Serialize, FromRow)]
pub struct ReportCardRow {
    pub id: Uuid,
    pub student_id: Uuid,
    pub nis: String,
    pub name: String,
    pub format_version: i32,
    pub generated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
pub struct ReportFilter {
    pub class_id: Uuid,
    pub semester_id: Uuid,
}

/// Data satu kelas yang dibutuhkan untuk merender seluruh raport kelas itu.
struct ClassInfo {
    class_name: String,
    academic_year: String,
    semester_name: String,
    homeroom_name: Option<String>,
    starts: NaiveDate,
    ends: NaiveDate,
    academic_year_id: Uuid,
}

async fn class_info(
    pool: &MySqlPool,
    school_id: Uuid,
    class_id: Uuid,
    semester_id: Uuid,
) -> AppResult<ClassInfo> {
    let row: Option<(String, String, Uuid, String, Option<String>)> = sqlx::query_as(
        "SELECT c.name, y.name, y.id, sm.name, u.name \
         FROM classes c \
         JOIN academic_years y ON y.id = c.academic_year_id \
         JOIN semesters sm ON sm.id = ? \
         LEFT JOIN users u ON u.id = c.homeroom_teacher_id \
         WHERE c.id = ? AND c.school_id = ?",
    )
    .bind(semester_id)
    .bind(class_id)
    .bind(school_id)
    .fetch_optional(pool)
    .await?;
    let (class_name, academic_year, academic_year_id, semester_name, homeroom_name) =
        row.ok_or(AppError::NotFound)?;
    let (starts, ends) = semester_range(pool, school_id, semester_id, academic_year_id).await?;
    Ok(ClassInfo {
        class_name,
        academic_year,
        semester_name,
        homeroom_name,
        starts,
        ends,
        academic_year_id,
    })
}

/// Generate raport untuk seluruh siswa kelas pada satu semester.
pub async fn generate(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<GenerateInput>,
) -> AppResult<Json<Vec<ReportCardRow>>> {
    require_role(&user, READ_ROLES)?;
    let school = user.school_id;
    ensure_homeroom_or_admin(&st.pool, &user, school, input.class_id).await?;

    let info = class_info(&st.pool, school, input.class_id, input.semester_id).await?;
    let (version, format) = active_format(&st.pool, school).await?;

    let students: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT s.id, s.nis, s.name FROM class_enrollments en JOIN students s ON s.id = en.student_id \
         WHERE en.class_id = ? AND en.academic_year_id = ? AND en.school_id = ? ORDER BY s.name",
    )
    .bind(input.class_id)
    .bind(info.academic_year_id)
    .bind(school)
    .fetch_all(&st.pool)
    .await?;
    if students.is_empty() {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "class_id",
            "kelas ini belum punya siswa",
        )]));
    }

    // Nilai akhir tiap mapel di kelas. Penugasan tanpa komponen tampil "-".
    let assignments: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT a.id, s.name FROM teaching_assignments a JOIN subjects s ON s.id = a.subject_id \
         WHERE a.class_id = ? AND a.school_id = ? ORDER BY s.name",
    )
    .bind(input.class_id)
    .bind(school)
    .fetch_all(&st.pool)
    .await?;
    let mut grades_by_student: HashMap<Uuid, Vec<GradeRow>> = HashMap::new();
    for (assignment_id, subject) in &assignments {
        for row in finals::compute(&st.pool, school, *assignment_id, input.semester_id).await? {
            grades_by_student.entry(row.student_id).or_default().push((
                subject.clone(),
                row.score,
                row.predicate,
                row.kkm_met,
            ));
        }
    }

    let absences =
        notes::term_absences(&st.pool, school, input.class_id, info.starts, info.ends).await?;
    let term_notes: HashMap<Uuid, TermNoteParts> =
        sqlx::query_as::<_, (Uuid, Option<String>, Option<String>, Option<String>)>(
            "SELECT student_id, attitude, extracurricular, homeroom_note FROM student_term_notes \
         WHERE semester_id = ? AND class_id = ?",
        )
        .bind(input.semester_id)
        .bind(input.class_id)
        .fetch_all(&st.pool)
        .await?
        .into_iter()
        .map(|(sid, a, e, h)| (sid, (a, e, h)))
        .collect();

    let averages: Vec<(Uuid, Option<f64>)> = students
        .iter()
        .map(|(sid, _, _)| {
            let scores: Vec<f64> = grades_by_student
                .get(sid)
                .map(|g| g.iter().filter_map(|(_, s, _, _)| *s).collect())
                .unwrap_or_default();
            let avg =
                (!scores.is_empty()).then(|| scores.iter().sum::<f64>() / scores.len() as f64);
            (*sid, avg)
        })
        .collect();

    let today = chrono::Local::now().date_naive();
    let date_text = indonesian_date(today);
    let (rendered_jobs, paths): (Vec<RenderJob>, Vec<PathEntry>) = students
        .iter()
        .map(|(sid, nis, name)| {
            let (notes_a, notes_e, notes_h) =
                term_notes.get(sid).cloned().unwrap_or((None, None, None));
            let abs = absences.get(sid).cloned().unwrap_or_default();
            let rank = averages
                .iter()
                .find(|(id, _)| id == sid)
                .and_then(|(_, avg)| *avg)
                .map(|mine| {
                    let all: Vec<f64> = averages.iter().filter_map(|(_, a)| *a).collect();
                    let position = 1 + all.iter().filter(|a| **a > mine).count();
                    (position, all.len(), mine)
                });
            let data = build_data(
                &format,
                &info,
                &date_text,
                name,
                nis,
                grades_by_student.get(sid).cloned().unwrap_or_default(),
                (notes_a, notes_e, notes_h),
                abs,
                rank,
            );
            let rel = format!("{school}/{}/{sid}.pdf", input.semester_id);
            ((*sid, data), (*sid, rel))
        })
        .unzip();

    // Render CPU-bound dikerjakan di thread blocking agar runtime async tidak tertahan.
    let rendered: Vec<(Uuid, Result<Vec<u8>, String>)> = tokio::task::spawn_blocking(move || {
        rendered_jobs
            .into_iter()
            .map(|(sid, data)| (sid, render::render_pdf(&data)))
            .collect()
    })
    .await
    .map_err(|e| AppError::Internal(e.into()))?;

    let base = reports_dir();
    let mut tx = st.pool.begin().await?;
    for ((sid, result), (_, rel)) in rendered.into_iter().zip(paths) {
        let bytes =
            result.map_err(|e| AppError::Internal(anyhow::anyhow!("render raport gagal: {e}")))?;
        let full = base.join(&rel);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AppError::Internal(e.into()))?;
        }
        std::fs::write(&full, &bytes).map_err(|e| AppError::Internal(e.into()))?;

        sqlx::query(
            "INSERT INTO report_cards (id, school_id, class_id, semester_id, student_id, format_version, file_path, generated_by) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new \
             ON DUPLICATE KEY UPDATE format_version = new.format_version, file_path = new.file_path, \
                 generated_by = new.generated_by, generated_at = UTC_TIMESTAMP(6)",
        )
        .bind(Uuid::new_v4())
        .bind(school)
        .bind(input.class_id)
        .bind(input.semester_id)
        .bind(sid)
        .bind(version)
        .bind(&rel)
        .bind(user.user_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    list_rows(&st.pool, school, input.class_id, input.semester_id)
        .await
        .map(Json)
}

#[allow(clippy::too_many_arguments)]
fn build_data(
    format: &ReportFormat,
    info: &ClassInfo,
    date_text: &str,
    name: &str,
    nis: &str,
    grades: Vec<GradeRow>,
    notes: TermNoteParts,
    absences: notes::Absences,
    rank: Option<(usize, usize, f64)>,
) -> serde_json::Value {
    let dec = usize::from(format.grading.decimal_places);
    let (paper_w, paper_h) = match format.page.paper {
        PaperSize::A4 => (210.0, 297.0),
        PaperSize::F4 => (215.0, 330.0),
        PaperSize::Letter => (216.0, 279.0),
    };
    let grades_json: Vec<serde_json::Value> = grades
        .into_iter()
        .map(|(subject, score, predicate, kkm)| {
            serde_json::json!({
                "subject": subject,
                "score": score.map(|s| format!("{s:.dec$}")).unwrap_or_else(|| "-".to_string()),
                "predicate": predicate.unwrap_or_else(|| "-".to_string()),
                "kkm": match kkm {
                    Some(true) => "Tuntas",
                    Some(false) => "Belum tuntas",
                    None => "-",
                },
            })
        })
        .collect();
    let rank_json = rank.map(|(position, total, avg)| {
        serde_json::json!({ "position": position, "total": total, "average": format!("{avg:.dec$}") })
    });
    let sections: Vec<serde_json::Value> = format
        .sections
        .iter()
        .filter_map(|k| serde_json::to_value(k).ok())
        .collect();
    let predicates: Vec<serde_json::Value> = format
        .grading
        .predicates
        .iter()
        .map(|p| serde_json::json!({ "label": p.label, "min": p.min, "description": p.description.clone().unwrap_or_default() }))
        .collect();

    serde_json::json!({
        "page": {
            "width_mm": paper_w,
            "height_mm": paper_h,
            "margin_mm": format.page.margin_mm,
            "font_family": format.page.font_family,
            "font_size_pt": format.page.font_size_pt,
        },
        "kop": {
            "title": format.kop.title,
            "subtitle": format.kop.subtitle,
            "address": format.kop.address,
        },
        "student": {
            "name": name,
            "nis": nis,
            "class_name": info.class_name,
            "semester_name": info.semester_name,
            "academic_year": info.academic_year,
        },
        "sections": sections,
        "grades": grades_json,
        "notes": { "attitude": notes.0, "extracurricular": notes.1, "homeroom": notes.2 },
        "absences": { "sakit": absences.sakit, "izin": absences.izin, "alpa": absences.alpa },
        "rank": rank_json,
        "predicates": predicates,
        "signatures": {
            "city": format.signatures.city,
            "date": date_text,
            "wali_title": format.signatures.wali_kelas_title,
            "wali_name": info.homeroom_name.clone().unwrap_or_else(|| "................................".to_string()),
            "kepala_name": format.signatures.kepala_sekolah_name,
            "kepala_nip": format.signatures.kepala_sekolah_nip,
        },
    })
}

async fn list_rows(
    pool: &MySqlPool,
    school: Uuid,
    class_id: Uuid,
    semester_id: Uuid,
) -> AppResult<Vec<ReportCardRow>> {
    Ok(sqlx::query_as(
        "SELECT r.id, r.student_id, s.nis, s.name, r.format_version, r.generated_at \
         FROM report_cards r JOIN students s ON s.id = r.student_id \
         WHERE r.school_id = ? AND r.class_id = ? AND r.semester_id = ? ORDER BY s.name",
    )
    .bind(school)
    .bind(class_id)
    .bind(semester_id)
    .fetch_all(pool)
    .await?)
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<ReportFilter>,
) -> AppResult<Json<Vec<ReportCardRow>>> {
    require_role(&user, READ_ROLES)?;
    Ok(Json(
        list_rows(&st.pool, user.school_id, f.class_id, f.semester_id).await?,
    ))
}

/// Unduh PDF. Admin, wali kelas, guru di kelas itu, atau siswa pemilik raport.
pub async fn download(
    State(st): State<AppState>,
    user: AuthUser,
    AxPath(id): AxPath<Uuid>,
) -> AppResult<Response> {
    let (student_id, class_id, nis, file_path): (Uuid, Uuid, String, String) = sqlx::query_as(
        "SELECT r.student_id, r.class_id, s.nis, r.file_path FROM report_cards r \
         JOIN students s ON s.id = r.student_id WHERE r.id = ? AND r.school_id = ?",
    )
    .bind(id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let allowed = match user.role {
        Role::Admin | Role::KepalaSekolah => true,
        Role::Siswa => {
            let own: Option<i64> =
                sqlx::query_scalar("SELECT 1 FROM students WHERE id = ? AND user_id = ?")
                    .bind(student_id)
                    .bind(user.user_id)
                    .fetch_optional(&st.pool)
                    .await?;
            own.is_some()
        }
        Role::Guru | Role::WaliKelas => {
            let teaches: Option<i64> = sqlx::query_scalar(
                "SELECT 1 FROM classes c WHERE c.id = ? AND c.school_id = ? AND \
                 (c.homeroom_teacher_id = ? OR EXISTS (SELECT 1 FROM teaching_assignments a WHERE a.class_id = c.id AND a.teacher_id = ?))",
            )
            .bind(class_id)
            .bind(user.school_id)
            .bind(user.user_id)
            .bind(user.user_id)
            .fetch_optional(&st.pool)
            .await?;
            teaches.is_some()
        }
        Role::OrangTua => false,
    };
    if !allowed {
        return Err(AppError::Forbidden);
    }

    let bytes = std::fs::read(Path::new(&reports_dir()).join(&file_path))
        .map_err(|_| AppError::NotFound)?;
    let filename = format!("raport-{nis}.pdf");
    Response::builder()
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/pdf"),
        )
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
                .map_err(|e| AppError::Internal(e.into()))?,
        )
        .body(Body::from(bytes))
        .map_err(|e| AppError::Internal(e.into()))
}
