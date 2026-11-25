use axum::{Json, extract::State};
use chrono::Utc;
use serde::Serialize;

use super::{READ_ROLES, attendance::daily_totals};
use crate::{
    auth::{AuthUser, require_role},
    error::AppResult,
    state::AppState,
};

#[derive(Serialize)]
pub struct Summary {
    pub active_year: Option<String>,
    pub active_students: i64,
    pub classes: i64,
    pub teachers: i64,
    pub assignments: i64,
    pub today: Today,
}

#[derive(Serialize)]
pub struct Today {
    pub date: String,
    pub classes_recorded: i64,
    pub present: i64,
    pub total: i64,
    /// Persentase hadir dari seluruh catatan harian hari ini. None bila belum ada catatan.
    pub present_rate: Option<f64>,
}

pub async fn summary(State(st): State<AppState>, user: AuthUser) -> AppResult<Json<Summary>> {
    require_role(&user, READ_ROLES)?;
    let sid = user.school_id;

    let year: Option<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT id, name FROM academic_years WHERE school_id = ? AND is_active = TRUE",
    )
    .bind(sid)
    .fetch_optional(&st.pool)
    .await?;

    let active_students: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM students WHERE school_id = ? AND status = 'aktif'",
    )
    .bind(sid)
    .fetch_one(&st.pool)
    .await?;

    let teachers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE school_id = ? AND role IN ('guru', 'wali_kelas') AND is_active = TRUE",
    )
    .bind(sid)
    .fetch_one(&st.pool)
    .await?;

    let (classes, assignments) = match &year {
        Some((year_id, _)) => {
            let classes: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM classes WHERE academic_year_id = ?")
                    .bind(year_id)
                    .fetch_one(&st.pool)
                    .await?;
            let assignments: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM teaching_assignments WHERE academic_year_id = ?",
            )
            .bind(year_id)
            .fetch_one(&st.pool)
            .await?;
            (classes, assignments)
        }
        None => (0, 0),
    };

    let date = Utc::now().date_naive();
    let (classes_recorded, present, total) = daily_totals(&st.pool, sid, date).await?;
    let present_rate =
        (total > 0).then(|| ((present as f64 / total as f64) * 1000.0).round() / 10.0);

    Ok(Json(Summary {
        active_year: year.map(|(_, name)| name),
        active_students,
        classes,
        teachers,
        assignments,
        today: Today {
            date: date.to_string(),
            classes_recorded,
            present,
            total,
            present_rate,
        },
    }))
}
