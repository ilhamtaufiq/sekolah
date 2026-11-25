//! Paket ujian dari sisi guru/admin: buat, susun soal, terbitkan, pantau, nilai esai, analisis.

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlPool};
use uuid::Uuid;

use super::{
    TEACH_ROLES,
    questions::QuestionOption,
    rules::{AttemptResult, item_analysis},
};
use crate::{
    auth::{AuthUser, Role, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
    validate::Validator,
};

#[derive(Serialize, FromRow)]
pub struct ExamRow {
    pub id: Uuid,
    pub assignment_id: Uuid,
    pub class_id: Uuid,
    pub class_name: String,
    pub subject_id: Uuid,
    pub subject_name: String,
    pub title: String,
    pub duration_minutes: u32,
    pub window_start: DateTime<Utc>,
    pub window_end: DateTime<Utc>,
    pub shuffle_questions: bool,
    pub shuffle_options: bool,
    pub token: Option<String>,
    pub status: String,
    pub question_count: i64,
    pub total_points: i64,
}

#[derive(Deserialize)]
pub struct ExamFilter {
    pub assignment_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct ExamInput {
    pub assignment_id: Uuid,
    pub title: String,
    pub duration_minutes: u32,
    pub window_start: DateTime<Utc>,
    pub window_end: DateTime<Utc>,
    pub shuffle_questions: bool,
    pub shuffle_options: bool,
    pub token: Option<String>,
}

#[derive(Deserialize)]
pub struct QuestionListInput {
    pub question_ids: Vec<Uuid>,
}

#[derive(Serialize)]
pub struct ExamQuestion {
    pub question_id: Uuid,
    pub position: u32,
    pub kind: String,
    pub body: String,
    pub points: u32,
    pub options: Option<Vec<QuestionOption>>,
    pub answer_key: Option<String>,
}

/// Baris soal paket untuk tampilan guru: (posisi, id, jenis, isi, poin, opsi, kunci).
type QuestionDetailRow = (
    u32,
    Uuid,
    String,
    String,
    u32,
    Option<serde_json::Value>,
    Option<String>,
);

#[derive(Serialize)]
pub struct ExamDetail {
    #[serde(flatten)]
    pub exam: ExamRow,
    pub questions: Vec<ExamQuestion>,
}

#[derive(Serialize, FromRow)]
pub struct AttemptRow {
    pub attempt_id: Uuid,
    pub student_id: Uuid,
    pub student_name: String,
    pub nis: String,
    pub status: String,
    pub started_at: DateTime<Utc>,
    pub deadline: DateTime<Utc>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub score: Option<u32>,
    pub graded: bool,
    pub events: i64,
    pub pending_essays: i64,
}

#[derive(Serialize)]
pub struct ItemStatOut {
    pub question_id: Uuid,
    pub position: u32,
    pub kind: String,
    pub attempts: usize,
    pub difficulty: Option<f64>,
    pub discrimination: Option<f64>,
}

#[derive(Serialize)]
pub struct Analysis {
    pub attempts: usize,
    /// Benar bila jendela ujian belum selesai: angka masih bisa berubah.
    pub provisional: bool,
    pub items: Vec<ItemStatOut>,
}

#[derive(Deserialize)]
pub struct EssayScoreInput {
    pub score: u32,
}

/// Admin, atau guru pengampu penugasan paket ini.
async fn load_for_teacher(pool: &MySqlPool, user: &AuthUser, exam_id: Uuid) -> AppResult<ExamRow> {
    let sql_row: ExamRow = sqlx::query_as(
        "SELECT e.id, e.assignment_id, ta.class_id, c.name AS class_name, s.id AS subject_id, s.name AS subject_name, \
         e.title, e.duration_minutes, e.window_start, e.window_end, e.shuffle_questions, e.shuffle_options, e.token, e.status, \
         CAST((SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS SIGNED) AS question_count, \
         CAST(COALESCE((SELECT SUM(eq.points) FROM exam_questions eq WHERE eq.exam_id = e.id), 0) AS SIGNED) AS total_points \
         FROM exams e \
         JOIN teaching_assignments ta ON ta.id = e.assignment_id \
         JOIN classes c ON c.id = ta.class_id \
         JOIN subjects s ON s.id = ta.subject_id \
         WHERE e.id = ? AND e.school_id = ?",
    )
    .bind(exam_id)
    .bind(user.school_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;

    if user.role != Role::Admin {
        let teacher: Option<Uuid> =
            sqlx::query_scalar("SELECT teacher_id FROM teaching_assignments WHERE id = ?")
                .bind(sql_row.assignment_id)
                .fetch_optional(pool)
                .await?;
        if teacher != Some(user.user_id) {
            return Err(AppError::Forbidden);
        }
    }
    Ok(sql_row)
}

/// Validasi jadwal dan token. Mengembalikan judul dan token yang sudah dibersihkan.
fn validate(input: &ExamInput) -> AppResult<(String, Option<String>)> {
    let mut v = Validator::new();
    let title = v.text("title", &input.title, 3, 200);
    v.require(
        (1..=600).contains(&input.duration_minutes),
        "duration_minutes",
        "durasi 1–600 menit",
    );
    v.require(
        input.window_end > input.window_start,
        "window_end",
        "akhir jendela harus setelah mulai",
    );
    let token = v.opt_text("token", input.token.as_deref(), 20);
    if let Some(t) = &token {
        v.require(
            t.chars().all(|c| c.is_ascii_alphanumeric()) && t.len() >= 4,
            "token",
            "token 4–20 karakter huruf atau angka",
        );
    }
    v.finish()?;
    Ok((title, token))
}

async fn ensure_assignment(
    pool: &MySqlPool,
    user: &AuthUser,
    assignment_id: Uuid,
) -> AppResult<()> {
    let teacher: Option<Uuid> = sqlx::query_scalar(
        "SELECT teacher_id FROM teaching_assignments WHERE id = ? AND school_id = ?",
    )
    .bind(assignment_id)
    .bind(user.school_id)
    .fetch_optional(pool)
    .await?;
    match teacher {
        None => Err(AppError::Validation(vec![FieldIssue::new(
            "assignment_id",
            "penugasan tidak ditemukan",
        )])),
        Some(t) if user.role == Role::Admin || t == user.user_id => Ok(()),
        Some(_) => Err(AppError::Forbidden),
    }
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    axum::extract::Query(f): axum::extract::Query<ExamFilter>,
) -> AppResult<Json<Vec<ExamRow>>> {
    require_role(&user, TEACH_ROLES)?;
    let rows: Vec<ExamRow> = sqlx::query_as(
        "SELECT e.id, e.assignment_id, ta.class_id, c.name AS class_name, s.id AS subject_id, s.name AS subject_name, \
         e.title, e.duration_minutes, e.window_start, e.window_end, e.shuffle_questions, e.shuffle_options, e.token, e.status, \
         CAST((SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS SIGNED) AS question_count, \
         CAST(COALESCE((SELECT SUM(eq.points) FROM exam_questions eq WHERE eq.exam_id = e.id), 0) AS SIGNED) AS total_points \
         FROM exams e \
         JOIN teaching_assignments ta ON ta.id = e.assignment_id \
         JOIN classes c ON c.id = ta.class_id \
         JOIN subjects s ON s.id = ta.subject_id \
         WHERE e.school_id = ? AND (? IS NULL OR e.assignment_id = ?) \
           AND (? = 'admin' OR ta.teacher_id = ?) \
         ORDER BY e.window_start DESC \
         LIMIT 200",
    )
    .bind(user.school_id)
    .bind(f.assignment_id)
    .bind(f.assignment_id)
    .bind(if user.role == Role::Admin { "admin" } else { "" })
    .bind(user.user_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<ExamInput>,
) -> AppResult<Json<ExamRow>> {
    require_role(&user, TEACH_ROLES)?;
    let (title, token) = validate(&input)?;
    ensure_assignment(&st.pool, &user, input.assignment_id).await?;

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO exams (id, school_id, assignment_id, title, duration_minutes, window_start, window_end, \
         shuffle_questions, shuffle_options, token, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(input.assignment_id)
    .bind(&title)
    .bind(input.duration_minutes)
    .bind(input.window_start)
    .bind(input.window_end)
    .bind(input.shuffle_questions)
    .bind(input.shuffle_options)
    .bind(&token)
    .bind(user.user_id)
    .execute(&st.pool)
    .await?;

    Ok(Json(load_for_teacher(&st.pool, &user, id).await?))
}

pub async fn get(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ExamDetail>> {
    require_role(&user, TEACH_ROLES)?;
    let exam = load_for_teacher(&st.pool, &user, id).await?;
    let rows: Vec<QuestionDetailRow> = sqlx::query_as(
        "SELECT eq.position, q.id, q.kind, q.body, eq.points, q.options, q.answer_key \
         FROM exam_questions eq JOIN questions q ON q.id = eq.question_id \
         WHERE eq.exam_id = ? ORDER BY eq.position",
    )
    .bind(id)
    .fetch_all(&st.pool)
    .await?;

    let questions = rows
        .into_iter()
        .map(
            |(position, question_id, kind, body, points, options, answer_key)| {
                Ok(ExamQuestion {
                    question_id,
                    position,
                    kind,
                    body,
                    points,
                    options: options
                        .map(serde_json::from_value)
                        .transpose()
                        .map_err(|e| AppError::Internal(e.into()))?,
                    answer_key,
                })
            },
        )
        .collect::<AppResult<Vec<_>>>()?;

    Ok(Json(ExamDetail { exam, questions }))
}

pub async fn update(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<ExamInput>,
) -> AppResult<Json<ExamRow>> {
    require_role(&user, TEACH_ROLES)?;
    let current = load_for_teacher(&st.pool, &user, id).await?;
    if current.status != "draft" {
        return Err(AppError::Conflict(
            "paket yang sudah terbit tidak bisa diubah".to_string(),
        ));
    }
    let (title, token) = validate(&input)?;
    ensure_assignment(&st.pool, &user, input.assignment_id).await?;

    sqlx::query(
        "UPDATE exams SET assignment_id = ?, title = ?, duration_minutes = ?, window_start = ?, window_end = ?, \
         shuffle_questions = ?, shuffle_options = ?, token = ? WHERE id = ? AND school_id = ? AND status = 'draft'",
    )
    .bind(input.assignment_id)
    .bind(&title)
    .bind(input.duration_minutes)
    .bind(input.window_start)
    .bind(input.window_end)
    .bind(input.shuffle_questions)
    .bind(input.shuffle_options)
    .bind(&token)
    .bind(id)
    .bind(user.school_id)
    .execute(&st.pool)
    .await?;

    Ok(Json(load_for_teacher(&st.pool, &user, id).await?))
}

/// Mengganti daftar soal paket (hanya draf). Poin disalin dari bank soal saat ini.
pub async fn set_questions(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<QuestionListInput>,
) -> AppResult<Json<ExamDetail>> {
    require_role(&user, TEACH_ROLES)?;
    let exam = load_for_teacher(&st.pool, &user, id).await?;
    if exam.status != "draft" {
        return Err(AppError::Conflict(
            "soal paket yang sudah terbit tidak bisa diubah".to_string(),
        ));
    }

    let ids = input.question_ids.clone();
    let unique: std::collections::HashSet<Uuid> = ids.iter().copied().collect();
    if unique.len() != ids.len() {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "question_ids",
            "soal tidak boleh ganda",
        )]));
    }
    if ids.is_empty() || ids.len() > 200 {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "question_ids",
            "paket butuh 1–200 soal",
        )]));
    }

    // Semua soal harus milik sekolah ini dan mapel penugasan paket.
    let subject_id: Uuid =
        sqlx::query_scalar("SELECT subject_id FROM teaching_assignments WHERE id = ?")
            .bind(exam.assignment_id)
            .fetch_one(&st.pool)
            .await?;
    let mut tx = st.pool.begin().await?;
    let mut points: Vec<(Uuid, u32)> = Vec::new();
    for qid in &ids {
        let row: Option<(Uuid, u32)> = sqlx::query_as(
            "SELECT subject_id, points FROM questions WHERE id = ? AND school_id = ?",
        )
        .bind(qid)
        .bind(user.school_id)
        .fetch_optional(&mut *tx)
        .await?;
        match row {
            Some((sid, pts)) if sid == subject_id => points.push((*qid, pts)),
            _ => {
                return Err(AppError::Validation(vec![FieldIssue::new(
                    "question_ids",
                    format!("soal {qid} tidak ditemukan atau bukan mapel penugasan ini"),
                )]));
            }
        }
    }

    sqlx::query("DELETE FROM exam_questions WHERE exam_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for (pos, (qid, pts)) in points.iter().enumerate() {
        sqlx::query("INSERT INTO exam_questions (id, exam_id, question_id, position, points) VALUES (?, ?, ?, ?, ?)")
            .bind(Uuid::new_v4())
            .bind(id)
            .bind(qid)
            .bind((pos + 1) as u32)
            .bind(pts)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    get(State(st), user, Path(id)).await
}

