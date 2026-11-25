use std::collections::HashSet;

use axum::{
    Json,
    extract::{Multipart, Path, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{FileView, load_files, room_scope, storage, task_assignment};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
    validate::Validator,
};

/// Batas teks jawaban siswa.
const MAX_TEXT_CHARS: usize = 20_000;

#[derive(Serialize, FromRow)]
pub struct Task {
    pub id: Uuid,
    pub title: String,
    pub instructions: Option<String>,
    pub due_at: DateTime<Utc>,
    pub max_score: f64,
    pub allow_late: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct TaskInput {
    pub title: String,
    pub instructions: Option<String>,
    pub due_at: DateTime<Utc>,
    pub max_score: f64,
    /// Terima pengumpulan setelah tenggat (ditandai terlambat).
    pub allow_late: bool,
}

#[derive(Serialize)]
pub struct SubmissionView {
    pub id: Uuid,
    pub student_id: Uuid,
    pub student_name: String,
    pub text_body: Option<String>,
    pub submitted_at: DateTime<Utc>,
    pub is_late: bool,
    pub score: Option<f64>,
    pub feedback: Option<String>,
    pub graded_at: Option<DateTime<Utc>>,
    pub files: Vec<FileView>,
}

#[derive(FromRow)]
struct SubRow {
    id: Uuid,
    student_id: Uuid,
    student_name: String,
    text_body: Option<String>,
    submitted_at: DateTime<Utc>,
    is_late: bool,
    score: Option<f64>,
    feedback: Option<String>,
    graded_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct TaskDetail {
    pub task: Task,
    /// Guru: semua pengumpulan. Siswa: kosong.
    pub submissions: Vec<SubmissionView>,
    /// Siswa: pengumpulan miliknya. Guru: kosong.
    pub own_submission: Option<SubmissionView>,
    pub manage: bool,
}

#[derive(Deserialize)]
pub struct GradeInput {
    pub score: f64,
    pub feedback: Option<String>,
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Path(room_id): Path<Uuid>,
) -> AppResult<Json<Vec<Task>>> {
    room_scope(&st.pool, &user, room_id).await?;
    let rows = sqlx::query_as(
        "SELECT id, title, instructions, due_at, max_score, allow_late, created_at \
         FROM lms_tasks WHERE assignment_id = ? AND school_id = ? ORDER BY due_at",
    )
    .bind(room_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Path(room_id): Path<Uuid>,
    Json(input): Json<TaskInput>,
) -> AppResult<Json<Task>> {
    if !room_scope(&st.pool, &user, room_id).await?.manage {
        return Err(AppError::Forbidden);
    }

    let mut v = Validator::new();
    let title = v.text("title", &input.title, 1, 200);
    let instructions = v.opt_text("instructions", input.instructions.as_deref(), 10_000);
    v.require(
        input.max_score > 0.0 && input.max_score <= 1000.0,
        "max_score",
        "nilai maksimum harus di atas 0 dan maksimal 1000",
    );
    v.finish()?;

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO lms_tasks (id, school_id, assignment_id, title, instructions, due_at, max_score, allow_late, created_by) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(room_id)
    .bind(&title)
    .bind(&instructions)
    .bind(input.due_at)
    .bind(input.max_score)
    .bind(input.allow_late)
    .bind(user.user_id)
    .execute(&st.pool)
    .await?;

    let task = load_task(&st.pool, user.school_id, id).await?;
    Ok(Json(task))
}

async fn load_task(pool: &sqlx::MySqlPool, school_id: Uuid, id: Uuid) -> AppResult<Task> {
    sqlx::query_as(
        "SELECT id, title, instructions, due_at, max_score, allow_late, created_at \
         FROM lms_tasks WHERE id = ? AND school_id = ?",
    )
    .bind(id)
    .bind(school_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

async fn submission_views(
    pool: &sqlx::MySqlPool,
    task_id: Uuid,
    student: Option<Uuid>,
) -> AppResult<Vec<SubmissionView>> {
    let rows: Vec<SubRow> = sqlx::query_as(
        "SELECT s.id, s.student_id, st.name AS student_name, s.text_body, s.submitted_at, s.is_late, \
                s.score, s.feedback, s.graded_at \
         FROM lms_submissions s JOIN students st ON st.id = s.student_id \
         WHERE s.task_id = ? AND (? IS NULL OR s.student_id = ?) ORDER BY st.name",
    )
    .bind(task_id)
    .bind(student)
    .bind(student)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let files = load_files(pool, "submission", r.id).await?;
        out.push(SubmissionView {
            id: r.id,
            student_id: r.student_id,
            student_name: r.student_name,
            text_body: r.text_body,
            submitted_at: r.submitted_at,
            is_late: r.is_late,
            score: r.score,
            feedback: r.feedback,
            graded_at: r.graded_at,
            files,
        });
    }
    Ok(out)
}

pub async fn detail(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<TaskDetail>> {
    let assignment = task_assignment(&st.pool, user.school_id, id).await?;
    let scope = room_scope(&st.pool, &user, assignment).await?;
    let task = load_task(&st.pool, user.school_id, id).await?;

    let (submissions, own_submission) = if scope.manage {
        (submission_views(&st.pool, id, None).await?, None)
    } else {
        let own = match scope.student_id {
            Some(sid) => submission_views(&st.pool, id, Some(sid))
                .await?
                .into_iter()
                .next(),
            None => None,
        };
        (vec![], own)
    };

    Ok(Json(TaskDetail {
        task,
        submissions,
        own_submission,
        manage: scope.manage,
    }))
}

/// Pengumpulan siswa: teks dan/atau berkas (field multipart `text` dan `file`).
/// Mengganti pengumpulan sebelumnya selama belum dinilai.
pub async fn submit(
    State(st): State<AppState>,
    user: AuthUser,
    Path(task_id): Path<Uuid>,
    mut multipart: Multipart,
) -> AppResult<Json<SubmissionView>> {
    let assignment = task_assignment(&st.pool, user.school_id, task_id).await?;
    let scope = room_scope(&st.pool, &user, assignment).await?;
    let student_id = scope.student_id.ok_or(AppError::Forbidden)?;
    let task = load_task(&st.pool, user.school_id, task_id).await?;

    let mut text: Option<String> = None;
    let mut files: Vec<(storage::Checked, Vec<u8>)> = Vec::new();
    while let Some(mut field) = multipart.next_field().await.map_err(storage::form_error)? {
        match field.name() {
            Some("text") => {
                let t = field.text().await.map_err(storage::form_error)?;
                if t.chars().count() > MAX_TEXT_CHARS {
                    return Err(AppError::Validation(vec![FieldIssue::new(
                        "text",
                        "jawaban teks terlalu panjang",
                    )]));
                }
                text = Some(t);
            }
            Some("file") => {
                if files.len() >= storage::MAX_FILES_PER_SUBMISSION {
                    return Err(storage::file_issue(format!(
                        "maksimal {} berkas per pengumpulan",
                        storage::MAX_FILES_PER_SUBMISSION
                    )));
                }
                let raw_name = field.file_name().unwrap_or("").to_string();
                let bytes = storage::read_limited(&mut field).await?;
                let checked = storage::check(&raw_name, &bytes).map_err(storage::file_issue)?;
                files.push((checked, bytes));
            }
            _ => {}
        }
    }

    let text = text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    if text.is_none() && files.is_empty() {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "text",
            "isi jawaban berupa teks atau minimal satu berkas",
        )]));
    }

    let now = Utc::now();
    let is_late = now > task.due_at;
    if is_late && !task.allow_late {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "due_at",
            "tenggat sudah lewat dan guru tidak menerima pengumpulan terlambat",
        )]));
    }

    let graded: Option<Option<f64>> = sqlx::query_scalar(
        "SELECT score FROM lms_submissions WHERE task_id = ? AND student_id = ?",
    )
    .bind(task_id)
    .bind(student_id)
    .fetch_optional(&st.pool)
    .await?;
    if matches!(graded, Some(Some(_))) {
        return Err(AppError::Conflict(
            "pengumpulan sudah dinilai dan tidak bisa diubah".to_string(),
        ));
    }

    // Tulis berkas ke disk dulu. Jika transaksi gagal, berkas baru dibersihkan.
    let mut written: Vec<(String, storage::Checked, u64)> = Vec::with_capacity(files.len());
    for (checked, bytes) in files {
        let stored = storage::new_stored_name();
        if let Err(e) = storage::write(&st.upload_dir, user.school_id, &stored, &bytes).await {
            for (s, _, _) in &written {
                storage::remove(&st.upload_dir, user.school_id, s).await;
            }
            return Err(e);
        }
        written.push((stored, checked, bytes.len() as u64));
    }

    let outcome = write_submission(&st, &user, task_id, student_id, text, is_late, &written).await;
    match outcome {
        Ok(old_files) => {
            for s in old_files {
                storage::remove(&st.upload_dir, user.school_id, &s).await;
            }
        }
        Err(e) => {
            for (s, _, _) in &written {
                storage::remove(&st.upload_dir, user.school_id, s).await;
            }
            return Err(e);
        }
    }

    let view = submission_views(&st.pool, task_id, Some(student_id))
        .await?
        .into_iter()
        .next()
        .ok_or(AppError::NotFound)?;
    Ok(Json(view))
}

