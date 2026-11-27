use std::collections::HashMap;

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{ADMIN, sertifikat::{self, Issued}};
use crate::{
    auth::{AuthUser, require_role},
    error::{AppError, AppResult, FieldIssue},
    state::AppState,
    validate::Validator,
};

const DECISIONS: &[&str] = &["naik", "tinggal", "lulus"];

#[derive(Deserialize)]
pub struct RosterFilter {
    /// Kosong = tahun ajaran yang aktif.
    pub academic_year_id: Option<Uuid>,
}

/// Satu siswa di tahun ajaran asal beserta keputusan kenaikannya bila sudah diproses.
#[derive(Serialize, FromRow)]
pub struct RosterRow {
    pub student_id: Uuid,
    pub nis: String,
    pub name: String,
    pub status: String,
    pub class_id: Uuid,
    pub class_name: String,
    pub decision: Option<String>,
    pub to_class_id: Option<Uuid>,
    pub processed_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
pub struct ProcessInput {
    pub academic_year_id: Uuid,
    /// Kode di nomor sertifikat. Kosong = slug sekolah dalam huruf besar.
    pub certificate_code: Option<String>,
    pub items: Vec<ItemInput>,
}

#[derive(Deserialize, Clone)]
pub struct ItemInput {
    pub student_id: Uuid,
    /// naik | tinggal | lulus
    pub decision: String,
    /// Wajib untuk naik dan tinggal. Harus kosong untuk lulus.
    pub to_class_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct ProcessResult {
    pub processed: usize,
    pub certificates: Vec<Issued>,
}

/// Keputusan yang sudah lolos pemeriksaan dan siap ditulis.
struct Planned {
    student_id: Uuid,
    name: String,
    decision: String,
    from_class: Uuid,
    to_class: Option<Uuid>,
    target_year: Option<Uuid>,
}

pub async fn roster(
    State(st): State<AppState>,
    user: AuthUser,
    Query(f): Query<RosterFilter>,
) -> AppResult<Json<Vec<RosterRow>>> {
    require_role(&user, ADMIN)?;
    let rows = sqlx::query_as(
        "SELECT s.id AS student_id, s.nis, s.name, s.status, c.id AS class_id, c.name AS class_name, \
                p.decision, p.to_class_id, p.processed_at \
         FROM class_enrollments e \
         JOIN students s ON s.id = e.student_id \
         JOIN classes c ON c.id = e.class_id \
         LEFT JOIN student_promotions p ON p.academic_year_id = e.academic_year_id AND p.student_id = e.student_id \
         WHERE e.school_id = ? \
           AND e.academic_year_id = COALESCE(?, (SELECT id FROM academic_years WHERE school_id = ? AND is_active = TRUE)) \
         ORDER BY c.grade_level, c.name, s.name",
    )
    .bind(user.school_id)
    .bind(f.academic_year_id)
    .bind(user.school_id)
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(rows))
}

/// Memeriksa bentuk input tanpa menyentuh database. Hasilnya diurutkan per siswa
/// supaya kunci baris selalu diambil dengan urutan yang sama.
fn validate_items(input: &ProcessInput) -> AppResult<Vec<ItemInput>> {
    let mut issues = Vec::new();
    if input.items.is_empty() {
        issues.push(FieldIssue::new("items", "pilih minimal satu siswa"));
    }

    let mut seen = std::collections::HashSet::new();
    for item in &input.items {
        if !seen.insert(item.student_id) {
            issues.push(FieldIssue::new(
                "items",
                format!("siswa {} muncul lebih dari sekali", item.student_id),
            ));
        }
        if !DECISIONS.contains(&item.decision.as_str()) {
            issues.push(FieldIssue::new("decision", "keputusan harus naik, tinggal, atau lulus"));
            continue;
        }
        match (item.decision.as_str(), item.to_class_id) {
            ("lulus", Some(_)) => issues.push(FieldIssue::new(
                "to_class_id",
                "siswa yang lulus tidak mendapat kelas tujuan",
            )),
            ("lulus", None) => {}
            (_, None) => issues.push(FieldIssue::new(
                "to_class_id",
                "kelas tujuan wajib untuk naik atau tinggal",
            )),
            _ => {}
        }
    }
    if !issues.is_empty() {
        return Err(AppError::Validation(issues));
    }

    let mut items = input.items.clone();
    items.sort_by_key(|i| i.student_id);
    Ok(items)
}

/// Memproses kenaikan satu tahun ajaran dalam satu transaksi. Bila ada satu saja
/// isian yang salah, tidak ada perubahan yang disimpan.
pub async fn process(
    State(st): State<AppState>,
    user: AuthUser,
    Json(input): Json<ProcessInput>,
) -> AppResult<Json<ProcessResult>> {
    require_role(&user, ADMIN)?;
    let items = validate_items(&input)?;

    let mut tx = st.pool.begin().await?;

    // Kunci sekolah dulu: nomor sertifikat dibuat berurutan, jadi proses per sekolah antre.
    let slug: String = sqlx::query_scalar("SELECT slug FROM schools WHERE id = ? FOR UPDATE")
        .bind(user.school_id)
        .fetch_one(&mut *tx)
        .await?;

    let code = input
        .certificate_code
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_uppercase)
        .unwrap_or_else(|| slug.to_uppercase());
    let mut v = Validator::new();
    v.require(
        (1..=20).contains(&code.chars().count())
            && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
        "certificate_code",
        "kode 1–20 karakter: huruf, angka, atau tanda hubung",
    );
    v.finish()?;

