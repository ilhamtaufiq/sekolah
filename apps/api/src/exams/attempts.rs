//! Sisi siswa: daftar ujian, mulai, autosave jawaban, jejak kejadian, dan submit.
//! Semua keputusan waktu diambil server. Klien hanya menampilkan sisa waktu.

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlPool};
use uuid::Uuid;

use super::{
    manage::recalc_attempt,
    questions::QuestionOption,
    rules::{accepts_answers, deadline_for, in_window, pg_points},
    student_id_for,
};
use crate::{
    auth::{AuthUser, Role, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
};

const STUDENT_ROLES: &[Role] = &[Role::Siswa];
const EVENT_KINDS: &[&str] = &["blur", "focus", "hidden", "visible"];

#[derive(Serialize, FromRow)]
pub struct StudentExamRow {
    pub exam_id: Uuid,
    pub title: String,
    pub subject_name: String,
    pub class_name: String,
    pub duration_minutes: u32,
    pub window_start: DateTime<Utc>,
    pub window_end: DateTime<Utc>,
    #[sqlx(skip)]
    pub token_required: bool,
    pub question_count: i64,
    pub attempt_id: Option<Uuid>,
    pub attempt_status: Option<String>,
}

#[derive(Deserialize)]
pub struct StartInput {
    pub token: Option<String>,
}

#[derive(Deserialize)]
pub struct AnswerInput {
    pub answer: Option<String>,
}

#[derive(Deserialize)]
pub struct EventInput {
    pub kind: String,
}

#[derive(Serialize)]
pub struct ViewQuestion {
    pub question_id: Uuid,
    pub position: u32,
    pub kind: String,
    pub body: String,
    pub points: u32,
    pub options: Option<Vec<QuestionOption>>,
    pub answer: Option<String>,
}

#[derive(Serialize)]
pub struct AttemptView {
    pub attempt_id: Uuid,
    pub exam_id: Uuid,
    pub title: String,
    pub duration_minutes: u32,
    pub status: String,
    pub started_at: DateTime<Utc>,
    pub deadline: DateTime<Utc>,
    pub submitted_at: Option<DateTime<Utc>>,
    /// Hanya tampil setelah semua jawaban dinilai. Kunci jawaban tidak pernah dikirim ke siswa.
    pub score: Option<u32>,
    pub server_now: DateTime<Utc>,
    pub questions: Vec<ViewQuestion>,
}

#[derive(FromRow)]
struct AttemptState {
    id: Uuid,
    exam_id: Uuid,
    status: String,
    started_at: DateTime<Utc>,
    deadline: DateTime<Utc>,
    submitted_at: Option<DateTime<Utc>>,
    score: Option<u32>,
    graded: bool,
    question_order: serde_json::Value,
    option_order: serde_json::Value,
}

#[derive(FromRow)]
struct ExamSettings {
    title: String,
    duration_minutes: u32,
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
    token: Option<String>,
    status: String,
    shuffle_questions: bool,
    shuffle_options: bool,
    grace_seconds: u32,
}

fn shuffled<T: Clone>(items: &[T], enabled: bool) -> Vec<T> {
    let mut v = items.to_vec();
    if enabled {
        v.shuffle(&mut rand::rng());
    }
    v
}

async fn exam_settings(pool: &MySqlPool, exam_id: Uuid) -> AppResult<ExamSettings> {
    sqlx::query_as(
        "SELECT title, duration_minutes, window_start, window_end, token, status, \
         shuffle_questions, shuffle_options, grace_seconds FROM exams WHERE id = ?",
    )
    .bind(exam_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Pastikan siswa terdaftar di kelas penugasan paket. Tanpa itu, paket dianggap tidak ada.
async fn ensure_enrolled(pool: &MySqlPool, student_id: Uuid, exam_id: Uuid) -> AppResult<()> {
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM exams e \
         JOIN teaching_assignments ta ON ta.id = e.assignment_id \
         JOIN class_enrollments ce ON ce.class_id = ta.class_id AND ce.student_id = ? \
         WHERE e.id = ?",
    )
    .bind(student_id)
    .bind(exam_id)
    .fetch_optional(pool)
    .await?;
    found.map(|_| ()).ok_or(AppError::NotFound)
}

async fn load_attempt(
    pool: &MySqlPool,
    attempt_id: Uuid,
    student_id: Uuid,
) -> AppResult<AttemptState> {
    sqlx::query_as(
        "SELECT id, exam_id, status, started_at, deadline, submitted_at, score, graded, question_order, option_order \
         FROM exam_attempts WHERE id = ? AND student_id = ?",
    )
    .bind(attempt_id)
    .bind(student_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Menutup percobaan dan menilai PG. Jawaban esai yang terisi menunggu penilaian guru.
/// Dipanggil saat submit, saat waktu habis, atau saat siswa membuka percobaan yang sudah lewat batas.
async fn finalize(
    pool: &MySqlPool,
    attempt_id: Uuid,
    exam_id: Uuid,
    status: &str,
    at: DateTime<Utc>,
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    let current: Option<String> =
        sqlx::query_scalar("SELECT status FROM exam_attempts WHERE id = ? FOR UPDATE")
            .bind(attempt_id)
            .fetch_optional(&mut *tx)
            .await?;
    if current.as_deref() != Some("in_progress") {
        return Ok(());
    }

    let questions: Vec<(Uuid, String, u32, Option<String>)> = sqlx::query_as(
        "SELECT eq.question_id, q.kind, eq.points, q.answer_key FROM exam_questions eq \
         JOIN questions q ON q.id = eq.question_id WHERE eq.exam_id = ?",
    )
    .bind(exam_id)
    .fetch_all(&mut *tx)
    .await?;
    let given: HashMap<Uuid, Option<String>> = sqlx::query_as::<_, (Uuid, Option<String>)>(
        "SELECT question_id, answer FROM attempt_answers WHERE attempt_id = ?",
    )
    .bind(attempt_id)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .collect();

    for (qid, kind, points, key) in questions {
        let answer = given.get(&qid).cloned().flatten();
        let filled = answer
            .as_deref()
            .map(str::trim)
            .is_some_and(|a| !a.is_empty());
        let score: Option<u32> = if kind == "pg" {
            Some(pg_points(
                answer.as_deref(),
                key.as_deref().unwrap_or(""),
                points,
            ))
        } else if filled {
            None // esai menunggu penilaian guru
        } else {
            Some(0)
        };
        sqlx::query(
            "INSERT INTO attempt_answers (attempt_id, question_id, answer, score) VALUES (?, ?, ?, ?) AS new \
             ON DUPLICATE KEY UPDATE score = new.score",
        )
        .bind(attempt_id)
        .bind(qid)
        .bind(&answer)
        .bind(score)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("UPDATE exam_attempts SET status = ?, submitted_at = ? WHERE id = ?")
        .bind(status)
        .bind(at)
        .bind(attempt_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    recalc_attempt(pool, attempt_id).await
}

/// Jika batas waktu + grace sudah lewat, tutup percobaan dengan status expired.
/// Mengembalikan status terbaru.
async fn settle(
    pool: &MySqlPool,
    attempt: &AttemptState,
    now: DateTime<Utc>,
    grace: u32,
) -> AppResult<String> {
    if attempt.status == "in_progress" && !accepts_answers(now, attempt.deadline, grace) {
        finalize(
            pool,
            attempt.id,
            attempt.exam_id,
            "expired",
            attempt.deadline,
        )
        .await?;
        return Ok("expired".to_string());
    }
    Ok(attempt.status.clone())
}

async fn build_view(
    pool: &MySqlPool,
    attempt: &AttemptState,
    title: &str,
    duration: u32,
) -> AppResult<AttemptView> {
    let now = Utc::now();
    let mut view = AttemptView {
        attempt_id: attempt.id,
        exam_id: attempt.exam_id,
        title: title.to_string(),
        duration_minutes: duration,
        status: attempt.status.clone(),
        started_at: attempt.started_at,
        deadline: attempt.deadline,
        submitted_at: attempt.submitted_at,
        score: if attempt.graded { attempt.score } else { None },
        server_now: now,
        questions: Vec::new(),
    };
    if attempt.status != "in_progress" {
        return Ok(view);
    }

    let rows: Vec<(Uuid, String, String, u32, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT q.id, q.kind, q.body, eq.points, q.options FROM exam_questions eq \
         JOIN questions q ON q.id = eq.question_id WHERE eq.exam_id = ?",
    )
    .bind(attempt.exam_id)
    .fetch_all(pool)
    .await?;
    let by_id: HashMap<Uuid, (String, String, u32, Option<serde_json::Value>)> = rows
        .into_iter()
        .map(|(id, k, b, p, o)| (id, (k, b, p, o)))
        .collect();

    let order: Vec<Uuid> = serde_json::from_value(attempt.question_order.clone())
        .map_err(|e| AppError::Internal(e.into()))?;
    let option_order: HashMap<String, Vec<String>> =
        serde_json::from_value(attempt.option_order.clone())
            .map_err(|e| AppError::Internal(e.into()))?;
    let answers: HashMap<Uuid, Option<String>> = sqlx::query_as::<_, (Uuid, Option<String>)>(
        "SELECT question_id, answer FROM attempt_answers WHERE attempt_id = ?",
    )
    .bind(attempt.id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();

    for (idx, qid) in order.iter().enumerate() {
        let Some((kind, body, points, options)) = by_id.get(qid) else {
            continue;
        };
        // Opsi ditampilkan sesuai urutan acak yang disimpan, tanpa kunci jawaban.
        let options: Option<Vec<QuestionOption>> = match (kind.as_str(), options) {
            ("pg", Some(raw)) => {
                let all: Vec<QuestionOption> = serde_json::from_value(raw.clone())
                    .map_err(|e| AppError::Internal(e.into()))?;
                let keys = option_order
                    .get(&qid.to_string())
                    .cloned()
                    .unwrap_or_default();
                Some(
                    keys.iter()
                        .filter_map(|k| all.iter().find(|o| &o.key == k).cloned())
                        .collect(),
                )
            }
            _ => None,
        };
        view.questions.push(ViewQuestion {
            question_id: *qid,
            position: (idx + 1) as u32,
            kind: kind.clone(),
            body: body.clone(),
            points: *points,
            options,
            answer: answers.get(qid).cloned().flatten(),
        });
    }
    Ok(view)
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Vec<StudentExamRow>>> {
    require_role(&user, STUDENT_ROLES)?;
    let student = student_id_for(&st.pool, &user).await?;
    let mut rows: Vec<StudentExamRow> = sqlx::query_as(
        "SELECT e.id AS exam_id, e.title, s.name AS subject_name, c.name AS class_name, e.duration_minutes, \
         e.window_start, e.window_end, \
         CAST((SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS SIGNED) AS question_count, \
         a.id AS attempt_id, a.status AS attempt_status \
         FROM exams e \
         JOIN teaching_assignments ta ON ta.id = e.assignment_id \
         JOIN classes c ON c.id = ta.class_id \
         JOIN subjects s ON s.id = ta.subject_id \
         JOIN class_enrollments ce ON ce.class_id = ta.class_id AND ce.student_id = ? \
         LEFT JOIN exam_attempts a ON a.exam_id = e.id AND a.student_id = ? \
         WHERE e.school_id = ? AND e.status = 'published' \
         ORDER BY e.window_start DESC",
    )
    .bind(student)
    .bind(student)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;
    // Token tidak dikirim ke siswa. Hanya tanda bahwa token diperlukan.
    let token_flags: Vec<(Uuid, Option<String>)> =
        sqlx::query_as("SELECT id, token FROM exams WHERE school_id = ? AND status = 'published'")
            .bind(user.school_id)
            .fetch_all(&st.pool)
            .await?;
    for row in &mut rows {
        row.token_required = token_flags
            .iter()
            .any(|(id, token)| *id == row.exam_id && token.is_some());
    }
    Ok(Json(rows))
}

pub async fn start(
    State(st): State<AppState>,
    user: AuthUser,
    Path(exam_id): Path<Uuid>,
    Json(input): Json<StartInput>,
) -> AppResult<Json<AttemptView>> {
    require_role(&user, STUDENT_ROLES)?;
    let student = student_id_for(&st.pool, &user).await?;
    ensure_enrolled(&st.pool, student, exam_id).await?;
    let exam = exam_settings(&st.pool, exam_id).await?;
    let now = Utc::now();

    if exam.status != "published" {
        return Err(AppError::Conflict("ujian belum diterbitkan".to_string()));
    }

    // Percobaan yang sudah ada: lanjutkan bila masih berjalan, tolak bila sudah selesai.
    let existing: Option<AttemptState> = sqlx::query_as(
        "SELECT id, exam_id, status, started_at, deadline, submitted_at, score, graded, question_order, option_order \
         FROM exam_attempts WHERE exam_id = ? AND student_id = ?",
    )
    .bind(exam_id)
    .bind(student)
    .fetch_optional(&st.pool)
    .await?;
    if let Some(attempt) = existing {
        let status = settle(&st.pool, &attempt, now, exam.grace_seconds).await?;
        if status == "in_progress" {
            let fresh = load_attempt(&st.pool, attempt.id, student).await?;
            return Ok(Json(
                build_view(&st.pool, &fresh, &exam.title, exam.duration_minutes).await?,
            ));
        }
        return Err(AppError::Conflict("ujian ini sudah dikerjakan".to_string()));
    }

    if !in_window(now, exam.window_start, exam.window_end) {
        return Err(AppError::Conflict(
            "ujian belum dibuka atau sudah ditutup".to_string(),
        ));
    }
    if let Some(expected) = &exam.token {
        match input.token.as_deref().map(str::trim) {
            None | Some("") => return Err(AppError::Forbidden),
            Some(given) if given != expected => return Err(AppError::Forbidden),
            _ => {}
        }
    }

    let questions: Vec<(Uuid, String, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT q.id, q.kind, q.options FROM exam_questions eq JOIN questions q ON q.id = eq.question_id \
         WHERE eq.exam_id = ? ORDER BY eq.position",
    )
    .bind(exam_id)
    .fetch_all(&st.pool)
    .await?;
    if questions.is_empty() {
        return Err(AppError::Conflict("ujian belum punya soal".to_string()));
    }

    let ids: Vec<Uuid> = questions.iter().map(|q| q.0).collect();
    let order = shuffled(&ids, exam.shuffle_questions);
    let mut option_order: HashMap<String, Vec<String>> = HashMap::new();
    for (qid, kind, raw) in &questions {
        if kind == "pg" {
            let opts: Vec<QuestionOption> = raw
                .clone()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| AppError::Internal(e.into()))?
                .unwrap_or_default();
            let keys: Vec<String> = opts.into_iter().map(|o| o.key).collect();
            option_order.insert(qid.to_string(), shuffled(&keys, exam.shuffle_options));
        }
    }

    let deadline = deadline_for(now, exam.duration_minutes, exam.window_end);
    let attempt_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO exam_attempts (id, school_id, exam_id, student_id, started_at, deadline, status, question_order, option_order) \
         VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, ?)",
    )
    .bind(attempt_id)
    .bind(user.school_id)
    .bind(exam_id)
    .bind(student)
    .bind(now)
    .bind(deadline)
    .bind(serde_json::to_value(&order).map_err(|e| AppError::Internal(e.into()))?)
    .bind(serde_json::to_value(&option_order).map_err(|e| AppError::Internal(e.into()))?)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "ujian ini sudah dimulai"))?;

    let fresh = load_attempt(&st.pool, attempt_id, student).await?;
    Ok(Json(
        build_view(&st.pool, &fresh, &exam.title, exam.duration_minutes).await?,
    ))
}

pub async fn get_attempt(
    State(st): State<AppState>,
    user: AuthUser,
    Path(attempt_id): Path<Uuid>,
) -> AppResult<Json<AttemptView>> {
    require_role(&user, STUDENT_ROLES)?;
    let student = student_id_for(&st.pool, &user).await?;
    let mut attempt = load_attempt(&st.pool, attempt_id, student).await?;
    let exam = exam_settings(&st.pool, attempt.exam_id).await?;
    let status = settle(&st.pool, &attempt, Utc::now(), exam.grace_seconds).await?;
    if status != attempt.status {
        attempt = load_attempt(&st.pool, attempt_id, student).await?;
    }
    Ok(Json(
        build_view(&st.pool, &attempt, &exam.title, exam.duration_minutes).await?,
    ))
}

pub async fn save_answer(
    State(st): State<AppState>,
    user: AuthUser,
    Path((attempt_id, question_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<AnswerInput>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, STUDENT_ROLES)?;
    let student = student_id_for(&st.pool, &user).await?;
    let attempt = load_attempt(&st.pool, attempt_id, student).await?;
    let exam = exam_settings(&st.pool, attempt.exam_id).await?;
    let now = Utc::now();

    if attempt.status != "in_progress" {
        return Err(AppError::Conflict("percobaan sudah selesai".to_string()));
    }
    if !accepts_answers(now, attempt.deadline, exam.grace_seconds) {
        settle(&st.pool, &attempt, now, exam.grace_seconds).await?;
        return Err(AppError::Conflict("waktu ujian sudah habis".to_string()));
    }

    let kind_opts: Option<(String, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT q.kind, q.options FROM exam_questions eq JOIN questions q ON q.id = eq.question_id \
         WHERE eq.exam_id = ? AND eq.question_id = ?",
    )
    .bind(attempt.exam_id)
    .bind(question_id)
    .fetch_optional(&st.pool)
    .await?;
    let (kind, options) = kind_opts.ok_or_else(|| {
        AppError::Validation(vec![FieldIssue::new(
            "question_id",
            "soal tidak ada di ujian ini",
        )])
    })?;

    let answer = input
        .answer
        .as_deref()
        .map(str::trim)
        .filter(|a| !a.is_empty())
        .map(|a| {
            if kind == "pg" {
                a.to_uppercase()
            } else {
                a.to_string()
            }
        });
    if let (true, Some(a)) = (kind == "pg", &answer) {
        let opts: Vec<QuestionOption> = options
            .map(serde_json::from_value)
            .transpose()
            .map_err(|e| AppError::Internal(e.into()))?
            .unwrap_or_default();
        if !opts.iter().any(|o| &o.key == a) {
            return Err(AppError::Validation(vec![FieldIssue::new(
                "answer",
                "pilihan tidak tersedia",
            )]));
        }
    }
    if answer.as_ref().is_some_and(|a| a.chars().count() > 10_000) {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "answer",
            "jawaban terlalu panjang",
        )]));
    }

    sqlx::query(
        "INSERT INTO attempt_answers (attempt_id, question_id, answer) VALUES (?, ?, ?) AS new \
         ON DUPLICATE KEY UPDATE answer = new.answer, updated_at = UTC_TIMESTAMP(6)",
    )
    .bind(attempt_id)
    .bind(question_id)
    .bind(&answer)
    .execute(&st.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "saved_at": now,
        "deadline": attempt.deadline,
        "server_now": now,
    })))
}

