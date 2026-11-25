//! Validasi input yang mengumpulkan semua masalah sekaligus, supaya admin
//! bisa memperbaiki beberapa isian dalam satu kali kirim.

use crate::error::{AppError, AppResult, FieldIssue};

#[derive(Default)]
pub struct Validator {
    issues: Vec<FieldIssue>,
}

impl Validator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Teks wajib. Mengembalikan nilai yang sudah di-trim.
    pub fn text(&mut self, field: &str, value: &str, min: usize, max: usize) -> String {
        let trimmed = value.trim();
        let len = trimmed.chars().count();
        if len < min || len > max {
            self.issues.push(FieldIssue::new(
                field,
                format!("panjang harus {min}–{max} karakter"),
            ));
        }
        trimmed.to_string()
    }

    /// Teks opsional. Kosong dianggap tidak ada.
    pub fn opt_text(&mut self, field: &str, value: Option<&str>, max: usize) -> Option<String> {
        let trimmed = value.map(str::trim).filter(|s| !s.is_empty())?;
        if trimmed.chars().count() > max {
            self.issues
                .push(FieldIssue::new(field, format!("maksimal {max} karakter")));
        }
        Some(trimmed.to_string())
    }

    pub fn require(&mut self, ok: bool, field: &str, message: &str) {
        if !ok {
            self.issues.push(FieldIssue::new(field, message));
        }
    }

    pub fn finish(self) -> AppResult<()> {
        if self.issues.is_empty() {
            Ok(())
        } else {
            Err(AppError::Validation(self.issues))
        }
    }
}
