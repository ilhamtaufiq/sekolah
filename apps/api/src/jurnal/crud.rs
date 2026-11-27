//! Daftar, detail, buat, ubah, dan kirim jurnal oleh guru.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use uuid::Uuid;

use super::{
    JournalInput, JournalView, READ_ROLES, STATUSES, WRITE_ROLES, assignment_ctx,
    assignment_not_found, check_input, enrolled_count, fetch, own_scope, SELECT_VIEW,
};
use crate::{
    auth::{AuthUser, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
};

/// Batas baris daftar jurnal per permintaan.
const LIST_LIMIT: u32 = 200;

#[derive(Deserialize)]
pub struct ListFilter {
    pub assignment_id: Option<Uuid>,
    pub class_id: Option<Uuid>,
    pub teacher_id: Option<Uuid>,
    pub status: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

#[derive(Deserialize)]
pub struct CreateInput {
    pub assignment_id: Uuid,
    #[serde(flatten)]
    pub journal: JournalInput,
}

/// Guru atau wali kelas hanya melihat jurnalnya sendiri, walau query meminta guru lain.
pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<ListFilter>,
) -> AppResult<Json<Vec<JournalView>>> {
    require_role(&user, READ_ROLES)?;
    if let Some(s) = &f.status
        && !STATUSES.contains(&s.as_str())
    {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "status",
            "status tidak dikenal",
        )]));
    }
    let teacher = own_scope(&user).or(f.teacher_id);
    let status = f.status.as_deref();

    let sql = format!(
        "{SELECT_VIEW} \
         WHERE j.school_id = ? \
           AND (? IS NULL OR j.assignment_id = ?) \
           AND (? IS NULL OR a.class_id = ?) \
           AND (? IS NULL OR j.teacher_id = ?) \
           AND (? IS NULL OR j.status = ?) \
           AND (? IS NULL OR j.journal_date >= ?) \
           AND (? IS NULL OR j.journal_date <= ?) \
         ORDER BY j.journal_date DESC, j.hour_no \
         LIMIT {LIST_LIMIT}"
    );
    let rows = sqlx::query_as(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(user.school_id)
        .bind(f.assignment_id)
        .bind(f.assignment_id)
        .bind(f.class_id)
        .bind(f.class_id)
        .bind(teacher)
        .bind(teacher)
        .bind(status)
        .bind(status)
        .bind(f.from)
        .bind(f.from)
        .bind(f.to)
        .bind(f.to)
        .fetch_all(&st.pool)
        .await?;
    Ok(Json(rows))
}

pub async fn get(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<JournalView>> {
    require_role(&user, READ_ROLES)?;
    let j = fetch(&st.pool, user.school_id, id).await?;
    if own_scope(&user).is_some_and(|me| me != j.teacher_id) {
        return Err(AppError::Forbidden);
    }
    Ok(Json(j))
}

/// Membuat jurnal baru berstatus draft untuk penugasan milik guru yang login.
pub async fn create(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<CreateInput>,
) -> AppResult<Json<JournalView>> {
    require_role(&user, WRITE_ROLES)?;
    let sid = user.school_id;

    let ctx = assignment_ctx(&st.pool, sid, input.assignment_id)
        .await?
        .ok_or_else(assignment_not_found)?;
    if ctx.teacher_id != user.user_id {
        return Err(AppError::Forbidden);
    }
    let enrolled = enrolled_count(&st.pool, sid, ctx.class_id).await?;
    let (topic, notes) = check_input(&input.journal, &ctx, enrolled, Utc::now().date_naive())?;

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO teaching_journals \
         (id, school_id, assignment_id, teacher_id, journal_date, hour_no, topic, notes, present_count, status) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')",
    )
    .bind(id)
    .bind(sid)
    .bind(input.assignment_id)
    .bind(user.user_id)
    .bind(input.journal.journal_date)
    .bind(input.journal.hour_no)
    .bind(&topic)
    .bind(notes.as_deref())
    .bind(input.journal.present_count)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "jam ke ini sudah dicatat untuk tanggal tersebut"))?;

    Ok(Json(fetch(&st.pool, sid, id).await?))
}

/// Mengubah jurnal. Hanya pemilik, dan hanya saat status draft atau ditolak.
pub async fn update(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<JournalInput>,
) -> AppResult<Json<JournalView>> {
    require_role(&user, WRITE_ROLES)?;
    let sid = user.school_id;

    let cur = fetch(&st.pool, sid, id).await?;
    if cur.teacher_id != user.user_id {
        return Err(AppError::Forbidden);
    }
    if !matches!(cur.status.as_str(), "draft" | "ditolak") {
        return Err(AppError::Conflict(format!(
            "jurnal berstatus '{}' tidak dapat diubah",
            cur.status
        )));
    }

    let ctx = assignment_ctx(&st.pool, sid, cur.assignment_id)
        .await?
        .ok_or_else(assignment_not_found)?;
    let enrolled = enrolled_count(&st.pool, sid, ctx.class_id).await?;
    let (topic, notes) = check_input(&input, &ctx, enrolled, Utc::now().date_naive())?;

    // Kondisi status ikut di WHERE supaya perubahan bersamaan (mis. disetujui) tidak tertimpa.
    let res = sqlx::query(
        "UPDATE teaching_journals \
         SET journal_date = ?, hour_no = ?, topic = ?, notes = ?, present_count = ? \
         WHERE id = ? AND school_id = ? AND teacher_id = ? AND status IN ('draft', 'ditolak')",
    )
    .bind(input.journal_date)
    .bind(input.hour_no)
    .bind(&topic)
    .bind(notes.as_deref())
    .bind(input.present_count)
    .bind(id)
    .bind(sid)
    .bind(user.user_id)
    .execute(&st.pool)
    .await
    .map_err(|e| AppError::from_db(e, "jam ke ini sudah dicatat untuk tanggal tersebut"))?;
    if res.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "status jurnal baru saja berubah, muat ulang halaman".into(),
        ));
    }

    Ok(Json(fetch(&st.pool, sid, id).await?))
}

/// Mengirim jurnal untuk persetujuan. Dipakai juga untuk kirim ulang setelah ditolak.
/// Keputusan sebelumnya dikosongkan karena jurnal kembali menunggu.
pub async fn submit(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<JournalView>> {
    require_role(&user, WRITE_ROLES)?;
    let sid = user.school_id;

    let cur = fetch(&st.pool, sid, id).await?;
    if cur.teacher_id != user.user_id {
        return Err(AppError::Forbidden);
    }
    let res = sqlx::query(
        "UPDATE teaching_journals \
         SET status = 'menunggu', submitted_at = UTC_TIMESTAMP(6), \
             decided_by = NULL, decided_at = NULL, decision_note = NULL \
         WHERE id = ? AND school_id = ? AND teacher_id = ? AND status IN ('draft', 'ditolak')",
    )
    .bind(id)
    .bind(sid)
    .bind(user.user_id)
    .execute(&st.pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "jurnal berstatus '{}' tidak dapat dikirim",
            cur.status
        )));
    }

    Ok(Json(fetch(&st.pool, sid, id).await?))
}
