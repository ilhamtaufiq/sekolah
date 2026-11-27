#!/usr/bin/env python3
"""Smoke test cetak massal rapor.

Membuat dua job untuk kelas pertama dan semester ganjil (dua job agar antrean ikut diuji),
menunggu sampai selesai, mengunduh ZIP, lalu memastikan peran yang tidak berhak ditolak.

Butuh data demo (scripts/seed_demo.py) dan akun admin. Akun guru dipakai untuk uji penolakan peran.

  python3 scripts/smoke_cetak_massal.py --base http://localhost:8080 --slug demo \\
      --email admin@demo.sch.id --password admin-demo-1
"""

import argparse
import io
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile

PASSED = 0


def check(condition, message):
    global PASSED
    if not condition:
        print(f"GAGAL: {message}")
        sys.exit(1)
    PASSED += 1
    print(f"  ok - {message}")


def request(base, method, path, token=None, body=None):
    """Mengembalikan (status, header, bytes). Respons error tidak melempar exception."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def as_json(raw):
    return json.loads(raw) if raw else None


def login(base, slug, email, password):
    status, _, raw = request(base, "POST", "/api/auth/login", body={"school_slug": slug, "email": email, "password": password})
    if status != 200:
        raise SystemExit(f"login {email} gagal ({status}): {raw.decode(errors='replace')}")
    return as_json(raw)["token"]


def wait_done(base, token, job_id, timeout=300):
    deadline = time.time() + timeout
    while True:
        status, _, raw = request(base, "GET", f"/api/cetak-massal/jobs/{job_id}", token=token)
        job = as_json(raw)
        if status != 200:
            raise SystemExit(f"status job {job_id} gagal dibaca ({status})")
        if job["status"] in ("selesai", "gagal"):
            return job
        if time.time() > deadline:
            raise SystemExit(f"job {job_id} belum selesai setelah {timeout} detik (status {job['status']})")
        time.sleep(1.5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8080")
    ap.add_argument("--slug", default="demo")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--guru-email", default="guru1@demo.sch.id")
    ap.add_argument("--guru-password", default="demo-pass-1")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    print("Login admin")
    admin = login(base, args.slug, args.email, args.password)

    _, _, raw = request(base, "GET", "/api/classes", token=admin)
    classes = as_json(raw)
    _, _, raw = request(base, "GET", "/api/semesters", token=admin)
    semesters = as_json(raw)
    check(bool(classes) and bool(semesters), "data kelas dan semester tersedia")
    class_id = classes[0]["id"]
    semester_id = next(s["id"] for s in semesters if s["ordinal"] == 1)
    body = {"class_id": class_id, "semester_id": semester_id}

    print("Buat dua job (admin)")
    status, _, raw = request(base, "POST", "/api/cetak-massal/jobs", token=admin, body=body)
    check(status == 201, f"POST job menjawab 201 (dapat {status})")
    job_a = as_json(raw)["id"]
    status, _, raw = request(base, "POST", "/api/cetak-massal/jobs", token=admin, body=body)
    check(status == 201, f"POST job kedua menjawab 201 (dapat {status})")
    job_b = as_json(raw)["id"]

    print("Tunggu sampai selesai")
    done_a = wait_done(base, admin, job_a)
    done_b = wait_done(base, admin, job_b)
    check(done_a["status"] == "selesai", f"job pertama selesai (status {done_a['status']}, {done_a.get('error_message')})")
    check(done_b["status"] == "selesai", f"job kedua selesai (status {done_b['status']}, {done_b.get('error_message')})")
    check(done_a["selesai"] == done_a["total"] and done_a["total"] > 0, "progres job pertama penuh")

    print("Daftar job")
    status, _, raw = request(base, "GET", "/api/cetak-massal/jobs", token=admin)
    ids = [j["id"] for j in as_json(raw)]
    check(status == 200 and job_a in ids and job_b in ids, "kedua job muncul di daftar sekolah")

    print("Unduh ZIP")
    status, headers, raw = request(base, "GET", f"/api/cetak-massal/jobs/{job_a}/unduh", token=admin)
    check(status == 200, f"unduh menjawab 200 (dapat {status})")
    check(headers.get("content-type") == "application/zip", "tipe konten application/zip")
    check(raw[:4] == b"PK\x03\x04", "isi berkas berupa ZIP")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        check(all(n.endswith(".pdf") for n in names), "semua isi ZIP berekstensi .pdf")
        check(len(names) == done_a["total"] - len(done_a["errors"] or []), "jumlah raport di ZIP sesuai siswa yang berhasil")
        check(archive.read(names[0])[:5] == b"%PDF-", "berkas pertama di ZIP adalah PDF")

    print("Peran tidak berhak")
    status, _, _ = request(base, "POST", "/api/cetak-massal/jobs", body=body)
    check(status == 401, f"tanpa token ditolak 401 (dapat {status})")
    status, _, _ = request(base, "GET", "/api/cetak-massal/jobs")
    check(status == 401, f"daftar tanpa token ditolak 401 (dapat {status})")

    guru = login(base, args.slug, args.guru_email, args.guru_password)
    status, _, _ = request(base, "POST", "/api/cetak-massal/jobs", token=guru, body=body)
    check(status == 403, f"guru tidak boleh membuat job (dapat {status})")
    status, _, _ = request(base, "GET", f"/api/cetak-massal/jobs/{job_a}/unduh", token=guru)
    check(status == 403, f"guru tidak boleh mengunduh hasil (dapat {status})")

    status, _, _ = request(base, "GET", f"/api/cetak-massal/jobs/{uuid.uuid4()}", token=admin)
    check(status == 404, f"job yang tidak ada menjawab 404 (dapat {status})")

    print(f"\nSEMUA {PASSED} PEMERIKSAAN LULUS")


if __name__ == "__main__":
    main()