    let year_exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM academic_years WHERE id = ? AND school_id = ?")
            .bind(input.academic_year_id)
            .bind(user.school_id)
            .fetch_optional(&mut *tx)
            .await?;
    if year_exists.is_none() {
        return Err(AppError::Validation(vec![FieldIssue::new(
            "academic_year_id",
            "tahun ajaran tidak ditemukan",
        )]));
    }

    let mut issues = Vec::new();

    // Kelas tujuan dikunci lebih dulu, diurutkan agar tidak deadlock antar proses.
    let mut class_ids: Vec<Uuid> = items.iter().filter_map(|i| i.to_class_id).collect();
    class_ids.sort();
    class_ids.dedup();
    let mut target_years: HashMap<Uuid, Uuid> = HashMap::new();
    for class_id in class_ids {
        let year: Option<Uuid> = sqlx::query_scalar(
            "SELECT academic_year_id FROM classes WHERE id = ? AND school_id = ? FOR UPDATE",
        )
        .bind(class_id)
        .bind(user.school_id)
        .fetch_optional(&mut *tx)
        .await?;
        match year {
            None => issues.push(FieldIssue::new("to_class_id", format!("kelas tujuan {class_id} tidak ditemukan"))),
            Some(y) if y == input.academic_year_id => issues.push(FieldIssue::new(
                "to_class_id",
                "kelas tujuan harus berada di tahun ajaran yang berbeda",
            )),
            Some(y) => {
                target_years.insert(class_id, y);
            }
        }
    }

    let mut plan: Vec<Planned> = Vec::new();
    for item in &items {
        let row: Option<(String, String)> =
            sqlx::query_as("SELECT name, status FROM students WHERE id = ? AND school_id = ? FOR UPDATE")
                .bind(item.student_id)
                .bind(user.school_id)
                .fetch_optional(&mut *tx)
                .await?;
        let Some((name, status)) = row else {
            issues.push(FieldIssue::new("items", format!("siswa {} tidak ditemukan", item.student_id)));
            continue;
        };
        if status != "aktif" {
            issues.push(FieldIssue::new("items", format!("{name} tidak berstatus aktif")));
            continue;
        }

        let from_class: Option<Uuid> = sqlx::query_scalar(
            "SELECT class_id FROM class_enrollments \
             WHERE academic_year_id = ? AND student_id = ? AND school_id = ? FOR UPDATE",
        )
        .bind(input.academic_year_id)
        .bind(item.student_id)
        .bind(user.school_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(from_class) = from_class else {
            issues.push(FieldIssue::new(
                "items",
                format!("{name} belum punya rombel di tahun ajaran ini"),
            ));
            continue;
        };

        let already: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM student_promotions WHERE academic_year_id = ? AND student_id = ?",
        )
        .bind(input.academic_year_id)
        .bind(item.student_id)
        .fetch_optional(&mut *tx)
        .await?;
        if already.is_some() {
            issues.push(FieldIssue::new(
                "items",
                format!("{name} sudah diproses pada tahun ajaran ini"),
            ));
            continue;
        }

        let (to_class, target_year) = match (item.decision.as_str(), item.to_class_id) {
            ("lulus", _) => (None, None),
            (_, Some(class)) => match target_years.get(&class) {
                Some(year) => {
                    let taken: Option<i64> = sqlx::query_scalar(
                        "SELECT 1 FROM class_enrollments WHERE academic_year_id = ? AND student_id = ?",
                    )
                    .bind(*year)
                    .bind(item.student_id)
                    .fetch_optional(&mut *tx)
                    .await?;
                    if taken.is_some() {
                        issues.push(FieldIssue::new(
                            "items",
                            format!("{name} sudah punya rombel di tahun ajaran tujuan"),
                        ));
                        continue;
                    }
                    (Some(class), Some(*year))
                }
                // Kelas tujuan tidak valid; masalahnya sudah dicatat di atas.
                None => continue,
            },
            _ => continue,
        };

        plan.push(Planned {
            student_id: item.student_id,
            name,
            decision: item.decision.clone(),
            from_class,
            to_class,
            target_year,
        });
    }

    if !issues.is_empty() {
        tx.rollback().await?;
        return Err(AppError::Validation(issues));
    }

    let mut certificates = Vec::new();
    for p in &plan {
        sqlx::query(
            "INSERT INTO student_promotions \
             (id, school_id, academic_year_id, student_id, from_class_id, decision, to_class_id, processed_by) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4())
        .bind(user.school_id)
        .bind(input.academic_year_id)
        .bind(p.student_id)
        .bind(p.from_class)
        .bind(&p.decision)
        .bind(p.to_class)
        .bind(user.user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::from_db(e, "kenaikan siswa ini sudah tercatat"))?;

        if p.decision == "lulus" {
            let issued = sertifikat::ensure_for_student(
                &mut *tx,
                user.school_id,
                p.student_id,
                input.academic_year_id,
                &code,
                user.user_id,
            )
            .await?;
            sqlx::query("UPDATE students SET status = 'lulus' WHERE id = ? AND school_id = ?")
                .bind(p.student_id)
                .bind(user.school_id)
                .execute(&mut *tx)
                .await?;
            certificates.push(issued);
        } else if let (Some(class), Some(year)) = (p.to_class, p.target_year) {
            sqlx::query(
                "INSERT INTO class_enrollments (id, school_id, academic_year_id, class_id, student_id) \
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4())
            .bind(user.school_id)
            .bind(year)
            .bind(class)
            .bind(p.student_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::from_db(e, &format!("{} sudah punya rombel di tahun ajaran tujuan", p.name)))?;
        }
    }

    tx.commit().await?;
    Ok(Json(ProcessResult {
        processed: plan.len(),
        certificates,
    }))
}
