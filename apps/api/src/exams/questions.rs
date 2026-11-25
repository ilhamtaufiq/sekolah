use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{TEACH_ROLES, can_manage_subject};
use crate::{
    auth::{AuthUser, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
    validate::Validator,
};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct QuestionOption {
    pub key: String,
    pub text: String,
}

#[derive(Serialize)]
pub struct Question {
    pub id: Uuid,
    pub subject_id: Uuid,
    pub subject_name: String,
    pub kind: String,
    pub body: String,
    pub options: Option<Vec<QuestionOption>>,
    pub answer_key: Option<String>,
    pub points: u32,
}

#[derive(FromRow)]
struct QuestionRow {
    id: Uuid,
    subject_id: Uuid,
    subject_name: String,
    kind: String,
    body: String,
    options: Option<serde_json::Value>,
    answer_key: Option<String>,
    points: u32,
}

impl TryFrom<QuestionRow> for Question {
    type Error = AppError;
    fn try_from(r: QuestionRow) -> Result<Self, Self::Error> {
        let options = match r.options {
            Some(v) => Some(serde_json::from_value(v).map_err(|e| AppError::Internal(e.into()))?),
            None => None,
        };
        Ok(Question {
            id: r.id,
            subject_id: r.subject_id,
            subject_name: r.subject_name,
            kind: r.kind,
            body: r.body,
            options,
            answer_key: r.answer_key,
            points: r.points,
        })
    }
}

#[derive(Deserialize)]
pub struct QuestionFilter {
    pub subject_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct QuestionInput {
    pub subject_id: Uuid,
    pub kind: String,
    pub body: String,
    pub options: Option<Vec<QuestionOption>>,
    pub answer_key: Option<String>,
    pub points: u32,
}

/// Validasi bentuk soal. Mengembalikan isi yang sudah dibersihkan.
pub fn validate(
    input: &QuestionInput,
) -> AppResult<(String, Option<Vec<QuestionOption>>, Option<String>)> {
    let mut v = Validator::new();
    let body = v.text("body", &input.body, 1, 5000);
    v.require(
        (1..=100).contains(&input.points),
        "points",
        "poin harus 1–100",
    );

    let (options, answer_key) = match input.kind.as_str() {
        "pg" => {
            let opts: Vec<QuestionOption> = input
                .options
                .clone()
                .unwrap_or_default()
                .into_iter()
                .map(|o| QuestionOption {
                    key: o.key.trim().to_uppercase(),
                    text: o.text.trim().to_string(),
                })
                .collect();
            v.require(
                (2..=5).contains(&opts.len()),
                "options",
                "pilihan ganda butuh 2–5 opsi",
            );
            let keys: Vec<&str> = opts.iter().map(|o| o.key.as_str()).collect();
            v.require(
                keys.iter()
                    .all(|k| k.len() == 1 && k.chars().all(|c| c.is_ascii_uppercase())),
                "options",
                "kode opsi harus satu huruf A–E",
            );
            let mut sorted = keys.clone();
            sorted.sort_unstable();
            sorted.dedup();
            v.require(
                sorted.len() == keys.len(),
                "options",
                "kode opsi tidak boleh sama",
            );
            for (i, o) in opts.iter().enumerate() {
                v.require(
                    !o.text.is_empty() && o.text.chars().count() <= 500,
                    &format!("options[{i}].text"),
                    "teks opsi 1–500 karakter",
                );
            }
            let key = input
                .answer_key
                .as_deref()
                .map(|k| k.trim().to_uppercase())
                .unwrap_or_default();
            v.require(
                keys.contains(&key.as_str()),
                "answer_key",
                "kunci harus salah satu kode opsi",
            );
            (Some(opts), Some(key))
        }
        "esai" => {
            v.require(input.options.is_none(), "options", "esai tidak punya opsi");
            v.require(
                input.answer_key.is_none(),
                "answer_key",
                "esai tidak punya kunci",
            );
            (None, None)
        }
        _ => {
            v.require(false, "kind", "jenis harus 'pg' atau 'esai'");
            (None, None)
        }
    };
    v.finish()?;
    Ok((body, options, answer_key))
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<QuestionFilter>,
) -> AppResult<Json<Vec<Question>>> {
    require_role(&user, TEACH_ROLES)?;
    let rows: Vec<QuestionRow> = sqlx::query_as(
        "SELECT q.id, q.subject_id, s.name AS subject_name, q.kind, q.body, q.options, q.answer_key, q.points \
         FROM questions q JOIN subjects s ON s.id = q.subject_id \
         WHERE q.school_id = ? AND (? IS NULL OR q.subject_id = ?) \
         ORDER BY s.name, q.created_at \
         LIMIT 500",
    )
    .bind(user.school_id)
    .bind(f.subject_id)
    .bind(f.subject_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(Question::try_from)
            .collect::<AppResult<Vec<_>>>()?,
    ))
}

async fn fetch(pool: &sqlx::MySqlPool, school_id: Uuid, id: Uuid) -> AppResult<Question> {
    let row: QuestionRow = sqlx::query_as(
        "SELECT q.id, q.subject_id, s.name AS subject_name, q.kind, q.body, q.options, q.answer_key, q.points \
         FROM questions q JOIN subjects s ON s.id = q.subject_id \
         WHERE q.id = ? AND q.school_id = ?",
    )
        .bind(id)
        .bind(school_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    Question::try_from(row)
}

pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<QuestionInput>,
) -> AppResult<Json<Question>> {
    require_role(&user, TEACH_ROLES)?;
    let (body, options, answer_key) = validate(&input)?;
    if !can_manage_subject(&st.pool, &user, input.subject_id).await? {
        return Err(AppError::Forbidden);
    }
    let subject_ok: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM subjects WHERE id = ? AND school_id = ?")
            .bind(input.subject_id)
            .bind(user.school_id)
            .fetch_optional(&st.pool)
            .await?;
    if subject_ok.is_none() {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "subject_id",
            "mapel tidak ditemukan",
        )]));
    }

    let id = Uuid::new_v4();
    let options_json = options
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|e| AppError::Internal(e.into()))?;
    sqlx::query(
        "INSERT INTO questions (id, school_id, subject_id, author_id, kind, body, options, answer_key, points) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user.school_id)
    .bind(input.subject_id)
    .bind(user.user_id)
    .bind(&input.kind)
    .bind(&body)
    .bind(options_json)
    .bind(&answer_key)
    .bind(input.points)
    .execute(&st.pool)
    .await?;

    Ok(Json(fetch(&st.pool, user.school_id, id).await?))
}

