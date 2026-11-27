#!/usr/bin/env python3
"""Smoke test jurnal mengajar terhadap API yang sedang berjalan.

Menguji: buat, kirim, tolak, kirim ulang, setujui, dan larangan ubah setelah disetujui.
Membuat datanya sendiri. Butuh admin sdn-1 (admin@sdn1.sch.id / rahasia-123).
Jalankan pada database uji saja.

  python3 scripts/smoke_jurnal.py http://localhost:8080
"""

import json
import sys
import urllib.error
import urllib.request
from datetime import date, datetime

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8080"
PASSED = 0
GURU_PASS = "guru-jurnal-1"
KEPSEK_PASS = "kepsek-jurnal-1"


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
    status, payload = call(
        "POST", "/api/auth/login",
        body={"school_slug": "sdn-1", "email": email, "password": password},
    )
    assert status == 200, payload
    return payload["token"]


today = date.today()
start = date(today.year if today.month >= 7 else today.year - 1, 7, 1)
end = date(start.year + 1, 6, 30)
year_name = f"{start.year}/{start.year + 1}"
tag = datetime.now().strftime("%H%M%S")  # agar data uji tidak bentrok saat dijalankan ulang

admin = login("admin@sdn1.sch.id", "rahasia-123")

# 1. Data dasar: tahun ajaran aktif, mapel, kelas, siswa, guru, kepala sekolah, penugasan.
years = expect("daftar tahun ajaran", call("GET", "/api/academic-years", admin), 200)
year = next((y for y in years if y["name"] == year_name), None)
if year is None:
    year = expect(
        "buat tahun ajaran",
        call("POST", "/api/academic-years", admin, {"name": year_name, "starts_on": str(start), "ends_on": str(end)}),
        200,
    )
expect("aktifkan tahun ajaran", call("POST", f"/api/academic-years/{year['id']}/activate", admin), 200)

mapel = expect(
    "buat mapel",
    call("POST", "/api/subjects", admin, {"code": f"jrn{tag}", "name": "Mapel Jurnal Uji"}),
    200,
)
kelas = expect(
    "buat kelas",
    call("POST", "/api/classes", admin, {"name": f"JRN-{tag}", "grade_level": 7, "homeroom_teacher_id": None}),
    200,
)
siswa = []
for i in range(2):
    siswa.append(expect(
        f"buat siswa {i + 1}",
        call("POST", "/api/students", admin, {"nis": f"JRN{tag}{i}", "name": f"Siswa Uji {i + 1}", "gender": "L", "status": "aktif"}),
        200,
    ))
expect(
    "masukkan siswa ke kelas",
    call("POST", f"/api/classes/{kelas['id']}/students", admin, {"student_ids": [s["id"] for s in siswa]}),
    200,
)
guru = expect(
    "buat guru",
    call("POST", "/api/users", admin, {"name": "Guru Jurnal", "email": f"guru-jurnal-{tag}@sdn1.sch.id", "password": GURU_PASS, "role": "guru"}),
    200,
)
kepsek = expect(
    "buat kepala sekolah",
    call("POST", "/api/users", admin, {"name": "Kepsek Jurnal", "email": f"kepsek-jurnal-{tag}@sdn1.sch.id", "password": KEPSEK_PASS, "role": "kepala_sekolah"}),
    200,
)
penugasan = expect(
    "buat penugasan guru",
    call("POST", "/api/assignments", admin, {"class_id": kelas["id"], "subject_id": mapel["id"], "teacher_id": guru["id"]}),
    200,
)
guru_tok = login(f"guru-jurnal-{tag}@sdn1.sch.id", GURU_PASS)
kepsek_tok = login(f"kepsek-jurnal-{tag}@sdn1.sch.id", KEPSEK_PASS)

# 2. Buat jurnal: draf, lalu validasi isian.
body = {
    "assignment_id": penugasan["id"],
    "journal_date": str(today),
    "hour_no": 1,
    "topic": "Pecahan senilai",
    "notes": None,
    "present_count": 2,
}
j1 = expect("guru membuat jurnal jam 1", call("POST", "/api/jurnal", guru_tok, body), 200)
check("jurnal baru berstatus draft", j1["status"] == "draft", str(j1))
expect(
    "jumlah hadir melebihi siswa kelas ditolak",
    call("POST", "/api/jurnal", guru_tok, {**body, "hour_no": 2, "present_count": 9}),
    422,
)
expect(
    "tanggal di masa depan ditolak",
    call("POST", "/api/jurnal", guru_tok, {**body, "hour_no": 2, "journal_date": "2999-01-01"}),
    422,
)
expect(
    "jam dan tanggal yang sama ditolak",
    call("POST", "/api/jurnal", guru_tok, body),
    409,
)
expect(
    "kepala sekolah tidak bisa membuat jurnal",
    call("POST", "/api/jurnal", kepsek_tok, {**body, "hour_no": 3}),
    403,
)

# 3. Kirim, lalu jurnal menunggu tidak bisa diubah.
sent = expect("guru mengirim jurnal", call("POST", f"/api/jurnal/{j1['id']}/submit", guru_tok), 200)
check("status menjadi menunggu", sent["status"] == "menunggu", str(sent))
expect(
    "jurnal menunggu tidak bisa diubah",
    call("PUT", f"/api/jurnal/{j1['id']}", guru_tok, {**body, "topic": "Ubah saat menunggu"}),
    409,
)