pub async fn publish(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ExamRow>> {
    require_role(&user, TEACH_ROLES)?;
    let exam = load_for_teacher(&st.pool, &user, id).await?;
    if exam.status != "draft" {
        return Err(AppError::Conflict("paket sudah diterbitkan".to_string()));
    }
    let mut v = Validator::new();
    v.require(
        exam.question_count >= 1,
        "questions",
        "tambahkan minimal satu soal sebelum menerbitkan",
    );
    v.require(
        exam.window_end > Utc::now(),
        "window_end",
        "jendela ujian sudah lewat",
    );
    v.finish()?;

    sqlx::query("UPDATE exams SET status = 'published', published_at = UTC_TIMESTAMP(6) WHERE id = ? AND school_id = ? AND status = 'draft'")
        .bind(id)
        .bind(user.school_id)
        .execute(&st.pool)
        .await?;
    Ok(Json(load_for_teacher(&st.pool, &user, id).await?))
}

pub async fn attempts(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<AttemptRow>>> {
    require_role(&user, TEACH_ROLES)?;
    load_for_teacher(&st.pool, &user, id).await?;
    let rows: Vec<AttemptRow> = sqlx::query_as(
        "SELECT a.id AS attempt_id, a.student_id, s.name AS student_name, s.nis, a.status, a.started_at, a.deadline, \
         a.submitted_at, a.score, a.graded, \
         CAST((SELECT COUNT(*) FROM exam_events ev WHERE ev.attempt_id = a.id) AS SIGNED) AS events, \
         CAST((SELECT COUNT(*) FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id \
               WHERE aa.attempt_id = a.id AND q.kind = 'esai' AND aa.score IS NULL) AS SIGNED) AS pending_essays \
         FROM exam_attempts a JOIN students s ON s.id = a.student_id \
         WHERE a.exam_id = ? ORDER BY s.name",
    )
    .bind(id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

/// Penilaian esai manual. Skor dibatasi poin soal, lalu total percobaan dihitung ulang.
pub async fn grade_essay(
    State(st): State<AppState>,
    user: AuthUser,
    Path((attempt_id, question_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<EssayScoreInput>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, TEACH_ROLES)?;
    let exam_id: Uuid =
        sqlx::query_scalar("SELECT exam_id FROM exam_attempts WHERE id = ? AND school_id = ?")
            .bind(attempt_id)
            .bind(user.school_id)
            .fetch_optional(&st.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    load_for_teacher(&st.pool, &user, exam_id).await?;

    let (kind, points): (String, u32) = sqlx::query_as(
        "SELECT q.kind, eq.points FROM exam_questions eq JOIN questions q ON q.id = eq.question_id \
         WHERE eq.exam_id = ? AND eq.question_id = ?",
    )
    .bind(exam_id)
    .bind(question_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let mut v = Validator::new();
    v.require(
        kind == "esai",
        "question_id",
        "hanya jawaban esai yang dinilai manual",
    );
    v.require(
        input.score <= points,
        "score",
        &format!("skor maksimal {points}"),
    );
    v.finish()?;

    let updated = sqlx::query(
        "UPDATE attempt_answers SET score = ? WHERE attempt_id = ? AND question_id = ?",
    )
    .bind(input.score)
    .bind(attempt_id)
    .bind(question_id)
    .execute(&st.pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "question_id",
            "siswa belum menjawab soal ini",
        )]));
    }

    recalc_attempt(&st.pool, attempt_id).await?;
    Ok(Json(serde_json::json!({ "score": input.score })))
}

/// Total = jumlah skor yang sudah ada. Graded = tidak ada esai terjawab yang belum dinilai.
pub async fn recalc_attempt(pool: &MySqlPool, attempt_id: Uuid) -> AppResult<()> {
    sqlx::query(
        "UPDATE exam_attempts a SET \
           score = (SELECT CAST(COALESCE(SUM(aa.score), 0) AS UNSIGNED) FROM attempt_answers aa WHERE aa.attempt_id = a.id), \
           graded = NOT EXISTS (SELECT 1 FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id \
                                WHERE aa.attempt_id = a.id AND q.kind = 'esai' AND aa.answer IS NOT NULL AND aa.score IS NULL) \
         WHERE a.id = ?",
    )
    .bind(attempt_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn analysis(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Analysis>> {
    require_role(&user, TEACH_ROLES)?;
    let exam = load_for_teacher(&st.pool, &user, id).await?;

    let questions: Vec<(Uuid, u32, String, u32)> = sqlx::query_as(
        "SELECT eq.question_id, eq.position, q.kind, eq.points FROM exam_questions eq \
         JOIN questions q ON q.id = eq.question_id WHERE eq.exam_id = ? ORDER BY eq.position",
    )
    .bind(id)
    .fetch_all(&st.pool)
    .await?;
    let points: std::collections::HashMap<Uuid, u32> =
        questions.iter().map(|q| (q.0, q.3)).collect();

    // Hanya percobaan yang sudah selesai atau kedaluwarsa dihitung.
    let attempts: Vec<(Uuid, Option<u32>)> = sqlx::query_as(
        "SELECT id, score FROM exam_attempts WHERE exam_id = ? AND status <> 'in_progress'",
    )
    .bind(id)
    .fetch_all(&st.pool)
    .await?;

    let answers: Vec<(Uuid, Uuid, Option<u32>)> = sqlx::query_as(
        "SELECT aa.attempt_id, aa.question_id, aa.score FROM attempt_answers aa \
         JOIN exam_attempts a ON a.id = aa.attempt_id WHERE a.exam_id = ? AND a.status <> 'in_progress'",
    )
    .bind(id)
    .fetch_all(&st.pool)
    .await?;

    let results: Vec<AttemptResult> = attempts
        .iter()
        .map(|(aid, total)| AttemptResult {
            total: i64::from(total.unwrap_or(0)),
            correct: questions
                .iter()
                .filter(|q| q.2 == "pg")
                .filter_map(|q| {
                    answers
                        .iter()
                        .find(|a| a.0 == *aid && a.1 == q.0)
                        .map(|a| (q.0, a.2 == points.get(&q.0).copied()))
                })
                .collect(),
        })
        .collect();

    let pg_ids: Vec<Uuid> = questions
        .iter()
        .filter(|q| q.2 == "pg")
        .map(|q| q.0)
        .collect();
    let stats = item_analysis(&results, &pg_ids);

    let items = questions
        .iter()
        .map(|q| {
            let stat = stats.iter().find(|s| s.question_id == q.0);
            ItemStatOut {
                question_id: q.0,
                position: q.1,
                kind: q.2.clone(),
                attempts: stat.map(|s| s.attempts).unwrap_or(0),
                difficulty: stat.and_then(|s| s.difficulty),
                discrimination: stat.and_then(|s| s.discrimination),
            }
        })
        .collect();

    Ok(Json(Analysis {
        attempts: attempts.len(),
        provisional: exam.window_end > Utc::now(),
        items,
    }))
}

#[derive(Serialize, FromRow)]
pub struct AttemptAnswerRow {
    pub question_id: Uuid,
    pub position: u32,
    pub kind: String,
    pub body: String,
    pub points: u32,
    pub answer: Option<String>,
    pub score: Option<u32>,
}

/// Jawaban satu percobaan untuk guru: dipakai untuk menilai esai.
pub async fn attempt_answers(
    State(st): State<AppState>,
    user: AuthUser,
    Path((exam_id, attempt_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<Vec<AttemptAnswerRow>>> {
    require_role(&user, TEACH_ROLES)?;
    load_for_teacher(&st.pool, &user, exam_id).await?;
    let rows: Vec<AttemptAnswerRow> = sqlx::query_as(
        "SELECT eq.question_id, eq.position, q.kind, q.body, eq.points, aa.answer, aa.score \
         FROM exam_attempts a \
         JOIN exam_questions eq ON eq.exam_id = a.exam_id \
         JOIN questions q ON q.id = eq.question_id \
         LEFT JOIN attempt_answers aa ON aa.attempt_id = a.id AND aa.question_id = eq.question_id \
         WHERE a.id = ? AND a.exam_id = ? \
         ORDER BY eq.position",
    )
    .bind(attempt_id)
    .bind(exam_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}
