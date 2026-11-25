# Deploy ke Coolify (satu stack Docker Compose)

Seluruh aplikasi berjalan sebagai satu resource **Docker Compose** di Coolify: MySQL 8.4, API Rust, dan web (nginx). Hanya web yang punya domain publik. API dan MySQL hanya bisa diakses dari dalam stack.

File yang dipakai: `docker-compose.yml` di root repo.

## 1. Buat resource

1. Di project Coolify, **+ New → Docker Compose** (atau *Public/Private Repository* lalu pilih Docker Compose sebagai build pack).
2. Repository: repo ini, branch `main`.
3. Docker Compose location: `/docker-compose.yml`. Base directory: `/`.

## 2. Environment variables

Isi di tab **Environment Variables** resource tersebut:

| Nama | Isi |
|---|---|
| `MYSQL_ROOT_PASSWORD` | password root MySQL (generate acak, simpan sebagai secret) |
| `MYSQL_PASSWORD` | password user `simas` (generate acak, simpan sebagai secret) |
| `JWT_SECRET` | string acak minimal 32 karakter (simpan sebagai secret) |

Generate nilai acak dengan:

```bash
openssl rand -hex 32
```

Jangan pakai nilai contoh. Jika salah satu variabel kosong, Compose akan menolak start dan menampilkan pesan yang menyebut variabel itu.

## 3. Domain

1. Buka service **web** di resource tersebut, lalu isi **Domains**: `https://app.sekolah.sch.id` (ganti dengan domain sekolah).
2. Biarkan service **db** dan **api** tanpa domain.

## 4. Deploy

Klik **Deploy**. Urutan start otomatis: `db` sehat dulu, lalu `api` (migrasi dijalankan saat start), lalu `web`.

Aktifkan **Auto Deploy** lewat webhook GitHub pada branch `main` agar setiap push langsung dideploy.

## 5. Membuat sekolah dan admin pertama

Buka **Terminal** pada container service `api`, lalu jalankan:

```bash
simas-api create-school --slug sdn-1 --name "SD Negeri 1 Contoh"
simas-api create-user --school sdn-1 --email admin@sdn1.sch.id --name "Admin Sekolah" --password "ganti-password-ini"
```

Untuk peran lain, tambahkan `--role guru`, `wali_kelas`, `kepala_sekolah`, `siswa`, atau `orang_tua`.

## 6. Verifikasi

```bash
curl -fsS https://app.sekolah.sch.id/api/readyz   # harus "ready"
```

Lalu login di `https://app.sekolah.sch.id/login` dengan kode sekolah `sdn-1`.

## Backup

Data MySQL disimpan di volume bernama `dbdata`. Atur backup terjadwal dengan salah satu cara:

- **Scheduled task** di Coolify yang menjalankan `mysqldump` di container `db` dan menyimpan hasilnya ke S3-compatible storage. Contoh perintah:

  ```bash
  mysqldump -usimas -p"$MYSQL_PASSWORD" --single-transaction simas | gzip > /tmp/simas-$(date +%F).sql.gz
  ```

- Uji restore sekali sebulan di database terpisah sebelum mengandalkan backup.

## Catatan operasional

- Migrasi berjalan otomatis saat container `api` start, diamankan dengan lock dari sqlx.
- Deploy ulang memakai SIGTERM. API menyelesaikan request yang sedang berjalan sebelum berhenti.
- Jika ingin MySQL dijalankan terpisah dari stack (misalnya dipakai aplikasi lain), itu di luar panduan ini.