# 4. Tolak: catatan wajib.
expect(
    "penolakan tanpa catatan ditolak",
    call("POST", f"/api/jurnal/{j1['id']}/reject", kepsek_tok, {"note": ""}),
    422,
)
rejected = expect(
    "kepala sekolah menolak dengan catatan",
    call("POST", f"/api/jurnal/{j1['id']}/reject", kepsek_tok, {"note": "Materi terlalu umum"}),
    200,
)
check("status menjadi ditolak", rejected["status"] == "ditolak", str(rejected))
check("penolak tercatat", rejected["decided_by"] == kepsek["id"] and rejected["decided_at"], str(rejected))
expect(
    "buat guru lain",
    call("POST", "/api/users", admin, {"name": "Guru Lain", "email": f"guru-lain-{tag}@sdn1.sch.id", "password": GURU_PASS, "role": "guru"}),
    200,
)
other_tok = login(f"guru-lain-{tag}@sdn1.sch.id", GURU_PASS)
expect(
    "guru lain tidak bisa mengubah jurnal ini",
    call("PUT", f"/api/jurnal/{j1['id']}", other_tok, {**body, "topic": "Bukan milik saya"}),
    403,
)

# 5. Perbaiki saat ditolak, lalu kirim ulang.
fixed = expect(
    "guru memperbaiki jurnal yang ditolak",
    call("PUT", f"/api/jurnal/{j1['id']}", guru_tok, {**body, "topic": "Pecahan senilai dengan gambar"}),
    200,
)
check("status tetap ditolak sampai dikirim ulang", fixed["status"] == "ditolak", str(fixed))
resent = expect("guru mengirim ulang jurnal", call("POST", f"/api/jurnal/{j1['id']}/submit", guru_tok), 200)
check("kirim ulang kembali menunggu", resent["status"] == "menunggu" and resent["decided_by"] is None, str(resent))

# 6. Setujui, lalu larangan ubah setelah disetujui.
approved = expect(
    "kepala sekolah menyetujui",
    call("POST", f"/api/jurnal/{j1['id']}/approve", kepsek_tok, {"note": None}),
    200,
)
check("status menjadi disetujui", approved["status"] == "disetujui", str(approved))
check("penyetuju dan waktu tercatat", approved["decided_by"] == kepsek["id"] and approved["decided_at"], str(approved))
expect(
    "jurnal disetujui tidak bisa diubah",
    call("PUT", f"/api/jurnal/{j1['id']}", guru_tok, {**body, "topic": "Ubah setelah disetujui"}),
    409,
)
expect(
    "jurnal disetujui tidak bisa dikirim ulang",
    call("POST", f"/api/jurnal/{j1['id']}/submit", guru_tok),
    409,
)
expect(
    "jurnal yang sudah diputuskan tidak bisa diputuskan lagi",
    call("POST", f"/api/jurnal/{j1['id']}/reject", kepsek_tok, {"note": "Berubah pikiran"}),
    409,
)

# 7. Rekap hanya menghitung yang disetujui.
j2 = expect(
    "guru membuat jurnal jam 2 (draf)",
    call("POST", "/api/jurnal", guru_tok, {**body, "hour_no": 2, "topic": "Penjumlahan pecahan", "present_count": 1}),
    200,
)
rekap = expect(
    "rekap per penugasan",
    call("GET", f"/api/jurnal/rekap/assignments/{penugasan['id']}", kepsek_tok),
    200,
)
check("rekap hanya menghitung 1 jam disetujui", rekap["jumlah_jam"] == 1, str(rekap))
check("rekap menjumlahkan hadir jam disetujui", rekap["total_hadir"] == 2, str(rekap))
range_rows = expect(
    "rekap per rentang tanggal",
    call("GET", f"/api/jurnal/rekap?from={today}&to={today}&assignment_id={penugasan['id']}", kepsek_tok),
    200,
)
check("rekap rentang berisi penugasan uji", len(range_rows) == 1 and range_rows[0]["jumlah_jam"] == 1, str(range_rows))
expect(
    "rentang tanggal terbalik ditolak",
    call("GET", f"/api/jurnal/rekap?from={today}&to=2020-01-01", kepsek_tok),
    422,
)

# 8. Daftar: guru hanya melihat jurnalnya, kepala sekolah melihat yang menunggu.
guru_list = expect("guru melihat daftar jurnalnya", call("GET", f"/api/jurnal?assignment_id={penugasan['id']}", guru_tok), 200)
check("daftar guru berisi 2 jurnal", len(guru_list) == 2, str(guru_list))
other_list = expect("guru lain melihat daftarnya sendiri", call("GET", f"/api/jurnal?assignment_id={penugasan['id']}", other_tok), 200)
check("guru lain tidak melihat jurnal orang", other_list == [], str(other_list))
expect("guru tidak bisa menyetujui jurnal", call("POST", f"/api/jurnal/{j2['id']}/approve", guru_tok, {"note": None}), 403)

print(f"\nSemua {PASSED} pemeriksaan lulus.")
