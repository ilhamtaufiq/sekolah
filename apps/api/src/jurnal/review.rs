//! Persetujuan dan penolakan jurnal oleh kepala sekolah atau admin.

use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;
use sqlx::MySqlPool;
use uuid::Uuid;

use super::{JournalView, MAX_DECISION_NOTE_CHARS, REVIEW_ROLES, fetch};
use crate::{
    auth::{AuthUser, require_role},
    error::{AppError, AppResult},
    state::AppState,
    validate::Validator,
};

#[derive(Deserialize)]
pub struct ReviewInput {
    pub note: Option<String>,
}

/// Menyetujui jurnal yang menunggu. Catatan opsional.
pub async fn approve(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<ReviewInput>,
) -> AppResult<Json<JournalView>> {
    require_role(&user, REVIEW_ROLES)?;
    let mut v = Validator::new();
    let note = v.opt_text("note", input.note.as_deref(), MAX_DECISION_NOTE_CHARS);
    v.finish()?;
    decide(&st.pool, &user, id, "disetujui", note.as_deref()).await
}

/// Menolak jurnal yang menunggu. Catatan wajib supaya guru tahu apa yang diperbaiki.
pub async fn reject(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<ReviewInput>,
) -> AppResult<Json<JournalView>> {
    require_role(&user, REVIEW_ROLES)?;
    let note = input.note.as_deref().map(str::trim).unwrap_or_default();
    let mut v = Validator::new();
    v.require(
        note.chars().count() >= 3,
        "note",
        "catatan penolakan wajib diisi, minimal 3 karakter",
    );
    v.require(
        note.chars().count() <= MAX_DECISION_NOTE_CHARS,
        "note",
        "catatan penolakan maksimal 1000 karakter",
    );
    v.finish()?;
    decide(&st.pool, &user, id, "ditolak", Some(note)).await
}

async fn decide(
    pool: &MySqlPool,
    user: &AuthUser,
    id: Uuid,
    next: &str,
    note: Option<&str>,
) -> AppResult<Json<JournalView>> {
    let cur = fetch(pool, user.school_id, id).await?;
    if cur.status != "menunggu" {
        return Err(AppError::Conflict(format!(
            "hanya jurnal yang menunggu persetujuan yang bisa diputuskan (status sekarang: '{}')",
            cur.status
        )));
    }

    let res = sqlx::query(
        "UPDATE teaching_journals \
         SET status = ?, decided_by = ?, decided_at = UTC_TIMESTAMP(6), decision_note = ? \
         WHERE id = ? AND school_id = ? AND status = 'menunggu'",
    )
    .bind(next)
    .bind(user.user_id)
    .bind(note)
    .bind(id)
    .bind(user.school_id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "status jurnal baru saja berubah, muat ulang halaman".into(),
        ));
    }

    Ok(Json(fetch(pool, user.school_id, id).await?))
}
