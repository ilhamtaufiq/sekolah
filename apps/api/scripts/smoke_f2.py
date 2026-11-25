#!/usr/bin/env python3
"""Smoke test F2 (akademik inti) terhadap API yang sedang berjalan.

Prasyarat: sekolah 'sdn-1' dengan admin admin@sdn1.sch.id / rahasia-123 sudah dibuat
(lihat README). Skrip membuat data uji sendiri; jalankan pada database uji saja.

  python3 scripts/smoke_f2.py http://localhost:8080
"""

import json
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8080"
PASSED = 0


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


def expect(label, got, want, body=None):
    status, payload = got
    check(f"{label} (HTTP {status})", status == want, f"— harapan {want}, body: {payload}")
    return payload


def login(email, password):
    status, payload = call("POST", "/api/auth/login", body={"school_slug": "sdn-1", "email": email, "password": password})
    assert status == 200, payload
    return payload["token"]


today = date.today()
start = date(today.year if today.month >= 7 else today.year - 1, 7, 1)
end = date(start.year + 1, 6, 30)
year_name = f"{start.year}/{start.year + 1}"
tag = datetime.now().strftime("%H%M%S")  # agar nama data uji tidak bentrok saat dijalankan ulang

admin = login("admin@sdn1.sch.id", "rahasia-123")

# 1. Tahun ajaran
years = expect("list tahun ajaran", call("GET", "/api/academic-years", admin), 200)
year = next((y for y in years if y["name"] == year_name), None)
if year is None:
    year = expect("buat tahun ajaran", call("POST", "/api/academic-years", admin, {"name": year_name, "starts_on": str(start), "ends_on": str(end)}), 200)
year = expect("aktifkan tahun ajaran", call("POST", f"/api/academic-years/{year['id']}/activate", admin), 200)
check("tahun ajaran aktif", year["is_active"] is True)
expect("tanggal selesai sebelum mulai ditolak", call("POST", "/api/academic-years", admin, {"name": "X-BAD-DATES", "starts_on": "2030-06-01", "ends_on": "2030-05-01"}), 422)

# 2. Mapel
mtk = expect("buat mapel MTK", call("POST", "/api/subjects", admin, {"code": f"mtk{tag}", "name": "Matematika"}), 200)
bin_ = expect("buat mapel BIN", call("POST", "/api/subjects", admin, {"code": f"bin{tag}", "name": "Bahasa Indonesia"}), 200)
expect("kode mapel duplikat ditolak", call("POST", "/api/subjects", admin, {"code": f"MTK{tag}", "name": "Duplikat"}), 409)

# 3. Pengguna guru dan wali kelas
guru = expect("buat guru", call("POST", "/api/users", admin, {"name": "Guru Satu", "email": f"guru{tag}@sdn1.sch.id", "password": "guru-pass-1", "role": "guru"}), 200)
wali = expect("buat wali kelas", call("POST", "/api/users", admin, {"name": "Wali Satu", "email": f"wali{tag}@sdn1.sch.id", "password": "wali-pass-1", "role": "wali_kelas"}), 200)
expect("peran siswa tidak bisa dibuat dari menu staf", call("POST", "/api/users", admin, {"name": "Siswa Nakal", "email": f"x{tag}@sdn1.sch.id", "password": "password-1", "role": "siswa"}), 422)
guru_token = login(f"guru{tag}@sdn1.sch.id", "guru-pass-1")
wali_token = login(f"wali{tag}@sdn1.sch.id", "wali-pass-1")

# 4. Kelas
kelas_a = expect("buat kelas 7A", call("POST", "/api/classes", admin, {"name": f"7A-{tag}", "grade_level": 7, "homeroom_teacher_id": wali["id"]}), 200)
kelas_b = expect("buat kelas 7B", call("POST", "/api/classes", admin, {"name": f"7B-{tag}", "grade_level": 7, "homeroom_teacher_id": None}), 200)
expect("tingkat di luar 1–12 ditolak", call("POST", "/api/classes", admin, {"name": "Z", "grade_level": 13}), 422)

