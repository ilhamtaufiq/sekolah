//! Render sertifikat kelulusan dengan Typst. Mesin yang sama dengan render raport,
//! dengan template sendiri (templates/sertifikat.typ).

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

const TEMPLATE: &str = include_str!("../../templates/sertifikat.typ");
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

struct CertificateWorld {
    main: Source,
    data: Bytes,
}

impl World for CertificateWorld {
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

/// Render satu sertifikat dari data JSON menjadi bytes PDF.
pub fn render_pdf(data: &serde_json::Value) -> Result<Vec<u8>, String> {
    let world = CertificateWorld {
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
            "kop": {"title": "SD Negeri 1 Contoh", "address": "Jl. Contoh No. 1"},
            "nomor": "001/CONTOH/2026",
            "student": {"name": "Andi \"Si\" <Tester> #1", "nis": "1001", "class_name": "6A", "academic_year": "2026/2027"},
            "school_name": "SD Negeri 1 Contoh",
            "date_text": "25 November 2026",
            "city": "Bandung",
            "kepala_name": "Dr. Kepala"
        })
    }

    #[test]
    fn renders_valid_pdf_with_escaped_user_text() {
        let pdf = render_pdf(&sample()).expect("render harus berhasil");
        assert!(pdf.starts_with(b"%PDF"), "bukan PDF");
        assert!(pdf.len() > 2_000, "PDF terlalu kecil: {} byte", pdf.len());
    }
}
