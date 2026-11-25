# SIMAS — Sistem Informasi Manajemen Sekolah

Multi-tenant (database: MySQL 8.4): satu deployment melayani banyak sekolah. Setiap sekolah diidentifikasi dengan `slug` dan semua datanya terpisah lewat `school_id` yang diambil dari token, bukan dari input klien.

## Struktur

```
apps/api/       Backend Rust (Axum, SQLx, MySQL 8.4)
apps/web/       Frontend React + Vite + Tailwind
Dockerfile.api  Image API (multi-stage, cargo-chef)
Dockerfile.web  Image web (build Vite, disajikan nginx, meneruskan /api)
deploy/         Compose lokal, konfigurasi nginx, panduan Coolify
```

## Modul yang sudah ada

- Login dan sesi berbasis JWT, dengan RBAC (admin, kepala sekolah, guru, wali kelas, siswa, orang tua)
- Pengaturan format raport: kop, halaman, penilaian, predikat, urutan bagian, tanda tangan
  - Versi terus bertambah, dengan deteksi konflik (409) saat dua admin mengedit bersamaan
  - Riwayat perubahan dan pemulihan (restore) yang membuat versi baru
- Akademik inti (F2)
  - Tahun ajaran (satu aktif per sekolah), mata pelajaran, kelas dengan wali kelas
  - Siswa dan rombel (satu siswa satu kelas per tahun ajaran)
  - Akun guru dan staf, penugasan guru per mapel, jadwal dengan cek bentrok
  - Absensi harian (wali kelas) dan per mapel (guru pengampu), dashboard ringkasan

Smoke test F2 (butuh API berjalan dan sekolah `sdn-1` dengan admin dari langkah di atas):

```bash
python3 apps/api/scripts/smoke_f2.py http://localhost:8080
```

## Menjalankan lokal

Stack lengkap dengan Docker:

```bash
docker compose -f deploy/docker-compose.yml up --build
# web: http://localhost:8081
```

Pengembangan terpisah:

```bash
# Backend (perlu MySQL di localhost:3306, lihat .env.example)
cd apps/api && cargo run -- serve

# Frontend (dev server meneruskan /api ke localhost:8080)
cd apps/web && pnpm install && pnpm dev
```

Membuat sekolah dan admin pertama:

```bash
cd apps/api
cargo run -- create-school --slug sdn-1 --name "SD Negeri 1 Contoh"
cargo run -- create-user --school sdn-1 --email admin@sdn1.sch.id --name "Admin" --password "password-minimal-8"
```

## Tes

```bash
cd apps/api && cargo test          # unit test validasi format raport
cd apps/web && pnpm typecheck && pnpm build
```

Deploy produksi: lihat [`deploy/coolify.md`](deploy/coolify.md).
