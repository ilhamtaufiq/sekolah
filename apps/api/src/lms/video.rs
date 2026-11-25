//! Materi video YouTube dan progres tonton siswa.
//!
//! Progres dihitung dari heartbeat pemutar. Server membatasi kredit detik agar
//! lompatan posisi (seek) tidak dihitung sebagai menonton.

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
};

/// Kredit maksimum per heartbeat (detik). Pemutar mengirim heartbeat setiap 10 detik.
const MAX_CREDIT_PER_BEAT: f64 = 15.0;
/// Toleransi selisih antara waktu nyata dan maju posisi pemutar (detik).
const TOLERANCE: f64 = 3.0;
/// Selesai = 100% durasi, dengan toleransi 1 detik untuk pembulatan.
const COMPLETE_TOLERANCE: f64 = 1.0;

/// Detik yang benar-benar ditonton dari satu heartbeat.
/// Hanya dihitung bila posisi maju kira-kira sama dengan waktu nyata yang lewat.
/// Lompatan ke depan (seek) atau jeda (posisi diam) tidak menambah detik.
pub fn credit(prev_pos: f64, pos: f64, elapsed: f64) -> f64 {
    let delta = pos - prev_pos;
    if delta <= 0.0 || elapsed <= 0.0 || delta > elapsed + TOLERANCE {
        return 0.0;
    }
    delta.min(elapsed).min(MAX_CREDIT_PER_BEAT)
}

/// Ambil id video dari tautan YouTube (watch, youtu.be, embed, shorts).
pub fn parse_youtube_id(input: &str) -> Option<String> {
    let s = input.trim();
    let rest = s
        .strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))
        .unwrap_or(s);
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.trim_start_matches("www.").trim_start_matches("m.");

    let id = if host == "youtu.be" {
        path.split(['?', '&', '#']).next().unwrap_or("").to_string()
    } else if host == "youtube.com" {
        if let Some(query) = path.strip_prefix("watch?") {
            query
                .split('&')
                .find_map(|kv| kv.strip_prefix("v="))
                .unwrap_or("")
                .to_string()
        } else if let Some(v) = path
            .strip_prefix("embed/")
            .or_else(|| path.strip_prefix("shorts/"))
        {
            v.split(['?', '&', '#', '/'])
                .next()
                .unwrap_or("")
                .to_string()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let valid = id.len() == 11
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    valid.then_some(id)
}

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct ProgressView {
    pub watched_seconds: f64,
    pub duration_seconds: Option<f64>,
    pub percent: f64,
    pub completed: bool,
}

pub(super) fn view(watched: f64, duration: Option<f64>, completed: bool) -> ProgressView {
    let percent = match duration {
        Some(d) if d > 0.0 => ((watched / d) * 100.0).min(100.0).round(),
        _ => 0.0,
    };
    ProgressView {
        watched_seconds: watched,
        duration_seconds: duration,
        percent,
        completed,
    }
}

#[derive(Deserialize)]
pub struct Beat {
    pub position: f64,
    pub duration: f64,
}

#[derive(FromRow)]
struct ProgressRow {
    watched_seconds: f64,
    duration_seconds: Option<f64>,
    last_position: f64,
    last_beat_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
}

/// Siswa melaporkan posisi pemutar. Hanya siswa di kelas penugasan yang boleh.
pub async fn beat(
    State(st): State<AppState>,
    user: AuthUser,
    Path(material_id): Path<Uuid>,
    Json(input): Json<Beat>,
) -> AppResult<Json<ProgressView>> {
    require_role(&user, &[Role::Siswa])?;
    let (assignment_id, youtube_id): (Uuid, Option<String>) = sqlx::query_as(
        "SELECT assignment_id, youtube_id FROM lms_materials WHERE id = ? AND school_id = ?",
    )
    .bind(material_id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    if youtube_id.is_none() {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "material",
            "materi ini bukan video",
        )]));
    }
    let student = room_scope(&st.pool, &user, assignment_id)
        .await?
        .student_id
        .ok_or(AppError::Forbidden)?;

    if !input.position.is_finite() || input.position < 0.0 {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "position",
            "posisi tidak valid",
        )]));
    }
    if !input.duration.is_finite() || input.duration <= 0.0 || input.duration > 86_400.0 {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "duration",
            "durasi video tidak valid",
        )]));
    }

    let prev: Option<ProgressRow> = sqlx::query_as(
        "SELECT watched_seconds, duration_seconds, last_position, last_beat_at, completed_at \
         FROM lms_video_progress WHERE material_id = ? AND student_id = ?",
    )
    .bind(material_id)
    .bind(student)
    .fetch_optional(&st.pool)
    .await?;

    let now = Utc::now();
    let (prev_watched, prev_pos, elapsed, prev_completed) = match &prev {
        Some(p) => (
            p.watched_seconds,
            p.last_position,
            p.last_beat_at
                .map(|t| (now - t).num_milliseconds() as f64 / 1000.0)
                .unwrap_or(0.0),
            p.completed_at,
        ),
        None => (0.0, 0.0, 0.0, None),
    };

    let duration = input.duration;
    let gained = credit(prev_pos, input.position, elapsed);
    let watched = (prev_watched + gained).min(duration);
    let completed = watched >= duration - COMPLETE_TOLERANCE;
    let completed_at = prev_completed.or(if completed { Some(now) } else { None });

    sqlx::query(
        "INSERT INTO lms_video_progress \
         (material_id, student_id, school_id, watched_seconds, duration_seconds, last_position, last_beat_at, completed_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new \
         ON DUPLICATE KEY UPDATE watched_seconds = new.watched_seconds, duration_seconds = new.duration_seconds, \
             last_position = new.last_position, last_beat_at = new.last_beat_at, completed_at = new.completed_at",
    )
    .bind(material_id)
    .bind(student)
    .bind(user.school_id)
    .bind(watched)
    .bind(duration)
    .bind(input.position)
    .bind(now)
    .bind(completed_at)
    .execute(&st.pool)
    .await?;

    Ok(Json(view(watched, Some(duration), completed_at.is_some())))
}