pub async fn update(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<QuestionInput>,
) -> AppResult<Json<Question>> {
    require_role(&user, TEACH_ROLES)?;
    let current = fetch(&st.pool, user.school_id, id).await?;
    if !can_manage_subject(&st.pool, &user, current.subject_id).await? {
        return Err(AppError::Forbidden);
    }
    let (body, options, answer_key) = validate(&input)?;

    let in_published: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM exam_questions eq JOIN exams e ON e.id = eq.exam_id \
         WHERE eq.question_id = ? AND e.status = 'published' LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&st.pool)
    .await?;
    if in_published.is_some() {
        return Err(AppError::Conflict(
            "soal sudah dipakai di ujian yang diterbitkan dan tidak bisa diubah".to_string(),
        ));
    }

    let options_json = options
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|e| AppError::Internal(e.into()))?;
    sqlx::query(
        "UPDATE questions SET kind = ?, body = ?, options = ?, answer_key = ?, points = ?, updated_at = UTC_TIMESTAMP(6) \
         WHERE id = ? AND school_id = ?",
    )
    .bind(&input.kind)
    .bind(&body)
    .bind(options_json)
    .bind(&answer_key)
    .bind(input.points)
    .bind(id)
    .bind(user.school_id)
    .execute(&st.pool)
    .await?;

    Ok(Json(fetch(&st.pool, user.school_id, id).await?))
}

pub async fn delete(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, TEACH_ROLES)?;
    let current = fetch(&st.pool, user.school_id, id).await?;
    if !can_manage_subject(&st.pool, &user, current.subject_id).await? {
        return Err(AppError::Forbidden);
    }
    let used: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM exam_questions WHERE question_id = ? LIMIT 1")
            .bind(id)
            .fetch_optional(&st.pool)
            .await?;
    if used.is_some() {
        return Err(AppError::Conflict(
            "soal dipakai di paket ujian dan tidak bisa dihapus".to_string(),
        ));
    }
    sqlx::query("DELETE FROM questions WHERE id = ? AND school_id = ?")
        .bind(id)
        .bind(user.school_id)
        .execute(&st.pool)
        .await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}
