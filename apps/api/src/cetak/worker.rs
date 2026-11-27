//! Pekerja cetak massal.
//!
//! Untuk tiap sekolah hanya satu job `proses` sekaligus. Penjaganya kunci GET_LOCK MySQL,
//! sehingga tetap berlaku bila ada lebih dari satu replika API. Siswa yang gagal dirender
//! dicatat di job, sedangkan siswa lain tetap diproses.

use std::{collections::HashSet, io::Write};

use anyhow::{Result, anyhow};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

use super::{ANTREAN, GAGAL, PROSES, SELESAI, zip_dir};
use crate::{
    error::AppError,
    grades::{render, reports},
    lms::storage::sanitize_name,
    state::AppState,
};

/// Siswa yang gagal dirender, dicatat di job.
#[derive(Serialize)]
struct Gagal {
    nis: String,
    nama: String,
    pesan: String,
}

/// Menjadwalkan pemrosesan antrean sekolah di latar belakang. Aman dipanggil berkali-kali.
pub fn kick(st: AppState, school: Uuid) {
    tokio::spawn(async move {
        if let Err(e) = drain(&st, school).await {
            tracing::error!(error = ?e, %school, "antrean cetak massal terhenti");
        }
    });
}

/// Menyambung antrean yang belum selesai saat server dinyalakan (mis. setelah restart).
pub async fn resume_pending(st: &AppState) -> Result<()> {
    let schools: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT school_id FROM report_jobs WHERE status IN ('antrean', 'proses')",
    )
    .fetch_all(&st.pool)
    .await?;
    for school in schools {
        kick(st.clone(), school);
    }
    Ok(())
}

fn lock_name(school: Uuid) -> String {
    format!("cetak_massal_{}", school.simple())
}

fn truncate(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// Mengubah error handler menjadi error biasa dengan pesan yang bisa dibaca.
fn describe(e: AppError) -> anyhow::Error {
    match e {
        AppError::Validation(issues) => anyhow!(
            issues
                .into_iter()
                .map(|i| i.message)
                .collect::<Vec<_>>()
                .join("; ")
        ),
        AppError::Internal(inner) => inner,
        other => anyhow!(other.to_string()),
    }
}

async fn drain(st: &AppState, school: Uuid) -> Result<()> {
    loop {
        let mut conn = st.pool.acquire().await?;
        let locked: Option<i64> = sqlx::query_scalar("SELECT GET_LOCK(?, 0)")
            .bind(lock_name(school))
            .fetch_one(&mut *conn)
            .await?;
        if locked != Some(1) {
            // Worker lain sedang memegang sekolah ini. Ia memeriksa antrean lagi setelah melepas kunci.
            return Ok(());
        }

        let result = run_queue(st, school).await;

        let released: Result<i64, _> = sqlx::query_scalar("SELECT RELEASE_LOCK(?)")
            .bind(lock_name(school))
            .fetch_one(&mut *conn)
            .await;
        if released.is_err() {
            // Kunci tidak bisa dilepas: buang koneksinya agar MySQL melepas kunci saat sesi ditutup.
            conn.detach();
        }
        result?;

        // Job yang masuk saat kunci dipegang tidak boleh terlewat: periksa lagi setelah kunci dilepas.
        let pending: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM report_jobs WHERE school_id = ? AND status = ?",
        )
        .bind(school)
        .bind(ANTREAN)
        .fetch_one(&st.pool)
        .await?;
        if pending == 0 {
            return Ok(());
        }
    }
}

/// Dipanggil saat kunci sekolah dipegang. Mengambil job antrean satu per satu sampai habis.
async fn run_queue(st: &AppState, school: Uuid) -> Result<()> {
    // Job yang masih 'proses' saat kunci dipegang berarti proses sebelumnya terputus. Ulangi dari awal.
    sqlx::query(
        "UPDATE report_jobs SET status = ?, selesai = 0, errors = NULL, started_at = NULL \
         WHERE school_id = ? AND status = ?",
    )
    .bind(ANTREAN)
    .bind(school)
    .bind(PROSES)
    .execute(&st.pool)
    .await?;

    loop {
        let next: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM report_jobs WHERE school_id = ? AND status = ? ORDER BY created_at, id LIMIT 1",
        )
        .bind(school)
        .bind(ANTREAN)
        .fetch_optional(&st.pool)
        .await?;
        let Some(job) = next else {
            return Ok(());
        };

        if let Err(e) = process(st, school, job).await {
            tracing::error!(error = ?e, %job, "cetak massal gagal");
            let _ = tokio::fs::remove_file(
                zip_dir(&st.upload_dir, school).join(format!("{}.part", job.simple())),
            )
            .await;
            sqlx::query(
                "UPDATE report_jobs SET status = ?, error_message = ?, finished_at = UTC_TIMESTAMP(6) WHERE id = ?",
            )
            .bind(GAGAL)
            .bind(truncate(&format!("{e:#}"), 500))
            .bind(job)
            .execute(&st.pool)
            .await?;
        }
    }
}