/// Progres milik siswa yang login untuk satu materi video.
pub async fn mine(
    State(st): State<AppState>,
    user: AuthUser,
    Path(material_id): Path<Uuid>,
) -> AppResult<Json<ProgressView>> {
    require_role(&user, &[Role::Siswa])?;
    let assignment_id: Uuid = sqlx::query_scalar(
        "SELECT assignment_id FROM lms_materials WHERE id = ? AND school_id = ? AND youtube_id IS NOT NULL",
    )
    .bind(material_id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    let student = room_scope(&st.pool, &user, assignment_id)
        .await?
        .student_id
        .ok_or(AppError::Forbidden)?;

    let row: Option<ProgressRow> = sqlx::query_as(
        "SELECT watched_seconds, duration_seconds, last_position, last_beat_at, completed_at \
         FROM lms_video_progress WHERE material_id = ? AND student_id = ?",
    )
    .bind(material_id)
    .bind(student)
    .fetch_optional(&st.pool)
    .await?;
    Ok(Json(match row {
        Some(p) => view(
            p.watched_seconds,
            p.duration_seconds,
            p.completed_at.is_some(),
        ),
        None => view(0.0, None, false),
    }))
}

/// (materi, judul, siswa, nama siswa, detik ditonton, durasi, selesai)
type SummaryRow = (Uuid, String, Uuid, String, f64, Option<f64>, bool);

#[derive(Serialize)]
pub struct MaterialProgress {
    pub material_id: Uuid,
    pub title: String,
    pub enrolled: i64,
    pub completed: i64,
    pub students: Vec<StudentProgressView>,
}

#[derive(Serialize)]
pub struct StudentProgressView {
    pub student_id: Uuid,
    pub student_name: String,
    pub percent: f64,
    pub completed: bool,
}

/// Rekap progres semua video di ruang kelas, untuk guru pengampu dan admin.
pub async fn room_summary(
    State(st): State<AppState>,
    user: AuthUser,
    Path(room_id): Path<Uuid>,
) -> AppResult<Json<Vec<MaterialProgress>>> {
    if !room_scope(&st.pool, &user, room_id).await?.manage {
        return Err(AppError::Forbidden);
    }
    let rows: Vec<SummaryRow> = sqlx::query_as(
        "SELECT m.id, m.title, s.id, s.name, \
                COALESCE(p.watched_seconds, 0), p.duration_seconds, p.completed_at IS NOT NULL \
         FROM lms_materials m \
         JOIN teaching_assignments a ON a.id = m.assignment_id \
         JOIN class_enrollments e ON e.class_id = a.class_id AND e.school_id = m.school_id \
         JOIN students s ON s.id = e.student_id \
         LEFT JOIN lms_video_progress p ON p.material_id = m.id AND p.student_id = s.id \
         WHERE m.assignment_id = ? AND m.school_id = ? AND m.youtube_id IS NOT NULL \
         ORDER BY m.created_at DESC, s.name",
    )
    .bind(room_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;

    let mut out: Vec<MaterialProgress> = Vec::new();
    for (material_id, title, student_id, student_name, watched, duration, completed) in rows {
        let percent = view(watched, duration, completed).percent;
        if out.last().map(|m| m.material_id) != Some(material_id) {
            out.push(MaterialProgress {
                material_id,
                title,
                enrolled: 0,
                completed: 0,
                students: Vec::new(),
            });
        }
        let m = out.last_mut().expect("baru saja ditambahkan");
        m.enrolled += 1;
        if completed {
            m.completed += 1;
        }
        m.students.push(StudentProgressView {
            student_id,
            student_name,
            percent,
            completed,
        });
    }
    Ok(Json(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_playback_is_credited() {
        assert_eq!(credit(10.0, 20.0, 10.0), 10.0);
    }

    #[test]
    fn credit_is_capped_per_beat() {
        assert_eq!(credit(0.0, 120.0, 120.0), MAX_CREDIT_PER_BEAT);
    }

    #[test]
    fn seek_forward_is_not_credited() {
        // Posisi melompat 300 detik padahal hanya 10 detik waktu nyata berlalu.
        assert_eq!(credit(10.0, 310.0, 10.0), 0.0);
    }

    #[test]
    fn paused_video_is_not_credited() {
        assert_eq!(credit(50.0, 50.0, 30.0), 0.0);
    }

    #[test]
    fn buffering_credits_only_what_played() {
        assert_eq!(credit(10.0, 14.0, 10.0), 4.0);
    }

    #[test]
    fn youtube_links_are_parsed() {
        let id = "dQw4w9WgXcQ";
        assert_eq!(
            parse_youtube_id(&format!("https://www.youtube.com/watch?v={id}")),
            Some(id.into())
        );
        assert_eq!(
            parse_youtube_id(&format!(
                "https://www.youtube.com/watch?feature=share&v={id}&t=10"
            )),
            Some(id.into())
        );
        assert_eq!(
            parse_youtube_id(&format!("https://youtu.be/{id}?si=abc")),
            Some(id.into())
        );
        assert_eq!(
            parse_youtube_id(&format!("https://youtube.com/embed/{id}")),
            Some(id.into())
        );
        assert_eq!(
            parse_youtube_id(&format!("https://m.youtube.com/shorts/{id}")),
            Some(id.into())
        );
        assert_eq!(
            parse_youtube_id("https://example.com/watch?v=dQw4w9WgXcQ"),
            None
        );
        assert_eq!(
            parse_youtube_id("https://www.youtube.com/watch?v=short"),
            None
        );
        assert_eq!(parse_youtube_id(""), None);
    }
}
