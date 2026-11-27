#!/usr/bin/env python3
"""Smoke test jenjang dan jenis lembaga terhadap API yang sedang berjalan.

Memeriksa:
- profil sekolah: istilah per jenis lembaga, PUT hanya untuk admin, nilai tidak valid ditolak;
- kelas: kolom program (null, paket_a, paket_b, paket_c) diterima, di-update, dan dibaca.

Prasyarat: sekolah dengan admin. Default: slug sdn-1, admin@sdn1.sch.id / rahasia-123.
Skrip membuat guru uji dan kelas uji sendiri, lalu mengembalikan jenis lembaga ke
nilai awal. Kelas uji tidak dihapus karena API belum punya rute hapus kelas;
jalankan pada database uji saja.

  python3 scripts/smoke_jenjang.py http://localhost:8080 [slug] [email] [password]
"""

import json
import sys
import urllib.error
import urllib.request
import uuid

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8080"
SLUG = sys.argv[2] if len(sys.argv) > 2 else "sdn-1"
ADMIN_EMAIL = sys.argv[3] if len(sys.argv) > 3 else "admin@sdn1.sch.id"
ADMIN_PASSWORD = sys.argv[4] if len(sys.argv) > 4 else "rahasia-123"
PASSED = 0

# Sumber istilah yang diharapkan (harus sama dengan src/school_profile.rs).
EXPECTED_TERMS = {
    "sd": ("Siswa", "Kelas"),
    "smp": ("Siswa", "Kelas"),
    "sma": ("Siswa", "Kelas"),
    "pkbm": ("Warga belajar", "Rombel"),
    "paud": ("Peserta didik", "Kelas"),
    "tk": ("Peserta didik", "Kelas"),
}


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw.decode(errors="replace")


def check(label, cond, detail=""):
    global PASSED
    if not cond:
        print(f"GAGAL: {label} {detail}")
        sys.exit(1)
    PASSED += 1
    print(f"ok    {label}")


def expect(label, got, want):
    status, payload = got
    check(f"{label} (HTTP {status})", status == want, f"— harapan {want}, body: {payload}")
    return payload


def login(email, password):
    status, payload = call("POST", "/api/auth/login", body={"school_slug": SLUG, "email": email, "password": password})
    assert status == 200, payload
    return payload["token"]


def field_issues(payload, field):
    return [d for d in (payload or {}).get("details", []) if d.get("field") == field]


admin = login(ADMIN_EMAIL, ADMIN_PASSWORD)
suffix = uuid.uuid4().hex[:6]

# --- Profil sekolah ---
profile = expect("profil sekolah dibaca admin", call("GET", "/api/school-profile", admin), 200)
original_jenis = profile["jenis_lembaga"]
check("jenis lembaga awal termasuk daftar yang diizinkan", original_jenis in EXPECTED_TERMS, f"— {original_jenis}")

for jenis, (student, klass) in EXPECTED_TERMS.items():
    body = expect(f"ubah jenis ke {jenis}", call("PUT", "/api/school-profile", admin, {"jenis_lembaga": jenis}), 200)
    check(f"{jenis}: jenis tersimpan", body["jenis_lembaga"] == jenis, f"— {body}")
    check(f"{jenis}: istilah peserta '{student}'", body["terms"]["student"] == student, f"— {body['terms']}")
    check(f"{jenis}: istilah kelas '{klass}'", body["terms"]["class"] == klass, f"— {body['terms']}")

bad = expect("jenis tidak dikenal ditolak", call("PUT", "/api/school-profile", admin, {"jenis_lembaga": "universitas"}), 422)
check("penolakan menunjuk field jenis_lembaga", bool(field_issues(bad, "jenis_lembaga")), f"— {bad}")

# Guru tidak boleh mengubah jenis lembaga, tetapi boleh membaca istilahnya.
guru_email = f"guru.jenjang.{suffix}@sdn1.sch.id"
expect(
    "buat guru uji",
    call("POST", "/api/users", admin, {"name": f"Guru Uji {suffix}", "email": guru_email, "password": "rahasia-123", "role": "guru"}),
    200,
)
guru = login(guru_email, "rahasia-123")
guru_profile = expect("guru membaca profil sekolah", call("GET", "/api/school-profile", guru), 200)
check("guru melihat istilah", guru_profile["terms"]["class"] == EXPECTED_TERMS[guru_profile["jenis_lembaga"]][1])
expect("guru tidak boleh mengubah jenis", call("PUT", "/api/school-profile", guru, {"jenis_lembaga": "tk"}), 403)

# --- Kelas dan program ---
years = expect("daftar tahun ajaran", call("GET", "/api/academic-years", admin), 200)
if not any(y["is_active"] for y in years):
    created = expect(
        "buat tahun ajaran uji",
        call("POST", "/api/academic-years", admin, {"name": f"JN-{suffix}", "starts_on": "2030-07-01", "ends_on": "2031-06-30"}),
        200,
    )
    expect("aktifkan tahun ajaran uji", call("POST", f"/api/academic-years/{created['id']}/activate", admin), 200)

class_name = f"JN{suffix}".upper()
klass = expect(
    "buat kelas dengan program paket_a",
    call("POST", "/api/classes", admin, {"name": class_name, "grade_level": 7, "program": "paket_a"}),
    200,
)
check("program paket_a tersimpan", klass["program"] == "paket_a", f"— {klass}")

none_name = f"{class_name}N"
klass_none = expect(
    "buat kelas tanpa program (null)",
    call("POST", "/api/classes", admin, {"name": none_name, "grade_level": 7, "program": None}),
    200,
)
check("program null tersimpan sebagai null", klass_none["program"] is None, f"— {klass_none}")

empty_name = f"{class_name}E"
klass_empty = expect(
    "program kosong diperlakukan sebagai tanpa program",
    call("POST", "/api/classes", admin, {"name": empty_name, "grade_level": 7, "program": ""}),
    200,
)
check("program kosong menjadi null", klass_empty["program"] is None, f"— {klass_empty}")

bad_class = expect(
    "program tidak dikenal ditolak",
    call("POST", "/api/classes", admin, {"name": f"{class_name}X", "grade_level": 7, "program": "paket_z"}),
    422,
)
check("penolakan menunjuk field program", bool(field_issues(bad_class, "program")), f"— {bad_class}")

updated = expect(
    "ubah program menjadi paket_c",
    call("PUT", f"/api/classes/{klass['id']}", admin, {"name": class_name, "grade_level": 7, "program": "paket_c"}),
    200,
)
check("program paket_c tersimpan", updated["program"] == "paket_c", f"— {updated}")

listed = expect("daftar kelas memuat program", call("GET", "/api/classes", admin), 200)
row = next((c for c in listed if c["id"] == klass["id"]), None)
check("kelas uji ada di daftar", row is not None)
check("daftar menampilkan program paket_c", row["program"] == "paket_c", f"— {row}")

expect("guru tidak boleh membuat kelas", call("POST", "/api/classes", guru, {"name": f"{class_name}G", "grade_level": 7}), 403)

# Kembalikan jenis lembaga ke nilai awal.
expect("kembalikan jenis lembaga awal", call("PUT", "/api/school-profile", admin, {"jenis_lembaga": original_jenis}), 200)

print(f"\nSEMUA LULUS: {PASSED} pemeriksaan")