pub async fn record_event(
    State(st): State<AppState>,
    user: AuthUser,
    Path(attempt_id): Path<Uuid>,
    Json(input): Json<EventInput>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, STUDENT_ROLES)?;
    let student = student_id_for(&st.pool, &user).await?;
    let attempt = load_attempt(&st.pool, attempt_id, student).await?;
    if attempt.status != "in_progress" {
        return Err(AppError::Conflict("percobaan sudah selesai".to_string()));
    }
    if !EVENT_KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "kind",
            "jenis kejadian tidak dikenal",
        )]));
    }
    sqlx::query("INSERT INTO exam_events (attempt_id, kind) VALUES (?, ?)")
        .bind(attempt_id)
        .bind(&input.kind)
        .execute(&st.pool)
        .await?;
    Ok(Json(serde_json::json!({ "recorded": true })))
}

pub async fn submit(
    State(st): State<AppState>,
    user: AuthUser,
    Path(attempt_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, STUDENT_ROLES)?;
    let student = student_id_for(&st.pool, &user).await?;
    let attempt = load_attempt(&st.pool, attempt_id, student).await?;
    let exam = exam_settings(&st.pool, attempt.exam_id).await?;
    let now = Utc::now();

    if attempt.status != "in_progress" {
        return Err(AppError::Conflict("percobaan sudah selesai".to_string()));
    }
    if !accepts_answers(now, attempt.deadline, exam.grace_seconds) {
        settle(&st.pool, &attempt, now, exam.grace_seconds).await?;
        return Err(AppError::Conflict(
            "waktu ujian sudah habis, jawaban tidak diterima".to_string(),
        ));
    }

    finalize(&st.pool, attempt_id, attempt.exam_id, "submitted", now).await?;
    let done = load_attempt(&st.pool, attempt_id, student).await?;
    Ok(Json(serde_json::json!({
        "status": done.status,
        "submitted_at": done.submitted_at,
        "score": if done.graded { done.score } else { None },
        "graded": done.graded,
    })))
}
