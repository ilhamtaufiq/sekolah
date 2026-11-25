//! Model pengaturan format raport, validasi, dan normalisasi.
//!
//! Format disimpan sebagai JSON per sekolah. Semua aturan bisnis ada di sini
//! supaya bisa diuji tanpa database dan dipakai ulang oleh endpoint restore.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::error::FieldIssue;

pub const SCHEMA_VERSION: u32 = 1;
pub const ALLOWED_FONTS: &[&str] = &["Times New Roman", "Arial", "Calibri", "Georgia", "Tahoma"];
const MAX_SECTIONS: usize = 7;
const MAX_PREDICATES: usize = 10;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReportFormat {
    pub schema_version: u32,
    pub kop: Kop,
    pub page: Page,
    pub grading: Grading,
    /// Urutan bagian di raport. Yang tidak ada di daftar tidak dicetak.
    pub sections: Vec<SectionKind>,
    pub signatures: Signatures,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Kop {
    pub title: String,
    pub subtitle: Option<String>,
    pub address: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    pub paper: PaperSize,
    pub margin_mm: f64,
    pub font_family: String,
    pub font_size_pt: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaperSize {
    A4,
    F4,
    Letter,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grading {
    pub min_score: f64,
    pub max_score: f64,
    pub kkm: f64,
    pub decimal_places: u8,
    /// Predikat harus menutup seluruh rentang: harus ada yang `min == min_score`.
    pub predicates: Vec<Predicate>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Predicate {
    pub label: String,
    pub min: f64,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SectionKind {
    NilaiAkademik,
    Sikap,
    Ekstrakurikuler,
    Absensi,
    Prestasi,
    CatatanWaliKelas,
    Ranking,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Signatures {
    pub city: String,
    pub wali_kelas_title: String,
    pub kepala_sekolah_name: String,
    pub kepala_sekolah_nip: Option<String>,
}

impl Default for ReportFormat {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            kop: Kop {
                title: "Nama Sekolah".into(),
                subtitle: None,
                address: "Alamat sekolah".into(),
            },
            page: Page {
                paper: PaperSize::A4,
                margin_mm: 20.0,
                font_family: "Times New Roman".into(),
                font_size_pt: 11.0,
            },
            grading: Grading {
                min_score: 0.0,
                max_score: 100.0,
                kkm: 75.0,
                decimal_places: 0,
                predicates: vec![
                    Predicate {
                        label: "A".into(),
                        min: 90.0,
                        description: Some("Sangat baik".into()),
                    },
                    Predicate {
                        label: "B".into(),
                        min: 80.0,
                        description: Some("Baik".into()),
                    },
                    Predicate {
                        label: "C".into(),
                        min: 75.0,
                        description: Some("Cukup".into()),
                    },
                    Predicate {
                        label: "D".into(),
                        min: 0.0,
                        description: Some("Perlu bimbingan".into()),
                    },
                ],
            },
            sections: vec![
                SectionKind::NilaiAkademik,
                SectionKind::Sikap,
                SectionKind::Ekstrakurikuler,
                SectionKind::Absensi,
                SectionKind::CatatanWaliKelas,
            ],
            signatures: Signatures {
                city: "Kota".into(),
                wali_kelas_title: "Wali Kelas".into(),
                kepala_sekolah_name: "Nama Kepala Sekolah".into(),
                kepala_sekolah_nip: None,
            },
        }
    }
}

impl ReportFormat {
    /// Merapikan input: trim teks, kosongkan opsional yang kosong, urutkan predikat dari tertinggi.
    pub fn normalize(mut self) -> Self {
        self.kop.title = self.kop.title.trim().to_string();
        self.kop.subtitle = trim_opt(self.kop.subtitle);
        self.kop.address = self.kop.address.trim().to_string();
        self.page.font_family = self.page.font_family.trim().to_string();
        self.signatures.city = self.signatures.city.trim().to_string();
        self.signatures.wali_kelas_title = self.signatures.wali_kelas_title.trim().to_string();
        self.signatures.kepala_sekolah_name =
            self.signatures.kepala_sekolah_name.trim().to_string();
        self.signatures.kepala_sekolah_nip = trim_opt(self.signatures.kepala_sekolah_nip);

        for p in &mut self.grading.predicates {
            p.label = p.label.trim().to_string();
            p.description = trim_opt(p.description.take());
        }
        self.grading.predicates.sort_by(|a, b| {
            b.min
                .partial_cmp(&a.min)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        self
    }

    /// Mengembalikan semua masalah sekaligus, supaya admin bisa memperbaiki dalam satu kali kirim.
    pub fn validate(&self) -> Vec<FieldIssue> {
        let mut issues = Vec::new();

        if self.schema_version != SCHEMA_VERSION {
            issues.push(FieldIssue::new(
                "schema_version",
                format!("versi skema {} tidak didukung", self.schema_version),
            ));
        }

        // Kop
        check_len(&mut issues, "kop.title", &self.kop.title, 1, 120);
        if let Some(sub) = &self.kop.subtitle {
            check_len(&mut issues, "kop.subtitle", sub, 1, 120);
        }
        check_len(&mut issues, "kop.address", &self.kop.address, 1, 300);

        // Halaman
        if !(5.0..=40.0).contains(&self.page.margin_mm) {
            issues.push(FieldIssue::new("page.margin_mm", "margin harus 5–40 mm"));
        }
        if !(8.0..=14.0).contains(&self.page.font_size_pt) {
            issues.push(FieldIssue::new(
                "page.font_size_pt",
                "ukuran huruf harus 8–14 pt",
            ));
        }
        if !ALLOWED_FONTS.contains(&self.page.font_family.as_str()) {
            issues.push(FieldIssue::new(
                "page.font_family",
                format!("font harus salah satu dari: {}", ALLOWED_FONTS.join(", ")),
            ));
        }

        // Penilaian
        let g = &self.grading;
        if g.min_score < 0.0 || g.max_score > 1000.0 || g.min_score >= g.max_score {
            issues.push(FieldIssue::new(
                "grading.max_score",
                "rentang nilai tidak valid: min >= 0, max <= 1000, dan min < max",
            ));
        }
        if !(g.min_score..=g.max_score).contains(&g.kkm) {
            issues.push(FieldIssue::new(
                "grading.kkm",
                "KKM harus berada di dalam rentang nilai",
            ));
        }
        if g.decimal_places > 2 {
            issues.push(FieldIssue::new(
                "grading.decimal_places",
                "jumlah desimal maksimal 2",
            ));
        }

        // Predikat
        let preds = &g.predicates;
        if preds.is_empty() || preds.len() > MAX_PREDICATES {
            issues.push(FieldIssue::new(
                "grading.predicates",
                format!("predikat harus 1–{MAX_PREDICATES} item"),
            ));
        }
        let mut labels = HashSet::new();
        let mut mins = HashSet::new();
        for (i, p) in preds.iter().enumerate() {
            let field = format!("grading.predicates[{i}]");
            check_len(&mut issues, &format!("{field}.label"), &p.label, 1, 10);
            if !labels.insert(p.label.to_lowercase()) {
                issues.push(FieldIssue::new(
                    format!("{field}.label"),
                    "label predikat harus unik",
                ));
            }
            if !(g.min_score..=g.max_score).contains(&p.min) {
                issues.push(FieldIssue::new(
                    format!("{field}.min"),
                    "batas bawah di luar rentang nilai",
                ));
            }
            if !mins.insert(p.min.to_bits()) {
                issues.push(FieldIssue::new(
                    format!("{field}.min"),
                    "batas bawah predikat harus unik",
                ));
            }
        }
        if !preds.iter().any(|p| p.min == g.min_score) {
            issues.push(FieldIssue::new(
                "grading.predicates",
                "harus ada predikat dengan batas bawah sama dengan nilai minimum",
            ));
        }

        // Bagian raport
        if self.sections.is_empty() || self.sections.len() > MAX_SECTIONS {
            issues.push(FieldIssue::new(
                "sections",
                format!("bagian harus 1–{MAX_SECTIONS} item"),
            ));
        }
        let unique: HashSet<_> = self.sections.iter().collect();
        if unique.len() != self.sections.len() {
            issues.push(FieldIssue::new("sections", "bagian tidak boleh duplikat"));
        }

        // Tanda tangan
        check_len(&mut issues, "signatures.city", &self.signatures.city, 1, 60);
        check_len(
            &mut issues,
            "signatures.wali_kelas_title",
            &self.signatures.wali_kelas_title,
            1,
            80,
        );
        check_len(
            &mut issues,
            "signatures.kepala_sekolah_name",
            &self.signatures.kepala_sekolah_name,
            1,
            120,
        );
        if let Some(nip) = &self.signatures.kepala_sekolah_nip {
            check_len(&mut issues, "signatures.kepala_sekolah_nip", nip, 1, 30);
        }

        issues
    }
}

fn trim_opt(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn check_len(issues: &mut Vec<FieldIssue>, field: &str, value: &str, min: usize, max: usize) {
    let len = value.chars().count();
    if len < min || len > max {
        issues.push(FieldIssue::new(
            field,
            format!("panjang harus {min}–{max} karakter"),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_valid() {
        assert!(ReportFormat::default().validate().is_empty());
    }

    #[test]
    fn normalize_sorts_predicates_descending() {
        let f = ReportFormat::default();
        let mut shuffled = f.clone();
        shuffled.grading.predicates.reverse();
        let normalized = shuffled.normalize();
        assert_eq!(normalized.grading.predicates, f.grading.predicates);
    }

    #[test]
    fn normalize_trims_and_drops_empty_optionals() {
        let mut f = ReportFormat::default();
        f.kop.title = "  SMP Negeri 1  ".into();
        f.kop.subtitle = Some("   ".into());
        let n = f.normalize();
        assert_eq!(n.kop.title, "SMP Negeri 1");
        assert_eq!(n.kop.subtitle, None);
    }

    #[test]
    fn rejects_predicates_that_do_not_cover_min_score() {
        let mut f = ReportFormat::default();
        f.grading.predicates.retain(|p| p.min != 0.0);
        let issues = f.validate();
        assert!(issues.iter().any(|i| i.field == "grading.predicates"));
    }

    #[test]
    fn rejects_kkm_outside_range() {
        let mut f = ReportFormat::default();
        f.grading.kkm = 150.0;
        assert!(f.validate().iter().any(|i| i.field == "grading.kkm"));
    }

    #[test]
    fn rejects_duplicate_sections() {
        let mut f = ReportFormat::default();
        f.sections.push(SectionKind::Sikap);
        assert!(f.validate().iter().any(|i| i.field == "sections"));
    }

    #[test]
    fn rejects_unknown_font() {
        let mut f = ReportFormat::default();
        f.page.font_family = "Comic Sans".into();
        assert!(f.validate().iter().any(|i| i.field == "page.font_family"));
    }

    #[test]
    fn reports_all_issues_at_once() {
        let mut f = ReportFormat::default();
        f.kop.title = "".into();
        f.page.margin_mm = 2.0;
        f.grading.decimal_places = 5;
        assert!(f.validate().len() >= 3);
    }

    #[test]
    fn rejects_unknown_json_fields() {
        let mut v = serde_json::to_value(ReportFormat::default()).unwrap();
        v["foo"] = serde_json::json!(1);
        assert!(serde_json::from_value::<ReportFormat>(v).is_err());
    }
}