# 5. Siswa dan rombel
nis = tag
s1 = expect("buat siswa 1", call("POST", "/api/students", admin, {"nis": f"A{nis}", "name": "Andi", "gender": "L", "status": "aktif"}), 200)
s2 = expect("buat siswa 2", call("POST", "/api/students", admin, {"nis": f"B{nis}", "name": "Budi", "gender": "L", "status": "aktif"}), 200)
s3 = expect("buat siswa 3", call("POST", "/api/students", admin, {"nis": f"C{nis}", "name": "Citra", "gender": "P", "status": "keluar"}), 200)
expect("NIS duplikat ditolak", call("POST", "/api/students", admin, {"nis": f"A{nis}", "name": "Dobel", "status": "aktif"}), 409)

roster = expect("masukkan Andi & Budi ke 7A", call("POST", f"/api/classes/{kelas_a['id']}/students", admin, {"student_ids": [s1["id"], s2["id"]]}), 200)
check("rombel 7A berisi 2 siswa", len(roster) == 2, str(roster))
expect("siswa non-aktif ditolak dari rombel", call("POST", f"/api/classes/{kelas_b['id']}/students", admin, {"student_ids": [s3["id"]]}), 422)
expect("siswa yang sudah di kelas lain ditolak", call("POST", f"/api/classes/{kelas_b['id']}/students", admin, {"student_ids": [s2["id"]]}), 422)
expect("masukkan ulang siswa ke kelas yang sama aman", call("POST", f"/api/classes/{kelas_a['id']}/students", admin, {"student_ids": [s1["id"]]}), 200)

# 6. Penugasan
a_mtk_a = expect("guru mengajar MTK di 7A", call("POST", "/api/assignments", admin, {"class_id": kelas_a["id"], "subject_id": mtk["id"], "teacher_id": guru["id"]}), 200)
expect("mapel yang sama di kelas sama ditolak", call("POST", "/api/assignments", admin, {"class_id": kelas_a["id"], "subject_id": mtk["id"], "teacher_id": wali["id"]}), 409)
a_mtk_b = expect("guru yang sama mengajar MTK di 7B", call("POST", "/api/assignments", admin, {"class_id": kelas_b["id"], "subject_id": mtk["id"], "teacher_id": guru["id"]}), 200)
a_bin_a = expect("wali kelas mengajar BIN di 7A", call("POST", "/api/assignments", admin, {"class_id": kelas_a["id"], "subject_id": bin_["id"], "teacher_id": wali["id"]}), 200)

# 7. Jadwal dan bentrok
slot = expect("jadwal MTK 7A Senin 07:00–08:00", call("POST", "/api/schedules", admin, {"assignment_id": a_mtk_a["id"], "day_of_week": 1, "start_time": "07:00:00", "end_time": "08:00:00", "room": "R7"}), 200)
expect("bentrok di kelas yang sama ditolak", call("POST", "/api/schedules", admin, {"assignment_id": a_bin_a["id"], "day_of_week": 1, "start_time": "07:30:00", "end_time": "08:30:00"}), 409)
expect("bentrok guru yang sama di kelas lain ditolak", call("POST", "/api/schedules", admin, {"assignment_id": a_mtk_b["id"], "day_of_week": 1, "start_time": "07:30:00", "end_time": "08:30:00"}), 409)
expect("jam selesai sebelum mulai ditolak", call("POST", "/api/schedules", admin, {"assignment_id": a_bin_a["id"], "day_of_week": 2, "start_time": "09:00:00", "end_time": "08:00:00"}), 422)
expect("jadwal tanpa bentrok diterima", call("POST", "/api/schedules", admin, {"assignment_id": a_bin_a["id"], "day_of_week": 2, "start_time": "07:00:00", "end_time": "08:00:00"}), 200)
sched = expect("daftar jadwal kelas 7A", call("GET", f"/api/schedules?class_id={kelas_a['id']}", admin), 200)
check("jadwal 7A berisi 2 slot", len(sched) == 2, str(sched))

