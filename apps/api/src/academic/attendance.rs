//! Absensi. Dua jenis sesi:
//! - `harian`: dicatat wali kelas untuk seluruh kelas.
//! - `mapel`: dicatat guru untuk satu penugasan (mapel × kelas).
//!
//! Status: H hadir, S sakit, I izin, A alpa.

use std::collections::HashSet;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{ATTENDANCE_WRITE, READ_ROLES};
use crate::{
    auth::{AuthUser, Role, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
};

const STATUSES: &[&str] = &["H", "S", "I", "A"];

/// Baris siswa di kelas beserta status absensinya: (id, nis, nama, status, catatan).
type RecordTuple = (Uuid, String, String, Option<String>, Option<String>);

#[derive(Serialize, FromRow)]
pub struct SessionSummary {
    pub id: Uuid,
    pub kind: String,
    pub session_date: NaiveDate,
    pub class_id: Uuid,
    pub class_name: String,
    pub assignment_id: Option<Uuid>,
    pub subject_name: Option<String>,
    pub recorded_by_name: String,
    pub present: i64,
    pub total: i64,
}

#[derive(Deserialize)]
pub struct SessionFilter {
    pub class_id: Option<Uuid>,
    pub date: Option<NaiveDate>,
}

#[derive(Serialize)]
pub struct RecordRow {
    pub student_id: Uuid,
    pub nis: String,
    pub name: String,
    pub status: Option<String>,
    pub note: Option<String>,
}

#[derive(Serialize)]
pub struct SessionDetail {
    pub id: Uuid,
    pub kind: String,
    pub session_date: NaiveDate,
    pub class_id: Uuid,
    pub class_name: String,
    pub assignment_id: Option<Uuid>,
    pub subject_name: Option<String>,
    pub recorded_by_name: String,
    pub records: Vec<RecordRow>,
}

#[derive(Deserialize)]
pub struct RecordInput {
    pub student_id: Uuid,
    pub status: String,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct AttendanceInput {
    pub kind: String,
    pub class_id: Uuid,
    pub assignment_id: Option<Uuid>,
    pub session_date: NaiveDate,
    pub records: Vec<RecordInput>,
}

pub async fn list_sessions(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<SessionFilter>,
) -> AppResult<Json<Vec<SessionSummary>>> {
    require_role(&user, READ_ROLES)?;
    let rows = sqlx::query_as(
        "SELECT ss.id, ss.kind, ss.session_date, ss.class_id, c.name AS class_name, \
                ss.assignment_id, s.name AS subject_name, u.name AS recorded_by_name, \
                CAST(COALESCE(SUM(r.status = 'H'), 0) AS SIGNED) AS present, \
                CAST(COUNT(r.id) AS SIGNED) AS total \
         FROM attendance_sessions ss \
         JOIN classes c ON c.id = ss.class_id \
         JOIN users u ON u.id = ss.recorded_by \
         LEFT JOIN teaching_assignments a ON a.id = ss.assignment_id \
         LEFT JOIN subjects s ON s.id = a.subject_id \
         LEFT JOIN attendance_records r ON r.session_id = ss.id \
         WHERE ss.school_id = ? \
           AND (? IS NULL OR ss.class_id = ?) \
           AND (? IS NULL OR ss.session_date = ?) \
         GROUP BY ss.id, ss.kind, ss.session_date, ss.class_id, c.name, ss.assignment_id, s.name, u.name \
         ORDER BY ss.session_date DESC, c.name \
         LIMIT 200",
    )
    .bind(user.school_id)
    .bind(f.class_id)
    .bind(f.class_id)
    .bind(f.date)
    .bind(f.date)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(FromRow)]
struct Header {
    id: Uuid,
    kind: String,
    session_date: NaiveDate,
    class_id: Uuid,
    class_name: String,
    assignment_id: Option<Uuid>,
    subject_name: Option<String>,
    recorded_by_name: String,
}

async fn load_detail(
    pool: &sqlx::MySqlPool,
    school_id: Uuid,
    id: Uuid,
) -> AppResult<SessionDetail> {
    let h: Header = sqlx::query_as(
        "SELECT ss.id, ss.kind, ss.session_date, ss.class_id, c.name AS class_name, \
                ss.assignment_id, s.name AS subject_name, u.name AS recorded_by_name \
         FROM attendance_sessions ss \
         JOIN classes c ON c.id = ss.class_id \
         JOIN users u ON u.id = ss.recorded_by \
         LEFT JOIN teaching_assignments a ON a.id = ss.assignment_id \
         LEFT JOIN subjects s ON s.id = a.subject_id \
         WHERE ss.id = ? AND ss.school_id = ?",
    )
    .bind(id)
    .bind(school_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;

    // Semua siswa di kelas, dengan status jika sudah dicatat (NULL = belum diisi).
    let records: Vec<RecordTuple> = sqlx::query_as(
        "SELECT s.id, s.nis, s.name, r.status, r.note \
         FROM class_enrollments e \
         JOIN students s ON s.id = e.student_id \
         LEFT JOIN attendance_records r ON r.student_id = s.id AND r.session_id = ? \
         WHERE e.class_id = ? AND e.school_id = ? \
         ORDER BY s.name",
    )
    .bind(id)
    .bind(h.class_id)
    .bind(school_id)
    .fetch_all(pool)
    .await?;

    Ok(SessionDetail {
        id: h.id,
        kind: h.kind,
        session_date: h.session_date,
        class_id: h.class_id,
        class_name: h.class_name,
        assignment_id: h.assignment_id,
        subject_name: h.subject_name,
        recorded_by_name: h.recorded_by_name,
        records: records
            .into_iter()
            .map(|(student_id, nis, name, status, note)| RecordRow {
                student_id,
                nis,
                name,
                status,
                note,
            })
            .collect(),
    })
}

pub async fn get_session(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<SessionDetail>> {
    require_role(&user, READ_ROLES)?;
    Ok(Json(load_detail(&st.pool, user.school_id, id).await?))
}

/// Membuat atau memperbarui catatan absensi untuk satu kelas pada satu tanggal.
/// Siswa yang tidak ada di `records` tidak diubah.
pub async fn save(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<AttendanceInput>,
) -> AppResult<Json<SessionDetail>> {
    require_role(&user, ATTENDANCE_WRITE)?;
    let sid = user.school_id;

    // 1. Validasi bentuk permintaan.
    let mut issues = Vec::new();
    let today = Utc::now().date_naive();
    if input.session_date > today {
        issues.push(FieldIssue::new(
            "session_date",
            "tanggal absensi tidak boleh di masa depan",
        ));
    }
    let (kind, want_assignment) = match input.kind.as_str() {
        "harian" => ("harian", false),
        "mapel" => ("mapel", true),
        _ => {
            issues.push(FieldIssue::new("kind", "jenis harus 'harian' atau 'mapel'"));
            ("", false)
        }
    };
    if !kind.is_empty() && want_assignment != input.assignment_id.is_some() {
        issues.push(FieldIssue::new(
            "assignment_id",
            if want_assignment {
                "absensi mapel wajib menyebut penugasan"
            } else {
                "absensi harian tidak menyebut penugasan"
            },
        ));
    }

    let mut seen = HashSet::new();
    for (i, r) in input.records.iter().enumerate() {
        let status = r.status.trim().to_uppercase();
        if !STATUSES.contains(&status.as_str()) {
            issues.push(FieldIssue::new(
                format!("records[{i}].status"),
                "status harus H, S, I, atau A",
            ));
        }
        if !seen.insert(r.student_id) {
            issues.push(FieldIssue::new(
                format!("records[{i}].student_id"),
                "siswa dicatat dua kali",
            ));
        }
    }
    if !issues.is_empty() {
        return Err(AppError::Validation(issues));
    }

    // 2. Kelas harus ada di sekolah dan tanggal berada dalam tahun ajarannya.
    let (starts, ends): (NaiveDate, NaiveDate) = sqlx::query_as(
        "SELECT y.starts_on, y.ends_on FROM classes c JOIN academic_years y ON y.id = c.academic_year_id \
         WHERE c.id = ? AND c.school_id = ?",
    )
    .bind(input.class_id)
    .bind(sid)
    .fetch_optional(&st.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    if input.session_date < starts || input.session_date > ends {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "session_date",
            "tanggal di luar tahun ajaran kelas ini",
        )]));
    }

    // 3. Kepemilikan: admin bebas, selain itu hanya penanggung jawab sesi.
    let is_admin = user.role == Role::Admin;
    if let Some(assignment) = input.assignment_id {
        let (class_id, teacher_id): (Uuid, Uuid) = sqlx::query_as(
            "SELECT class_id, teacher_id FROM teaching_assignments WHERE id = ? AND school_id = ?",
        )
        .bind(assignment)
        .bind(sid)
        .fetch_optional(&st.pool)
        .await?
        .ok_or_else(|| {
            AppError::Validation(vec![FieldIssue::new(
                "assignment_id",
                "penugasan tidak ditemukan",
            )])
        })?;
        if class_id != input.class_id {
            return Err(AppError::Validation(vec![FieldIssue::new(
                "assignment_id",
                "penugasan bukan milik kelas ini",
            )]));
        }
        if !is_admin && teacher_id != user.user_id {
            return Err(AppError::Forbidden);
        }
    } else if !is_admin {
        let homeroom: Option<Uuid> = sqlx::query_scalar(
            "SELECT homeroom_teacher_id FROM classes WHERE id = ? AND school_id = ?",
        )
        .bind(input.class_id)
        .bind(sid)
        .fetch_optional(&st.pool)
        .await?
        .flatten();
        if homeroom != Some(user.user_id) {
            return Err(AppError::Forbidden);
        }
    }

    // 4. Setiap siswa yang dicatat harus terdaftar di kelas ini.
    let enrolled: HashSet<Uuid> = sqlx::query_scalar::<_, Uuid>(
        "SELECT student_id FROM class_enrollments WHERE class_id = ? AND school_id = ?",
    )
    .bind(input.class_id)
    .bind(sid)
    .fetch_all(&st.pool)
    .await?
    .into_iter()
    .collect();
    let unknown: Vec<FieldIssue> = input
        .records
        .iter()
        .enumerate()
        .filter(|(_, r)| !enrolled.contains(&r.student_id))
        .map(|(i, r)| {
            FieldIssue::new(
                format!("records[{i}].student_id"),
                format!("siswa {} bukan anggota kelas ini", r.student_id),
            )
        })
        .collect();
    if !unknown.is_empty() {
        return Err(AppError::Validation(unknown));
    }

    // 5. Tulis dalam satu transaksi. Kelas dikunci agar penulisan bersamaan berurutan.
    let mut tx = st.pool.begin().await?;
    sqlx::query("SELECT id FROM classes WHERE id = ? FOR UPDATE")
        .bind(input.class_id)
        .fetch_one(&mut *tx)
        .await?;

    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM attendance_sessions \
         WHERE school_id = ? AND class_id = ? AND kind = ? AND session_date = ? AND assignment_id <=> ?",
    )
    .bind(sid)
    .bind(input.class_id)
    .bind(kind)
    .bind(input.session_date)
    .bind(input.assignment_id)
    .fetch_optional(&mut *tx)
    .await?;

    let session_id = match existing {
        Some(id) => {
            sqlx::query("UPDATE attendance_sessions SET recorded_by = ? WHERE id = ?")
                .bind(user.user_id)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            id
        }
        None => {
            let id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO attendance_sessions (id, school_id, class_id, assignment_id, kind, session_date, recorded_by) \
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(sid)
            .bind(input.class_id)
            .bind(input.assignment_id)
            .bind(kind)
            .bind(input.session_date)
            .bind(user.user_id)
            .execute(&mut *tx)
            .await?;
            id
        }
    };

    for r in &input.records {
        sqlx::query(
            "INSERT INTO attendance_records (id, session_id, student_id, status, note) VALUES (?, ?, ?, ?, ?) \
             AS new ON DUPLICATE KEY UPDATE status = new.status, note = new.note",
        )
        .bind(Uuid::new_v4())
        .bind(session_id)
        .bind(r.student_id)
        .bind(r.status.trim().to_uppercase())
        .bind(r.note.as_deref().map(str::trim).filter(|n| !n.is_empty()))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok(Json(load_detail(&st.pool, sid, session_id).await?))
}

/// Dipakai dashboard: jumlah hadir per kelas untuk satu tanggal (sesi harian saja).
pub async fn daily_totals(
    pool: &sqlx::MySqlPool,
    school_id: Uuid,
    date: NaiveDate,
) -> AppResult<(i64, i64, i64)> {
    let row: (i64, i64, i64) = sqlx::query_as(
        "SELECT CAST(COUNT(DISTINCT ss.class_id) AS SIGNED), \
                CAST(COALESCE(SUM(r.status = 'H'), 0) AS SIGNED), \
                CAST(COUNT(r.id) AS SIGNED) \
         FROM attendance_sessions ss \
         LEFT JOIN attendance_records r ON r.session_id = ss.id \
         WHERE ss.school_id = ? AND ss.session_date = ? AND ss.kind = 'harian'",
    )
    .bind(school_id)
    .bind(date)
    .fetch_one(pool)
    .await?;
    Ok(row)
}
