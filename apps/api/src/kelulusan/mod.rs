//! Kelulusan (F6): kenaikan kelas, kelulusan, dan sertifikat bernomor.
//!
//! - Admin memproses kenaikan per tahun ajaran: naik, tinggal, atau lulus.
//!   Satu proses berjalan dalam satu transaksi dengan baris terkait dikunci.
//! - Keputusan lulus menerbitkan sertifikat dengan nomor unik per sekolah.
//!   Nomor siswa yang sama tidak pernah dibuat dua kali.
//! - Sertifikat diunduh sebagai PDF (Typst). Siswa hanya bisa mengunduh miliknya sendiri.

pub mod kenaikan;
pub mod render;
pub mod sertifikat;

use crate::auth::Role;

/// Memproses kenaikan dan menerbitkan sertifikat.
pub const ADMIN: &[Role] = &[Role::Admin];
/// Melihat seluruh sertifikat sekolah.
pub const LEADERSHIP: &[Role] = &[Role::Admin, Role::KepalaSekolah];
