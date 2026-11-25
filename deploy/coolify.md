# Deploy ke Coolify

Arsitektur produksi: hanya **web** (nginx) yang punya domain publik. Nginx meneruskan `/api/*` ke **api** lewat jaringan internal Docker. Dengan begitu tidak ada CORS dan API tidak terbuka langsung ke internet.

## 1. Database

1. Di project Coolify, **+ New → Database → PostgreSQL 16**.
2. Catat nama host internal (mis. `simas-db-xyz`), user, password, dan nama database.
3. Aktifkan **Backups**: jadwal harian, tujuan S3-compatible, retensi minimal 14 hari.

## 2. API (Rust)

1. **+ New → Application → Public/Private Repository**, pilih repo ini, branch `main`.
2. Build Pack: **Dockerfile**. Dockerfile location: `/Dockerfile.api`. Base directory: `/`.
3. Port: `8080`. **Tidak perlu domain publik.**
4. Health check path: `/readyz`.
5. Environment variables:

   | Nama | Nilai |
   |---|---|
   | `DATABASE_URL` | `postgres://<user>:<password>@<host-internal-db>:5432/<db>` |
   | `JWT_SECRET` | hasil `openssl rand -hex 32` (simpan sebagai secret) |
   | `JWT_TTL_HOURS` | `8` |
   | `RUN_MIGRATIONS` | `true` |
   | `RUST_LOG` | `simas_api=info,tower_http=info` |

6. Catat **hostname internal** aplikasi API (tab Network / Connect). Dipakai di langkah 3.

## 3. Web (React + nginx)

1. **+ New → Application**, repo yang sama.
2. Build Pack: **Dockerfile**. Dockerfile location: `/Dockerfile.web`. Base directory: `/`.
3. Port: `80`.
4. Domain: `https://app.sekolah.sch.id` (ganti dengan domain sekolah).
5. Environment variables: `API_UPSTREAM` = `<hostname-internal-api>:8080`.
6. Aktifkan **Auto Deploy** lewat webhook GitHub pada branch `main`.

## 4. Membuat sekolah dan admin pertama

Buka **Terminal** di container API (tab Terminal Coolify), lalu jalankan:

```bash
simas-api create-school --slug sdn-1 --name "SD Negeri 1 Contoh"
simas-api create-user --school sdn-1 --email admin@sdn1.sch.id --name "Admin Sekolah" --password "ganti-password-ini"
```

Untuk peran lain, tambahkan `--role guru`, `wali_kelas`, `kepala_sekolah`, `siswa`, atau `orang_tua`.

## 5. Verifikasi setelah deploy

```bash
curl -fsS https://app.sekolah.sch.id/api/readyz   # harus "ready"
```

Lalu login di `https://app.sekolah.sch.id/login` dengan kode sekolah `sdn-1`.

## Catatan operasional

- Migrasi berjalan otomatis saat container start dan diamankan advisory lock.
- Deploy ulang memakai SIGTERM. API menyelesaikan request yang sedang berjalan sebelum berhenti.
- Restore backup: uji sekali sebulan di database terpisah sebelum mengandalkannya.