# 8. Absensi
today_s = str(today)
mapel_body = {
    "kind": "mapel",
    "class_id": kelas_a["id"],
    "assignment_id": a_mtk_a["id"],
    "session_date": today_s,
    "records": [{"student_id": s1["id"], "status": "H"}, {"student_id": s2["id"], "status": "s", "note": "demam"}],
}
det = expect("guru pengampu mencatat absensi mapel", call("PUT", "/api/attendance/sessions", guru_token, mapel_body), 200)
check("status dinormalkan ke huruf besar", any(r["status"] == "S" for r in det["records"]), str(det["records"]))

expect("guru lain tidak bisa mencatat absensi mapel ini", call("PUT", "/api/attendance/sessions", wali_token, mapel_body), 403)

harian_body = {
    "kind": "harian",
    "class_id": kelas_a["id"],
    "assignment_id": None,
    "session_date": today_s,
    "records": [{"student_id": s1["id"], "status": "H"}, {"student_id": s2["id"], "status": "I"}],
}
expect("guru bukan wali kelas tidak bisa absensi harian", call("PUT", "/api/attendance/sessions", guru_token, harian_body), 403)
harian = expect("wali kelas mencatat absensi harian", call("PUT", "/api/attendance/sessions", wali_token, harian_body), 200)
check("sesi harian punya dua catatan", len(harian["records"]) == 2)

expect("absensi masa depan ditolak", call("PUT", "/api/attendance/sessions", wali_token, {**harian_body, "session_date": str(today + timedelta(days=3))}), 422)
expect("siswa di luar kelas ditolak", call("PUT", "/api/attendance/sessions", wali_token, {**harian_body, "records": [{"student_id": s3["id"], "status": "H"}]}), 422)
expect("status tidak dikenal ditolak", call("PUT", "/api/attendance/sessions", wali_token, {**harian_body, "records": [{"student_id": s1["id"], "status": "X"}]}), 422)
expect("sesi mapel wajib menyebut penugasan", call("PUT", "/api/attendance/sessions", guru_token, {**mapel_body, "assignment_id": None}), 422)

# Ubah satu status: harus memperbarui, bukan menduplikasi.
expect("koreksi absensi mapel", call("PUT", "/api/attendance/sessions", guru_token, {**mapel_body, "records": [{"student_id": s2["id"], "status": "H"}]}), 200)
sessions = expect("daftar sesi hari ini", call("GET", f"/api/attendance/sessions?class_id={kelas_a['id']}&date={today_s}", admin), 200)
check("dua sesi untuk 7A hari ini", len(sessions) == 2, str(sessions))
mapel_sess = next(s for s in sessions if s["kind"] == "mapel")
check("sesi mapel menghitung 2 hadir dari 2 catatan", mapel_sess["present"] == 2 and mapel_sess["total"] == 2, str(mapel_sess))

# 9. Penghapusan yang dilindungi
expect("penugasan yang sudah ada absensinya tidak bisa dihapus", call("DELETE", f"/api/assignments/{a_mtk_a['id']}", admin), 409)
expect("hapus jadwal", call("DELETE", f"/api/schedules/{slot['id']}", admin), 200)

# 10. Dashboard dan RBAC
summary = expect("ringkasan dashboard", call("GET", "/api/dashboard/summary", admin), 200)
check("dashboard menampilkan tahun aktif", summary["active_year"] == year_name, str(summary))
check("dashboard menghitung absensi harian hari ini", summary["today"]["total"] >= 2, str(summary["today"]))
expect("guru tidak bisa mengubah data master", call("POST", "/api/subjects", guru_token, {"code": "X", "name": "Tidak boleh"}), 403)
me_id = call("GET", "/api/me", admin)[1]["id"]
expect("admin tidak bisa menonaktifkan akunnya sendiri", call("PUT", f"/api/users/{me_id}", admin, {"name": "Admin Sekolah", "role": "admin", "is_active": False}), 422)

print(f"\nSEMUA LULUS: {PASSED} pemeriksaan")
