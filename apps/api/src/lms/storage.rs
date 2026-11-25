//! Penyimpanan berkas LMS: validasi isi dan nama, lalu tulis/baca di disk.
//!
//! Berkas di disk diberi nama acak (bukan nama dari klien). Ekstensi dan tanda awal file
//! (magic bytes) harus cocok dengan allowlist. Nama asli hanya disimpan sebagai metadata.

use std::path::{Path, PathBuf};

use axum::extract::multipart::{Field, MultipartError};
use uuid::Uuid;

use crate::error::{AppError, AppResult, FieldIssue};

/// Ukuran maksimum satu berkas.
pub const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;
/// Jumlah berkas maksimum per pengumpulan.
pub const MAX_FILES_PER_SUBMISSION: usize = 5;
/// Batas badan permintaan untuk rute unggah (berkas + overhead multipart).
pub const MAX_REQUEST_BYTES: usize = 22 * 1024 * 1024;

const OOXML_MAGIC: &[u8] = b"PK\x03\x04";

/// Berkas yang lolos pemeriksaan.
#[derive(Debug, PartialEq, Eq)]
pub struct Checked {
    pub display_name: String,
    pub mime: &'static str,
}

/// Allowlist: ekstensi -> (mime, tanda awal yang wajib cocok). Kosong = tidak diperiksa tanda awalnya.
fn rule(ext: &str) -> Option<(&'static str, &'static [u8])> {
    Some(match ext {
        "pdf" => ("application/pdf", b"%PDF-"),
        "png" => ("image/png", b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => ("image/jpeg", b"\xFF\xD8\xFF"),
        "docx" => (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            OOXML_MAGIC,
        ),
        "pptx" => (
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            OOXML_MAGIC,
        ),
        "xlsx" => (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            OOXML_MAGIC,
        ),
        "txt" => ("text/plain; charset=utf-8", b""),
        _ => return None,
    })
}

/// Nama tampilan yang aman: hanya huruf, angka, spasi, titik, garis bawah, dan strip.
/// Path komponen (`../`, `C:\`) dibuang.
pub fn sanitize_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-'))
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    let truncated: String = trimmed.chars().take(120).collect();
    if truncated.is_empty() {
        "berkas".to_string()
    } else {
        truncated
    }
}

/// Memeriksa nama dan isi berkas. Pesan error dipakai langsung untuk respons 422.
pub fn check(raw_name: &str, bytes: &[u8]) -> Result<Checked, String> {
    if bytes.is_empty() {
        return Err("berkas kosong".to_string());
    }
    if bytes.len() > MAX_FILE_BYTES {
        return Err("ukuran berkas melebihi 10 MB".to_string());
    }
    let name = sanitize_name(raw_name);
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    let Some((mime, magic)) = rule(&ext) else {
        return Err(
            "tipe berkas tidak diizinkan (pdf, docx, pptx, xlsx, png, jpg, txt)".to_string(),
        );
    };
    if !magic.is_empty() && !bytes.starts_with(magic) {
        return Err("isi berkas tidak sesuai dengan ekstensinya".to_string());
    }
    if ext == "txt" && (bytes.contains(&0) || std::str::from_utf8(bytes).is_err()) {
        return Err("berkas teks harus berkode UTF-8 tanpa byte nol".to_string());
    }
    Ok(Checked {
        display_name: name,
        mime,
    })
}

/// Nama header `Content-Disposition` yang hanya berisi ASCII aman.
pub fn ascii_name(name: &str) -> String {
    let safe: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-'))
        .collect();
    if safe.is_empty() {
        "berkas".to_string()
    } else {
        safe
    }
}

pub fn new_stored_name() -> String {
    Uuid::new_v4().simple().to_string()
}

fn path_for(upload_dir: &Path, school_id: Uuid, stored: &str) -> PathBuf {
    upload_dir
        .join("lms")
        .join(school_id.simple().to_string())
        .join(stored)
}

pub async fn write(
    upload_dir: &Path,
    school_id: Uuid,
    stored: &str,
    bytes: &[u8],
) -> AppResult<()> {
    let path = path_for(upload_dir, school_id, stored);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
    }
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|e| AppError::Internal(e.into()))
}

pub async fn read(upload_dir: &Path, school_id: Uuid, stored: &str) -> AppResult<Vec<u8>> {
    tokio::fs::read(path_for(upload_dir, school_id, stored))
        .await
        .map_err(|e| AppError::Internal(e.into()))
}

/// Menghapus berkas di disk. Kegagalan tidak menggagalkan permintaan (berkas yatim bisa dibersihkan nanti).
pub async fn remove(upload_dir: &Path, school_id: Uuid, stored: &str) {
    let _ = tokio::fs::remove_file(path_for(upload_dir, school_id, stored)).await;
}

/// Membaca isi satu field berkas sambil memeriksa batas ukuran.
pub async fn read_limited(field: &mut Field<'_>) -> AppResult<Vec<u8>> {
    let mut buf = Vec::new();
    while let Some(chunk) = field.chunk().await.map_err(form_error)? {
        if buf.len() + chunk.len() > MAX_FILE_BYTES {
            return Err(AppError::Validation(vec![FieldIssue::new(
                "file",
                "ukuran berkas melebihi 10 MB",
            )]));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

pub fn form_error(e: MultipartError) -> AppError {
    AppError::Validation(vec![FieldIssue::new(
        "form",
        format!("formulir tidak valid: {e}"),
    )])
}

pub fn file_issue(message: String) -> AppError {
    AppError::Validation(vec![FieldIssue::new("file", message)])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_pdf_with_matching_magic() {
        let c = check("Bab 1.pdf", b"%PDF-1.4 isi").unwrap();
        assert_eq!(c.display_name, "Bab 1.pdf");
        assert_eq!(c.mime, "application/pdf");
    }

    #[test]
    fn rejects_executables_and_double_extensions() {
        assert!(check("setup.exe", b"MZ....").is_err());
        assert!(check("laporan.pdf.exe", b"%PDF-1.4").is_err());
        assert!(check("skrip.sh", b"#!/bin/sh").is_err());
        assert!(check("halaman.html", b"<script>").is_err());
        assert!(check("arsip.zip", b"PK\x03\x04").is_err());
    }

    #[test]
    fn rejects_mismatched_content() {
        assert!(check("fake.pdf", b"hello").is_err());
        assert!(check("gambar.png", b"%PDF-1.4").is_err());
        assert!(check("dokumen.docx", b"%PDF-1.4").is_err());
    }

    #[test]
    fn txt_must_be_utf8_without_nul() {
        assert!(check("catatan.txt", "halo dunia".as_bytes()).is_ok());
        assert!(check("catatan.txt", &[0x68, 0x00, 0x69]).is_err());
        assert!(check("catatan.txt", &[0xFF, 0xFE, 0xFD]).is_err());
    }

    #[test]
    fn rejects_empty_and_oversized() {
        assert!(check("kosong.txt", b"").is_err());
        let big = vec![b'a'; MAX_FILE_BYTES + 1];
        assert!(check("besar.txt", &big).is_err());
    }

    #[test]
    fn sanitizes_path_and_odd_characters() {
        assert_eq!(sanitize_name("../../etc/passwd.txt"), "passwd.txt");
        assert_eq!(
            sanitize_name("C:\\data\\Laporan #1!.docx"),
            "Laporan 1.docx"
        );
        assert_eq!(sanitize_name("...."), "berkas");
    }
}