/// Menyimpan pengumpulan dan berkasnya dalam satu transaksi. Mengembalikan nama berkas lama yang harus dihapus dari disk.
async fn write_submission(
    st: &AppState,
    user: &AuthUser,
    task_id: Uuid,
    student_id: Uuid,
    text: Option<String>,
    is_late: bool,
    files: &[(String, storage::Checked, u64)],
) -> AppResult<Vec<String>> {
    let mut tx = st.pool.begin().await?;
    sqlx::query(
        "INSERT INTO lms_submissions (id, school_id, task_id, student_id, text_body, submitted_at, is_late) \
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?) AS new \
         ON DUPLICATE KEY UPDATE text_body = new.text_body, submitted_at = UTC_TIMESTAMP(6), is_late = new.is_late",
    )
    .bind(Uuid::new_v4())
    .bind(user.school_id)
    .bind(task_id)
    .bind(student_id)
    .bind(&text)
    .bind(is_late)
    .execute(&mut *tx)
    .await?;

    let sub_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM lms_submissions WHERE task_id = ? AND student_id = ? FOR UPDATE",
    )
    .bind(task_id)
    .bind(student_id)
    .fetch_one(&mut *tx)
    .await?;

    let old: Vec<String> = sqlx::query_scalar(
        "SELECT stored_name FROM lms_files WHERE owner_kind = 'submission' AND owner_id = ?",
    )
    .bind(sub_id)
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM lms_files WHERE owner_kind = 'submission' AND owner_id = ?")
        .bind(sub_id)
        .execute(&mut *tx)
        .await?;

    let mut seen = HashSet::new();
    for (stored, checked, size) in files {
        if !seen.insert(stored.clone()) {
            continue;
        }
        sqlx::query(
            "INSERT INTO lms_files (id, school_id, owner_kind, owner_id, file_name, stored_name, mime, size_bytes, uploaded_by) \
             VALUES (?, ?, 'submission', ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4())
        .bind(user.school_id)
        .bind(sub_id)
        .bind(&checked.display_name)
        .bind(stored)
        .bind(checked.mime)
        .bind(*size)
        .bind(user.user_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(old)
}

/// Guru memberi nilai dan umpan balik. Nilai dibatasi 0 sampai nilai maksimum tugas.
pub async fn grade(
    State(st): State<AppState>,
    user: AuthUser,
    Path(sub_id): Path<Uuid>,
    Json(input): Json<GradeInput>,
) -> AppResult<Json<SubmissionView>> {
    let (task_id, student_id, assignment, max_score): (Uuid, Uuid, Uuid, f64) = sqlx::query_as(
        "SELECT s.task_id, s.student_id, t.assignment_id, t.max_score \
         FROM lms_submissions s JOIN lms_tasks t ON t.id = s.task_id \
         WHERE s.id = ? AND s.school_id = ?",
    )
    .bind(sub_id)
    .bind(user.school_id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    if !room_scope(&st.pool, &user, assignment).await?.manage {
        return Err(AppError::Forbidden);
    }

    let mut v = Validator::new();
    v.require(
        input.score.is_finite() && input.score >= 0.0 && input.score <= max_score,
        "score",
        &format!("nilai harus antara 0 dan {max_score}"),
    );
    let feedback = v.opt_text("feedback", input.feedback.as_deref(), 5_000);
    v.finish()?;

    sqlx::query(
        "UPDATE lms_submissions SET score = ?, feedback = ?, graded_at = UTC_TIMESTAMP(6), graded_by = ? WHERE id = ?",
    )
    .bind(input.score)
    .bind(&feedback)
    .bind(user.user_id)
    .bind(sub_id)
    .execute(&st.pool)
    .await?;

    let view = submission_views(&st.pool, task_id, Some(student_id))
        .await?
        .into_iter()
        .next()
        .ok_or(AppError::NotFound)?;
    Ok(Json(view))
}
