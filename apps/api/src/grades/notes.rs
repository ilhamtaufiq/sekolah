use std::collections::{HashMap, HashSet};

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlPool};
use uuid::Uuid;

use super::{READ_ROLES, ensure_homeroom_or_admin, semester_range};
use crate::{
    auth::{AuthUser, Role, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
    validate::Validator,
};

/// Baris catatan dari database: (id siswa, nis, nama, sikap, ekstrakurikuler, wali kelas).
type NoteDbRow = (
    Uuid,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
);

#[derive(Serialize, Clone, Default)]
pub struct Absences {
    pub sakit: i64,
    pub izin: i64,
    pub alpa: i64,
}

#[derive(Serialize, Clone)]
pub struct TermNoteRow {
    pub student_id: Uuid,
    pub nis: String,
    pub name: String,
    pub attitude: Option<String>,
    pub extracurricular: Option<String>,
    pub homeroom_note: Option<String>,
    pub absences: Absences,
}

#[derive(Deserialize)]
pub struct NoteFilter {
    pub class_id: Uuid,
    pub semester_id: Uuid,
}

#[derive(Deserialize)]
pub struct NoteUpdate {
    pub student_id: Uuid,
    pub attitude: Option<String>,
    pub extracurricular: Option<String>,
    pub homeroom_note: Option<String>,
}

#[derive(Deserialize)]
pub struct NotesInput {
    pub class_id: Uuid,
    pub semester_id: Uuid,
    pub notes: Vec<NoteUpdate>,
}

/// Rekap ketidakhadiran dari absensi harian F2 dalam rentang semester, per siswa.
pub async fn term_absences(
    pool: &sqlx::MySqlPool,
    school_id: Uuid,
    class_id: Uuid,
    starts: NaiveDate,
    ends: NaiveDate,
) -> AppResult<HashMap<Uuid, Absences>> {
    let rows: Vec<(Uuid, i64, i64, i64)> = sqlx::query_as(
        "SELECT r.student_id, \
                CAST(COALESCE(SUM(r.status = 'S'), 0) AS SIGNED), \
                CAST(COALESCE(SUM(r.status = 'I'), 0) AS SIGNED), \
                CAST(COALESCE(SUM(r.status = 'A'), 0) AS SIGNED) \
         FROM attendance_records r \
         JOIN attendance_sessions ss ON ss.id = r.session_id \
         WHERE ss.school_id = ? AND ss.class_id = ? AND ss.kind = 'harian' \
           AND ss.session_date BETWEEN ? AND ? \
         GROUP BY r.student_id",
    )
    .bind(school_id)
    .bind(class_id)
    .bind(starts)
    .bind(ends)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(sid, sakit, izin, alpa)| (sid, Absences { sakit, izin, alpa }))
        .collect())
}

