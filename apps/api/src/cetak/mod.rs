//! Cetak massal rapor: satu job per kelas dan semester.
//!
//! Job disimpan di `report_jobs` dan diproses di latar belakang oleh `worker`. Hasilnya berupa ZIP
//! di `UPLOAD_DIR/cetak/<sekolah>/`. Hanya satu job `proses` per sekolah pada satu waktu.

pub mod jobs;
pub mod worker;

use std::path::{Path, PathBuf};

use uuid::Uuid;

pub const ANTREAN: &str = "antrean";
pub const PROSES: &str = "proses";
pub const SELESAI: &str = "selesai";
pub const GAGAL: &str = "gagal";

/// Folder hasil cetak massal untuk satu sekolah. Berkas tidak disajikan sebagai static file.
pub fn zip_dir(upload_dir: &Path, school_id: Uuid) -> PathBuf {
    upload_dir
        .join("cetak")
        .join(school_id.simple().to_string())
}