/// Menulis satu raport ke ZIP. Render yang gagal dikembalikan sebagai `Err(pesan)` (per siswa),
/// sedangkan error menulis ZIP dikembalikan sebagai error job.
fn tulis_raport(
    writer: &mut ZipWriter<std::fs::File>,
    name: &str,
    data: &Value,
) -> Result<std::result::Result<(), String>> {
    let bytes = match render::render_pdf(data) {
        Ok(bytes) => bytes,
        Err(pesan) => return Ok(Err(pesan)),
    };
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    writer.start_file(name, options)?;
    writer.write_all(&bytes)?;
    Ok(Ok(()))
}

/// Memproses satu job: render tiap siswa, tulis ke ZIP sementara, lalu ganti menjadi berkas akhir.
async fn process(st: &AppState, school: Uuid, job: Uuid) -> Result<()> {
    let (class_id, semester_id): (Uuid, Uuid) =
        sqlx::query_as("SELECT class_id, semester_id FROM report_jobs WHERE id = ?")
            .bind(job)
            .fetch_one(&st.pool)
            .await?;
    sqlx::query("UPDATE report_jobs SET status = ?, started_at = UTC_TIMESTAMP(6), selesai = 0 WHERE id = ?")
        .bind(PROSES)
        .bind(job)
        .execute(&st.pool)
        .await?;

    let (_, students) = reports::build_class_data(&st.pool, school, class_id, semester_id)
        .await
        .map_err(describe)?;
    sqlx::query("UPDATE report_jobs SET total = ? WHERE id = ?")
        .bind(students.len() as u32)
        .bind(job)
        .execute(&st.pool)
        .await?;

    let dir = zip_dir(&st.upload_dir, school);
    tokio::fs::create_dir_all(&dir).await?;
    let part = dir.join(format!("{}.part", job.simple()));
    let mut zip = Some(ZipWriter::new(std::fs::File::create(&part)?));

    let mut names: HashSet<String> = HashSet::new();
    let mut gagal: Vec<Gagal> = Vec::new();
    let mut berhasil = 0usize;

    for (index, (sid, nis, data)) in students.into_iter().enumerate() {
        let nama = data["student"]["name"].as_str().unwrap_or_default().to_string();
        let mut name = sanitize_name(&format!("raport-{nis}.pdf"));
        if !names.insert(name.clone()) {
            name = sanitize_name(&format!("raport-{nis}-{}.pdf", sid.simple()));
            names.insert(name.clone());
        }

        let writer = zip.take().ok_or_else(|| anyhow!("berkas ZIP tidak tersedia"))?;
        // Render PDF bersifat CPU-bound, jadi dikerjakan di thread blocking.
        let (writer, outcome) = tokio::task::spawn_blocking(move || {
            let mut writer = writer;
            let outcome = tulis_raport(&mut writer, &name, &data);
            (writer, outcome)
        })
        .await?;
        zip = Some(writer);

        match outcome? {
            Ok(()) => berhasil += 1,
            Err(pesan) => gagal.push(Gagal { nis, nama, pesan }),
        }

        sqlx::query("UPDATE report_jobs SET selesai = ? WHERE id = ?")
            .bind((index + 1) as u32)
            .bind(job)
            .execute(&st.pool)
            .await?;
    }

    let writer = zip.take().ok_or_else(|| anyhow!("berkas ZIP tidak tersedia"))?;
    let file = tokio::task::spawn_blocking(move || -> Result<std::fs::File> {
        let file = writer.finish()?;
        file.sync_all()?;
        Ok(file)
    })
    .await??;
    drop(file);

    let errors = (!gagal.is_empty())
        .then(|| serde_json::to_string(&gagal))
        .transpose()?;

    if berhasil == 0 {
        let _ = tokio::fs::remove_file(&part).await;
        sqlx::query(
            "UPDATE report_jobs SET status = ?, errors = ?, error_message = ?, finished_at = UTC_TIMESTAMP(6) WHERE id = ?",
        )
        .bind(GAGAL)
        .bind(errors)
        .bind("semua siswa gagal dirender")
        .bind(job)
        .execute(&st.pool)
        .await?;
        return Ok(());
    }

    let file_name = format!("{}.zip", job.simple());
    tokio::fs::rename(&part, dir.join(&file_name)).await?;
    sqlx::query(
        "UPDATE report_jobs SET status = ?, file_path = ?, errors = ?, finished_at = UTC_TIMESTAMP(6) WHERE id = ?",
    )
    .bind(SELESAI)
    .bind(&file_name)
    .bind(errors)
    .bind(job)
    .execute(&st.pool)
    .await?;
    tracing::info!(%job, %school, berhasil, gagal = gagal.len(), "cetak massal selesai");
    Ok(())
}