pub async fn list(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<NoteFilter>,
) -> AppResult<Json<Vec<TermNoteRow>>> {
    require_role(&user, READ_ROLES)?;
    let year: Uuid =
        sqlx::query_scalar("SELECT academic_year_id FROM classes WHERE id = ? AND school_id = ?")
            .bind(f.class_id)
            .bind(user.school_id)
            .fetch_optional(&st.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    let (starts, ends) = semester_range(&st.pool, user.school_id, f.semester_id, year).await?;

    let rows: Vec<NoteDbRow> = sqlx::query_as(
        "SELECT s.id, s.nis, s.name, n.attitude, n.extracurricular, n.homeroom_note \
         FROM class_enrollments en JOIN students s ON s.id = en.student_id \
         LEFT JOIN student_term_notes n ON n.student_id = s.id AND n.semester_id = ? \
         WHERE en.class_id = ? AND en.school_id = ? ORDER BY s.name",
    )
    .bind(f.semester_id)
    .bind(f.class_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;

    let absences = term_absences(&st.pool, user.school_id, f.class_id, starts, ends).await?;
    Ok(Json(
        rows.into_iter()
            .map(
                |(sid, nis, name, attitude, extracurricular, homeroom_note)| TermNoteRow {
                    student_id: sid,
                    nis,
                    name,
                    attitude,
                    extracurricular,
                    homeroom_note,
                    absences: absences.get(&sid).cloned().unwrap_or_default(),
                },
            )
            .collect(),
    ))
}

pub async fn save(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<NotesInput>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, READ_ROLES)?;
    ensure_homeroom_or_admin(&st.pool, &user, user.school_id, input.class_id).await?;
    let year: Uuid =
        sqlx::query_scalar("SELECT academic_year_id FROM classes WHERE id = ? AND school_id = ?")
            .bind(input.class_id)
            .bind(user.school_id)
            .fetch_optional(&st.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    semester_range(&st.pool, user.school_id, input.semester_id, year).await?;

    let roster: std::collections::HashSet<Uuid> = sqlx::query_scalar(
        "SELECT student_id FROM class_enrollments WHERE class_id = ? AND school_id = ?",
    )
    .bind(input.class_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?
    .into_iter()
    .collect();

    let mut issues = Vec::new();
    for (i, n) in input.notes.iter().enumerate() {
        if !roster.contains(&n.student_id) {
            issues.push(FieldIssue::new(
                format!("notes[{i}].student_id"),
                "siswa bukan anggota kelas ini",
            ));
        }
        for (field, value) in [
            ("attitude", &n.attitude),
            ("extracurricular", &n.extracurricular),
            ("homeroom_note", &n.homeroom_note),
        ] {
            if value.as_deref().is_some_and(|v| v.chars().count() > 1000) {
                issues.push(FieldIssue::new(
                    format!("notes[{i}].{field}"),
                    "maksimal 1000 karakter",
                ));
            }
        }
    }
    if !issues.is_empty() {
        return Err(AppError::Validation(issues));
    }

    let clean = |v: &Option<String>| {
        v.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let mut tx = st.pool.begin().await?;
    for n in &input.notes {
        sqlx::query(
            "INSERT INTO student_term_notes (id, school_id, class_id, semester_id, student_id, attitude, extracurricular, homeroom_note) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new \
             ON DUPLICATE KEY UPDATE attitude = new.attitude, extracurricular = new.extracurricular, \
                 homeroom_note = new.homeroom_note, updated_at = UTC_TIMESTAMP(6)",
        )
        .bind(Uuid::new_v4())
        .bind(user.school_id)
        .bind(input.class_id)
        .bind(input.semester_id)
        .bind(n.student_id)
        .bind(clean(&n.attitude))
        .bind(clean(&n.extracurricular))
        .bind(clean(&n.homeroom_note))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "saved": input.notes.len() })))
}

// ---------- Rapor: sikap, ekstrakurikuler, dan master kegiatan ----------
//
// Predikat sikap dan ekstrakurikuler hanya A, B, C, atau D. Untuk sikap, predikat
// kosong (null atau spasi) berarti nilai dihapus. Ekstrakurikuler selalu wajib predikat.

const PREDIKAT: &[&str] = &["A", "B", "C", "D"];
const ASPECTS: &[&str] = &["spiritual", "sosial"];
const KETERANGAN_MAX: usize = 500;

/// Sikap satu aspek: (aspek, predikat, deskripsi). Dipakai raport.
pub type AttitudeEntry = (String, String, Option<String>);
/// Ekstrakurikuler satu kegiatan: (nama kegiatan, predikat, keterangan). Dipakai raport.
pub type ExtraEntry = (String, String, Option<String>);

#[derive(Serialize, FromRow, Clone)]
pub struct Activity {
    pub id: Uuid,
    pub name: String,
}

#[derive(Deserialize)]
pub struct ActivityInput {
    pub name: String,
}

#[derive(Serialize, Clone)]
pub struct AttitudeCell {
    pub predicate: String,
    pub description: Option<String>,
}

#[derive(Serialize)]
pub struct AttitudeRow {
    pub student_id: Uuid,
    pub nis: String,
    pub name: String,
    pub spiritual: Option<AttitudeCell>,
    pub sosial: Option<AttitudeCell>,
}

#[derive(Deserialize)]
pub struct AttitudeUpdate {
    pub student_id: Uuid,
    /// "spiritual" atau "sosial".
    pub aspect: String,
    /// Kosong atau null menghapus sikap aspek ini untuk siswa tersebut.
    pub predicate: Option<String>,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct AttitudesInput {
    pub class_id: Uuid,
    pub semester_id: Uuid,
    pub items: Vec<AttitudeUpdate>,
}

#[derive(Serialize, Clone)]
pub struct ExtraItem {
    pub activity_id: Uuid,
    pub activity: String,
    pub predicate: String,
    pub description: Option<String>,
}

#[derive(Serialize)]
pub struct ExtraRow {
    pub student_id: Uuid,
    pub nis: String,
    pub name: String,
    pub items: Vec<ExtraItem>,
}

#[derive(Deserialize)]
pub struct ExtraItemInput {
    pub activity_id: Uuid,
    pub predicate: String,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct ExtraStudentInput {
    pub student_id: Uuid,
    /// Mengganti seluruh ekstrakurikuler siswa ini pada semester tersebut.
    pub items: Vec<ExtraItemInput>,
}

#[derive(Deserialize)]
pub struct ExtraInput {
    pub class_id: Uuid,
    pub semester_id: Uuid,
    pub students: Vec<ExtraStudentInput>,
}

fn is_predikat(value: &str) -> bool {
    PREDIKAT.contains(&value)
}

fn clean_text(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn too_long(value: &Option<String>) -> bool {
    value
        .as_deref()
        .is_some_and(|v| v.chars().count() > KETERANGAN_MAX)
}

/// Memastikan kelas milik sekolah ini dan semester termasuk tahun ajaran kelas tersebut.
async fn check_class_semester(
    pool: &MySqlPool,
    school_id: Uuid,
    class_id: Uuid,
    semester_id: Uuid,
) -> AppResult<()> {
    let year: Uuid =
        sqlx::query_scalar("SELECT academic_year_id FROM classes WHERE id = ? AND school_id = ?")
            .bind(class_id)
            .bind(school_id)
            .fetch_optional(pool)
            .await?
            .ok_or(AppError::NotFound)?;
    semester_range(pool, school_id, semester_id, year).await?;
    Ok(())
}

/// Siswa aktif di kelas: (id, nis, nama), urut nama.
async fn class_roster(
    pool: &MySqlPool,
    school_id: Uuid,
    class_id: Uuid,
) -> AppResult<Vec<(Uuid, String, String)>> {
    Ok(sqlx::query_as(
        "SELECT s.id, s.nis, s.name FROM class_enrollments en JOIN students s ON s.id = en.student_id \
         WHERE en.class_id = ? AND en.school_id = ? ORDER BY s.name",
    )
    .bind(class_id)
    .bind(school_id)
    .fetch_all(pool)
    .await?)
}

/// Master kegiatan ekstrakurikuler sekolah, urut nama.
pub async fn list_activities(
    State(st): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Vec<Activity>>> {
    require_role(&user, READ_ROLES)?;
    let rows = sqlx::query_as(
        "SELECT id, name FROM extracurricular_activities WHERE school_id = ? ORDER BY name",
    )
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

/// Hanya admin yang mengelola master kegiatan. Wali kelas memilih dari daftar ini.
pub async fn create_activity(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<ActivityInput>,
) -> AppResult<Json<Activity>> {
    require_role(&user, &[Role::Admin])?;
    let mut v = Validator::new();
    let name = v.text("name", &input.name, 1, 100);
    v.finish()?;

    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO extracurricular_activities (id, school_id, name) VALUES (?, ?, ?)")
        .bind(id)
        .bind(user.school_id)
        .bind(&name)
        .execute(&st.pool)
        .await
        .map_err(|e| AppError::from_db(e, "nama kegiatan sudah ada"))?;
    Ok(Json(Activity { id, name }))
}

/// Menghapus kegiatan dari master. Ditolak bila masih dipakai di rapor semester mana pun.
pub async fn delete_activity(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, &[Role::Admin])?;
    let result =
        sqlx::query("DELETE FROM extracurricular_activities WHERE id = ? AND school_id = ?")
            .bind(id)
            .bind(user.school_id)
            .execute(&st.pool)
            .await
            .map_err(|e| AppError::from_db(e, "kegiatan tidak bisa dihapus"))?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// Sikap spiritual dan sosial per siswa untuk satu kelas dan semester.
pub async fn list_attitudes(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<NoteFilter>,
) -> AppResult<Json<Vec<AttitudeRow>>> {
    require_role(&user, READ_ROLES)?;
    check_class_semester(&st.pool, user.school_id, f.class_id, f.semester_id).await?;
    let students = class_roster(&st.pool, user.school_id, f.class_id).await?;

    let saved: Vec<(Uuid, String, String, Option<String>)> = sqlx::query_as(
        "SELECT student_id, aspect, predicate, description FROM term_attitudes \
         WHERE school_id = ? AND semester_id = ?",
    )
    .bind(user.school_id)
    .bind(f.semester_id)
    .fetch_all(&st.pool)
    .await?;

    let rows = students
        .into_iter()
        .map(|(sid, nis, name)| {
            let cell = |aspect: &str| {
                saved
                    .iter()
                    .find(|r| r.0 == sid && r.1.as_str() == aspect)
                    .map(|r| AttitudeCell {
                        predicate: r.2.clone(),
                        description: r.3.clone(),
                    })
            };
            AttitudeRow {
                student_id: sid,
                nis,
                name,
                spiritual: cell("spiritual"),
                sosial: cell("sosial"),
            }
        })
        .collect();
    Ok(Json(rows))
}

/// Menyimpan sikap. Semua masalah dikumpulkan dulu; bila ada satu pun, tidak ada yang disimpan.
pub async fn save_attitudes(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<AttitudesInput>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, READ_ROLES)?;
    ensure_homeroom_or_admin(&st.pool, &user, user.school_id, input.class_id).await?;
    check_class_semester(&st.pool, user.school_id, input.class_id, input.semester_id).await?;
    let roster: HashSet<Uuid> = class_roster(&st.pool, user.school_id, input.class_id)
        .await?
        .into_iter()
        .map(|r| r.0)
        .collect();

    let mut issues = Vec::new();
    let mut seen = HashSet::new();
    for (i, item) in input.items.iter().enumerate() {
        let field = format!("items[{i}]");
        if !roster.contains(&item.student_id) {
            issues.push(FieldIssue::new(
                format!("{field}.student_id"),
                "siswa bukan anggota kelas ini",
            ));
        }
        if !ASPECTS.contains(&item.aspect.as_str()) {
            issues.push(FieldIssue::new(
                format!("{field}.aspect"),
                "aspek harus spiritual atau sosial",
            ));
        }
        if !seen.insert((item.student_id, item.aspect.clone())) {
            issues.push(FieldIssue::new(
                field.clone(),
                "siswa dan aspek tidak boleh dobel",
            ));
        }
        if let Some(p) = item.predicate.as_deref().map(str::trim)
            && !p.is_empty()
            && !is_predikat(p)
        {
            issues.push(FieldIssue::new(
                format!("{field}.predicate"),
                "predikat harus A, B, C, atau D",
            ));
        }
        if too_long(&item.description) {
            issues.push(FieldIssue::new(
                format!("{field}.description"),
                "maksimal 500 karakter",
            ));
        }
    }
    if !issues.is_empty() {
        return Err(AppError::Validation(issues));
    }

    let mut tx = st.pool.begin().await?;
    for item in &input.items {
        let predicate = item
            .predicate
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty());
        match predicate {
            None => {
                sqlx::query(
                    "DELETE FROM term_attitudes WHERE school_id = ? AND semester_id = ? AND student_id = ? AND aspect = ?",
                )
                .bind(user.school_id)
                .bind(input.semester_id)
                .bind(item.student_id)
                .bind(&item.aspect)
                .execute(&mut *tx)
                .await?;
            }
            Some(p) => {
                sqlx::query(
                    "INSERT INTO term_attitudes (id, school_id, semester_id, student_id, aspect, predicate, description) \
                     VALUES (?, ?, ?, ?, ?, ?, ?) AS new \
                     ON DUPLICATE KEY UPDATE predicate = new.predicate, description = new.description, \
                         updated_at = UTC_TIMESTAMP(6)",
                )
                .bind(Uuid::new_v4())
                .bind(user.school_id)
                .bind(input.semester_id)
                .bind(item.student_id)
                .bind(&item.aspect)
                .bind(p)
                .bind(clean_text(&item.description))
                .execute(&mut *tx)
                .await?;
            }
        }
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "saved": input.items.len() })))
}

/// Ekstrakurikuler per siswa untuk satu kelas dan semester.
pub async fn list_extracurriculars(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<NoteFilter>,
) -> AppResult<Json<Vec<ExtraRow>>> {
    require_role(&user, READ_ROLES)?;
    check_class_semester(&st.pool, user.school_id, f.class_id, f.semester_id).await?;
    let students = class_roster(&st.pool, user.school_id, f.class_id).await?;

    let saved: Vec<(Uuid, Uuid, String, String, Option<String>)> = sqlx::query_as(
        "SELECT te.student_id, a.id, a.name, te.predicate, te.description \
         FROM term_extracurriculars te JOIN extracurricular_activities a ON a.id = te.activity_id \
         WHERE te.school_id = ? AND te.semester_id = ? ORDER BY a.name",
    )
    .bind(user.school_id)
    .bind(f.semester_id)
    .fetch_all(&st.pool)
    .await?;

    let mut by_student: HashMap<Uuid, Vec<ExtraItem>> = HashMap::new();
    for (sid, activity_id, activity, predicate, description) in saved {
        by_student.entry(sid).or_default().push(ExtraItem {
            activity_id,
            activity,
            predicate,
            description,
        });
    }
    let rows = students
        .into_iter()
        .map(|(sid, nis, name)| ExtraRow {
            student_id: sid,
            nis,
            name,
            items: by_student.remove(&sid).unwrap_or_default(),
        })
        .collect();
    Ok(Json(rows))
}

/// Menyimpan ekstrakurikuler. Untuk setiap siswa dalam permintaan, daftar lamanya diganti seluruhnya.
pub async fn save_extracurriculars(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<ExtraInput>,
) -> AppResult<Json<serde_json::Value>> {
    require_role(&user, READ_ROLES)?;
    ensure_homeroom_or_admin(&st.pool, &user, user.school_id, input.class_id).await?;
    check_class_semester(&st.pool, user.school_id, input.class_id, input.semester_id).await?;
    let roster: HashSet<Uuid> = class_roster(&st.pool, user.school_id, input.class_id)
        .await?
        .into_iter()
        .map(|r| r.0)
        .collect();
    let activities: HashSet<Uuid> =
        sqlx::query_scalar("SELECT id FROM extracurricular_activities WHERE school_id = ?")
            .bind(user.school_id)
            .fetch_all(&st.pool)
            .await?
            .into_iter()
            .collect();

    let mut issues = Vec::new();
    let mut seen_students = HashSet::new();
    let mut total = 0usize;
    for (i, s) in input.students.iter().enumerate() {
        let field = format!("students[{i}]");
        if !roster.contains(&s.student_id) {
            issues.push(FieldIssue::new(
                format!("{field}.student_id"),
                "siswa bukan anggota kelas ini",
            ));
        }
        if !seen_students.insert(s.student_id) {
            issues.push(FieldIssue::new(
                format!("{field}.student_id"),
                "siswa dobel dalam satu permintaan",
            ));
        }
        let mut seen_activities = HashSet::new();
        for (j, it) in s.items.iter().enumerate() {
            let item_field = format!("{field}.items[{j}]");
            total += 1;
            if !activities.contains(&it.activity_id) {
                issues.push(FieldIssue::new(
                    format!("{item_field}.activity_id"),
                    "kegiatan tidak ada di master sekolah",
                ));
            }
            if !seen_activities.insert(it.activity_id) {
                issues.push(FieldIssue::new(
                    format!("{item_field}.activity_id"),
                    "kegiatan dobel untuk siswa ini",
                ));
            }
            if !is_predikat(it.predicate.trim()) {
                issues.push(FieldIssue::new(
                    format!("{item_field}.predicate"),
                    "predikat harus A, B, C, atau D",
                ));
            }
            if too_long(&it.description) {
                issues.push(FieldIssue::new(
                    format!("{item_field}.description"),
                    "maksimal 500 karakter",
                ));
            }
        }
    }
    if !issues.is_empty() {
        return Err(AppError::Validation(issues));
    }

    let mut tx = st.pool.begin().await?;
    for s in &input.students {
        sqlx::query(
            "DELETE FROM term_extracurriculars WHERE school_id = ? AND semester_id = ? AND student_id = ?",
        )
        .bind(user.school_id)
        .bind(input.semester_id)
        .bind(s.student_id)
        .execute(&mut *tx)
        .await?;
        for it in &s.items {
            sqlx::query(
                "INSERT INTO term_extracurriculars (id, school_id, semester_id, student_id, activity_id, predicate, description) \
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4())
            .bind(user.school_id)
            .bind(input.semester_id)
            .bind(s.student_id)
            .bind(it.activity_id)
            .bind(it.predicate.trim())
            .bind(clean_text(&it.description))
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "saved": total })))
}

