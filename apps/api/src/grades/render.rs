//! Render raport PDF dengan Typst. Tanpa browser dan tanpa font sistem wajib:
//! font embedded dari typst-kit dipakai sebagai dasar, dan FONTS_DIR (opsional) menambah font lain.

use std::{path::Path, sync::OnceLock};

use typst::{
    Library, LibraryExt, World,
    diag::{FileError, FileResult, SourceDiagnostic},
    foundations::{Bytes, Datetime},
    syntax::{FileId, Source, VirtualPath},
    text::{Font, FontBook, FontInfo},
    utils::LazyHash,
};
use typst_kit::fonts::FontStore;
use typst_layout::PagedDocument;

const TEMPLATE: &str = include_str!("../../templates/raport.typ");
const DATA_PATH: &str = "data.json";

struct Engine {
    library: LazyHash<Library>,
    fonts: FontStore,
}

static ENGINE: OnceLock<Engine> = OnceLock::new();

fn engine() -> &'static Engine {
    ENGINE.get_or_init(|| {
        let mut fonts = FontStore::new();
        fonts.extend(typst_kit::fonts::embedded());
        if let Ok(dir) = std::env::var("FONTS_DIR") {
            load_font_dir(&mut fonts, Path::new(&dir));
        }
        Engine {
            library: LazyHash::new(Library::default()),
            fonts,
        }
    })
}

/// Memuat .ttf/.otf dari folder. Gagal membaca satu file tidak menghentikan yang lain.
fn load_font_dir(store: &mut FontStore, dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        tracing::warn!(dir = %dir.display(), "FONTS_DIR tidak bisa dibaca");
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_font = matches!(
            path.extension()
                .and_then(|e| e.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("ttf" | "otf" | "ttc")
        );
        if !is_font {
            continue;
        }
        let Ok(data) = std::fs::read(&path) else {
            continue;
        };
        let bytes = Bytes::new(data.clone());
        for (index, font) in Font::iter(bytes).enumerate() {
            if let Some(info) = FontInfo::new(&data, index as u32) {
                store.push((font, info));
            }
        }
    }
}

fn main_id() -> FileId {
    FileId::new(typst::syntax::RootedPath::new(
        typst::syntax::VirtualRoot::Project,
        VirtualPath::new("main.typ").expect("path valid"),
    ))
}

fn data_id() -> FileId {
    FileId::new(typst::syntax::RootedPath::new(
        typst::syntax::VirtualRoot::Project,
        VirtualPath::new(DATA_PATH).expect("path valid"),
    ))
}

struct RaportWorld {
    main: Source,
    data: Bytes,
}

impl World for RaportWorld {
    fn library(&self) -> &LazyHash<Library> {
        &engine().library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        engine().fonts.book()
    }

    fn main(&self) -> FileId {
        self.main.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            Ok(self.main.clone())
        } else {
            Err(FileError::NotFound(id.vpath().get_without_slash().into()))
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if id == data_id() {
            Ok(self.data.clone())
        } else {
            Err(FileError::NotFound(id.vpath().get_without_slash().into()))
        }
    }

    fn font(&self, index: usize) -> Option<Font> {
        engine().fonts.font(index)
    }

    fn today(&self, _offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
        let now = chrono::Local::now().date_naive();
        use chrono::Datelike;
        Datetime::from_ymd(now.year(), now.month() as u8, now.day() as u8)
    }
}

fn describe<'a>(diags: impl IntoIterator<Item = &'a SourceDiagnostic>) -> String {
    diags
        .into_iter()
        .map(|d| d.message.to_string())
        .collect::<Vec<_>>()
        .join("; ")
}

/// Render satu raport dari data JSON menjadi bytes PDF.
pub fn render_pdf(data: &serde_json::Value) -> Result<Vec<u8>, String> {
    let world = RaportWorld {
        main: Source::new(main_id(), TEMPLATE.to_string()),
        data: Bytes::new(serde_json::to_vec(data).map_err(|e| e.to_string())?),
    };
    let warned = typst::compile::<PagedDocument>(&world);
    let document = warned.output.map_err(|errs| describe(errs.iter()))?;
    typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default())
        .map_err(|errs| describe(errs.iter()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> serde_json::Value {
        serde_json::json!({
            "page": {"width_mm": 210.0, "height_mm": 297.0, "margin_mm": 20.0, "font_family": "Times New Roman", "font_size_pt": 11.0},
            "kop": {"title": "SD Negeri 1 Contoh", "subtitle": null, "address": "Jl. Contoh No. 1"},
            "student": {"name": "Andi \"Si\" <Tester> #1", "nis": "1001", "class_name": "7A", "semester_name": "Ganjil", "academic_year": "2026/2027"},
            "sections": ["nilai_akademik", "sikap", "absensi", "ranking", "catatan_wali_kelas"],
            "grades": [{"subject": "Matematika", "score": "82", "predicate": "B", "kkm": "Tuntas"}, {"subject": "IPA", "score": "-", "predicate": "-", "kkm": "-"}],
            "notes": {"attitude": "Sopan & rajin", "extracurricular": null, "homeroom": "Terus semangat"},
            "absences": {"sakit": 1, "izin": 0, "alpa": 2},
            "rank": {"position": 3, "total": 30, "average": "80"},
            "predicates": [{"label": "A", "min": 90.0, "description": "Sangat baik"}],
            "signatures": {"city": "Bandung", "date": "25 November 2026", "wali_title": "Wali Kelas", "wali_name": "Wali Satu", "kepala_name": "Dr. Kepala", "kepala_nip": null}
        })
    }

    #[test]
    fn renders_valid_pdf_with_escaped_user_text() {
        let pdf = render_pdf(&sample()).expect("render harus berhasil");
        assert!(pdf.starts_with(b"%PDF"), "bukan PDF");
        assert!(pdf.len() > 2_000, "PDF terlalu kecil: {} byte", pdf.len());
    }

    #[test]
    fn unknown_section_is_ignored_and_empty_grades_render() {
        let mut data = sample();
        data["sections"] = serde_json::json!(["nilai_akademik", "prestasi"]);
        data["grades"] = serde_json::json!([]);
        assert!(render_pdf(&data).is_ok());
    }
}
