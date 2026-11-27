#!/usr/bin/env python3
"""Smoke test kelulusan (F6) terhadap API yang sedang berjalan.

Mencakup: kenaikan kelas, siswa lulus tidak masuk kelas aktif, nomor sertifikat
unik dan stabil, serta siswa hanya bisa mengunduh sertifikatnya sendiri.

Prasyarat: sekolah dengan admin sudah ada (lihat README). Skrip membuat data uji
sendiri dengan tag acak; jalankan pada database uji saja.

  python3 scripts/smoke_kelulusan.py http://localhost:8080

Variabel lingkungan (opsional): SCHOOL_SLUG, ADMIN_EMAIL, ADMIN_PASSWORD.
"""

import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8080"
SCHOOL = os.environ.get("SCHOOL_SLUG", "sdn-1")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@sdn1.sch.id")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "password-minimal-8")
PASSED = 0
TAG = secrets.token_hex(3)
NOMOR_RE = re.compile(r"^\d{3}/[A-Z0-9-]{1,20}/\d{4}$")


def raw(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, data=body, method=method)
    if body is not None:
        req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def call(method, path, token=None, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    status, data = raw(method, path, token, body)
    try:
        return status, json.loads(data) if data else None
    except json.JSONDecodeError:
        return status, data.decode(errors="replace")


def check(label, cond, detail=""):
    global PASSED
    if not cond:
        print(f"GAGAL: {label} {detail}")
        sys.exit(1)
    PASSED += 1
    print(f"ok    {label}")


def expect(label, got, want):
    status, payload = got
    check(f"{label} (HTTP {status})", status == want, f"- harapan {want}, body: {str(payload)[:300]}")
    return payload


def expect_issue(label, got, field=None):
    """Harus 422 (validasi). Bila field diberikan, field itu harus ikut disebut."""
    status, payload = got
    fields = [d["field"] for d in (payload or {}).get("details", [])] if isinstance(payload, dict) else []
    ok = status == 422 and (field is None or field in fields)
    check(f"{label} (HTTP {status}, field {fields})", ok, f"- body: {str(payload)[:300]}")


def login(email, password):
    status, payload = call(
        "POST", "/api/auth/login", payload={"school_slug": SCHOOL, "email": email, "password": password}
    )
    assert status == 200, payload
    return payload["token"]


def create_student(label, letter, status="aktif"):
    nis = f"{TAG}{letter}"
    payload = expect(
        f"buat siswa {label}",
        call("POST", "/api/students", ADMIN_TOKEN, {
            "nis": nis, "nisn": None, "name": f"Siswa {label} {TAG}", "gender": "L",
            "birth_date": None, "status": status,
        }),
        200,
    )
    return payload["id"]


def roster_decisions(year_id):
    rows = expect("baca roster kenaikan", call("GET", f"/api/promotions?academic_year_id={year_id}", ADMIN_TOKEN), 200)
    return {r["student_id"]: r for r in rows}


def class_student_ids(class_id):
    rows = expect("baca siswa kelas", call("GET", f"/api/classes/{class_id}/students", ADMIN_TOKEN), 200)
    return {r["id"] for r in rows}


ADMIN_TOKEN = login(ADMIN_EMAIL, ADMIN_PASSWORD)
me = expect("profil admin", call("GET", "/api/me", ADMIN_TOKEN), 200)
check("admin login berperan admin", me["role"] == "admin", str(me))

# ---------- Data uji: dua tahun ajaran, tiga kelas, empat siswa ----------
year_from = expect(
    "buat tahun ajaran asal",
    call("POST", "/api/academic-years", ADMIN_TOKEN, {"name": f"KL{TAG}A", "starts_on": "2030-07-01", "ends_on": "2031-06-30"}),
    200,
)["id"]
year_to = expect(
    "buat tahun ajaran tujuan",
    call("POST", "/api/academic-years", ADMIN_TOKEN, {"name": f"KL{TAG}B", "starts_on": "2031-07-01", "ends_on": "2032-06-30"}),
    200,
)["id"]


def make_class(name, grade, year):
    return expect(
        f"buat kelas {name}",
        call("POST", "/api/classes", ADMIN_TOKEN, {
            "name": name, "grade_level": grade, "homeroom_teacher_id": None, "academic_year_id": year,
        }),
        200,
    )["id"]


class_from = make_class(f"7-{TAG}", 7, year_from)
class_to = make_class(f"8-{TAG}", 8, year_to)
class_stay = make_class(f"7B-{TAG}", 7, year_to)

s_naik = create_student("naik", "a")
s_tinggal = create_student("tinggal", "b")
s_lulus1 = create_student("lulus-1", "c")
s_lulus2 = create_student("lulus-2", "d")
s_belum = create_student("belum-rombel", "e")
s_nonaktif = create_student("nonaktif", "f", status="pindah")

expect(
    "masukkan siswa ke kelas asal",
    call("POST", f"/api/classes/{class_from}/students", ADMIN_TOKEN,
         {"student_ids": [s_naik, s_tinggal, s_lulus1, s_lulus2, s_nonaktif]}),
    422,  # siswa nonaktif harus menolak seluruh permintaan
)
expect(
    "masukkan siswa aktif ke kelas asal",
    call("POST", f"/api/classes/{class_from}/students", ADMIN_TOKEN,
         {"student_ids": [s_naik, s_tinggal, s_lulus1, s_lulus2]}),
    200,
)

# ---------- Validasi bentuk input ----------
expect_issue(
    "lulus tidak boleh punya kelas tujuan",
    call("POST", "/api/promotions/process", ADMIN_TOKEN, {
        "academic_year_id": year_from,
        "items": [{"student_id": s_lulus1, "decision": "lulus", "to_class_id": class_to}],
    }),
    field="to_class_id",
)
expect_issue(
    "naik wajib punya kelas tujuan",
    call("POST", "/api/promotions/process", ADMIN_TOKEN, {
        "academic_year_id": year_from,
        "items": [{"student_id": s_naik, "decision": "naik", "to_class_id": None}],
    }),
    field="to_class_id",
)
expect_issue(
    "siswa tanpa rombel di tahun asal ditolak, seluruh batch gagal",
    call("POST", "/api/promotions/process", ADMIN_TOKEN, {
        "academic_year_id": year_from,
        "items": [
            {"student_id": s_naik, "decision": "naik", "to_class_id": class_to},
            {"student_id": s_belum, "decision": "lulus", "to_class_id": None},
        ],
    }),
    field="items",
)
check(
    "batch gagal tidak menyisakan perubahan",
    s_naik not in roster_decisions(year_from) or roster_decisions(year_from)[s_naik]["decision"] is None,
    "siswa naik seharusnya belum tercatat",
)

# ---------- Proses kenaikan yang valid ----------
code = f"T{TAG}".upper()
result = expect(
    "proses kenaikan: naik, tinggal, dua lulus",
    call("POST", "/api/promotions/process", ADMIN_TOKEN, {
        "academic_year_id": year_from,
        "certificate_code": code,
        "items": [
            {"student_id": s_naik, "decision": "naik", "to_class_id": class_to},
            {"student_id": s_tinggal, "decision": "tinggal", "to_class_id": class_stay},
            {"student_id": s_lulus1, "decision": "lulus", "to_class_id": None},
            {"student_id": s_lulus2, "decision": "lulus", "to_class_id": None},
        ],
    }),
    200,
)
check("jumlah siswa diproses = 4", result["processed"] == 4, str(result))
check("dua sertifikat diterbitkan", len(result["certificates"]) == 2, str(result))
nomor_by_student = {c["student_id"]: c["nomor"] for c in result["certificates"]}

decisions = roster_decisions(year_from)
check("keputusan naik tercatat", decisions[s_naik]["decision"] == "naik", str(decisions[s_naik]))
check("keputusan tinggal tercatat", decisions[s_tinggal]["decision"] == "tinggal", str(decisions[s_tinggal]))
check("keputusan lulus tercatat", decisions[s_lulus1]["decision"] == "lulus", str(decisions[s_lulus1]))

check("siswa naik masuk kelas tujuan", s_naik in class_student_ids(class_to))
check("siswa tinggal masuk kelas tujuan (kelas sama tingkat)", s_tinggal in class_student_ids(class_stay))

# ---------- Siswa lulus tidak masuk kelas aktif lagi ----------
student_list = expect("cari siswa lulus", call("GET", f"/api/students?q={TAG}", ADMIN_TOKEN), 200)
status_of = {s["id"]: s["status"] for s in student_list}
check("status siswa lulus menjadi 'lulus'", status_of.get(s_lulus1) == "lulus", str(status_of.get(s_lulus1)))
expect_issue(
    "siswa lulus ditolak masuk kelas aktif",
    call("POST", f"/api/classes/{class_to}/students", ADMIN_TOKEN, {"student_ids": [s_lulus1]}),
)
expect_issue(
    "siswa lulus ditolak masuk kelas tingkat yang sama",
    call("POST", f"/api/classes/{class_stay}/students", ADMIN_TOKEN, {"student_ids": [s_lulus2]}),
)
check(
    "siswa lulus tidak muncul di kelas tujuan",
    s_lulus1 not in class_student_ids(class_to) and s_lulus2 not in class_student_ids(class_stay),
)

# ---------- Proses tidak bisa diulang ----------
expect_issue(
    "kenaikan siswa yang sudah diproses ditolak",
    call("POST", "/api/promotions/process", ADMIN_TOKEN, {
        "academic_year_id": year_from,
        "items": [{"student_id": s_naik, "decision": "naik", "to_class_id": class_to}],
    }),
    field="items",
)
expect_issue(
    "siswa lulus tidak bisa diproses ulang",
    call("POST", "/api/promotions/process", ADMIN_TOKEN, {
        "academic_year_id": year_from,
        "items": [{"student_id": s_lulus1, "decision": "lulus", "to_class_id": None}],
    }),
    field="items",
)

# ---------- Nomor sertifikat: unik, stabil, dan tidak dibuat dua kali ----------
pattern_ok = all(NOMOR_RE.match(n) for n in nomor_by_student.values())
check("format nomor {urut}/{kode}/{tahun}", pattern_ok, str(nomor_by_student))
check("nomor untuk kode yang diminta", all(f"/{code}/" in n for n in nomor_by_student.values()), str(nomor_by_student))
check("nomor antar siswa berbeda", len(set(nomor_by_student.values())) == 2, str(nomor_by_student))

certs = expect("daftar sertifikat (admin)", call("GET", "/api/certificates", ADMIN_TOKEN), 200)
mine_rows = [c for c in certs if c["student_id"] in (s_lulus1, s_lulus2)]
check("tepat satu sertifikat per siswa lulus", len(mine_rows) == 2, str(mine_rows))
check("nomor di daftar sama dengan nomor saat diterbitkan",
      all(nomor_by_student[c["student_id"]] == c["nomor"] for c in mine_rows), str(mine_rows))
check("nomor di sekolah unik", len({c["nomor"] for c in certs}) == len(certs), "nomor bentrok")

# Proses kedua pada data yang sama tidak boleh menambah atau mengubah nomor.
certs_again = expect("daftar sertifikat kedua", call("GET", "/api/certificates", ADMIN_TOKEN), 200)
check("nomor stabil setelah dibaca ulang",
      {c["id"]: c["nomor"] for c in certs} == {c["id"]: c["nomor"] for c in certs_again})

# ---------- Akses unduh: siswa hanya bisa mengunduh miliknya ----------
cert_lulus1 = next(c for c in mine_rows if c["student_id"] == s_lulus1)
cert_lulus2 = next(c for c in mine_rows if c["student_id"] == s_lulus2)

status, _ = raw("GET", f"/api/certificates/{cert_lulus1['id']}/pdf")
check(f"unduh tanpa login ditolak (HTTP {status})", status == 401)

for letter, sid in (("1", s_lulus1), ("2", s_lulus2)):
    email = f"siswa-{TAG}-{letter}@example.test"
    expect(
        f"buat akun siswa {letter}",
        call("POST", f"/api/students/{sid}/account", ADMIN_TOKEN, {"email": email, "password": "password-siswa-1"}),
        200,
    )
token_1 = login(f"siswa-{TAG}-1@example.test", "password-siswa-1")
token_2 = login(f"siswa-{TAG}-2@example.test", "password-siswa-1")

own = expect("siswa 1 melihat sertifikatnya sendiri", call("GET", "/api/me/certificates", token_1), 200)
check("daftar milik siswa 1 hanya satu dan benar",
      [c["nomor"] for c in own] == [cert_lulus1["nomor"]], str(own))

status, pdf = raw("GET", f"/api/certificates/{cert_lulus1['id']}/pdf", token_1)
check(f"siswa 1 mengunduh sertifikat sendiri (HTTP {status})", status == 200 and pdf.startswith(b"%PDF"))

status, body = raw("GET", f"/api/certificates/{cert_lulus2['id']}/pdf", token_1)
check(f"siswa 1 ditolak mengunduh milik siswa 2 (HTTP {status})", status == 403, str(body[:200]))

status, body = raw("GET", f"/api/certificates/{cert_lulus1['id']}/pdf", token_2)
check(f"siswa 2 ditolak mengunduh milik siswa 1 (HTTP {status})", status == 403, str(body[:200]))

status, body = raw("GET", "/api/certificates/00000000-0000-0000-0000-000000000000/pdf", token_1)
check(f"sertifikat tidak ada menghasilkan 404 (HTTP {status})", status == 404)

status, pdf = raw("GET", f"/api/certificates/{cert_lulus2['id']}/pdf", ADMIN_TOKEN)
check(f"admin boleh mengunduh sertifikat siswa (HTTP {status})", status == 200 and pdf.startswith(b"%PDF"))

print(f"\nSemua {PASSED} pemeriksaan lulus.")