/// Sikap semua siswa di semester tertentu untuk raport. Spiritual selalu tampil lebih dulu.
pub async fn attitudes_for_report(
    pool: &MySqlPool,
    school_id: Uuid,
    semester_id: Uuid,
) -> AppResult<HashMap<Uuid, Vec<AttitudeEntry>>> {
    let rows: Vec<(Uuid, String, String, Option<String>)> = sqlx::query_as(
        "SELECT student_id, aspect, predicate, description FROM term_attitudes \
         WHERE school_id = ? AND semester_id = ?",
    )
    .bind(school_id)
    .bind(semester_id)
    .fetch_all(pool)
    .await?;
    let mut map: HashMap<Uuid, Vec<AttitudeEntry>> = HashMap::new();
    for (sid, aspect, predicate, description) in rows {
        map.entry(sid)
            .or_default()
            .push((aspect, predicate, description));
    }
    for list in map.values_mut() {
        list.sort_by_key(|(aspect, _, _)| usize::from(aspect != "spiritual"));
    }
    Ok(map)
}

/// Ekstrakurikuler semua siswa di semester tertentu untuk raport, urut nama kegiatan.
pub async fn extras_for_report(
    pool: &MySqlPool,
    school_id: Uuid,
    semester_id: Uuid,
) -> AppResult<HashMap<Uuid, Vec<ExtraEntry>>> {
    let rows: Vec<(Uuid, String, String, Option<String>)> = sqlx::query_as(
        "SELECT te.student_id, a.name, te.predicate, te.description \
         FROM term_extracurriculars te JOIN extracurricular_activities a ON a.id = te.activity_id \
         WHERE te.school_id = ? AND te.semester_id = ? ORDER BY a.name",
    )
    .bind(school_id)
    .bind(semester_id)
    .fetch_all(pool)
    .await?;
    let mut map: HashMap<Uuid, Vec<ExtraEntry>> = HashMap::new();
    for (sid, name, predicate, description) in rows {
        map.entry(sid)
            .or_default()
            .push((name, predicate, description));
    }
    Ok(map)
}
