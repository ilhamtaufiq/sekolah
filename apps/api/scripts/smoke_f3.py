#!/usr/bin/env python3
"""Smoke test F3 (nilai dan raport) terhadap API yang sedang berjalan.

Prasyarat: sekolah 'sdn-1' dengan admin admin@sdn1.sch.id / rahasia-123 sudah dibuat.
Skrip membuat data uji sendiri (tahun ajaran aktif dipakai bila sudah ada).
Jalankan hanya pada database uji.

  python3 scripts/smoke_f3.py http://localhost:8080
"""

import json
import sys
import urllib.error
import urllib.request
from datetime import date, datetime

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8080"
PASSED = 0


def call(method, path, token=None, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            payload = r.read()
            ctype = r.headers.get("content-type", "")
            if raw or "pdf" in ctype:
                return r.status, payload
            return r.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload)
        except json.JSONDecodeError:
            return e.code, payload.decode(errors="replace")


def check(label, cond, detail=""):
    global PASSED
    if not cond:
        print(f"GAGAL: {label} {detail}")
        sys.exit(1)
    PASSED += 1
    print(f"ok    {label}")


def expect(label, got, want):
    status, payload = got
    check(f"{label} (HTTP {status})", status == want, f"— harapan {want}, body: {str(payload)[:300]}")
    return payload


def login(email, password):
    status, payload = call("POST", "/api/auth/login", body={"school_slug": "sdn-1", "email": email, "password": password})
    assert status == 200, payload
    return payload["token"]


today = date.today()
tag = datetime.now().strftime("%H%M%S")
admin = login("admin@sdn1.sch.id", "rahasia-123")

# ---------- Data dasar (tahun ajaran, semester, mapel, guru, kelas, siswa) ----------
start = date(today.year if today.month >= 7 else today.year - 1, 7, 1)
year_name = f"{start.year}/{start.year + 1}"
years = expect("list tahun ajaran", call("GET", "/api/academic-years", admin), 200)
year = next((y for y in years if y["name"] == year_name), None)
if year is None:
    year = expect("buat tahun ajaran", call("POST", "/api/academic-years", admin, {"name": year_name, "starts_on": str(start), "ends_on": str(date(start.year + 1, 6, 30))}), 200)
year = expect("aktifkan tahun ajaran", call("POST", f"/api/academic-years/{year['id']}/activate", admin), 200)

semesters = expect("daftar semester", call("GET", "/api/semesters", admin), 200)
if not semesters:
    expect("buat semester ganjil", call("POST", "/api/semesters", admin, {"ordinal": 1, "starts_on": str(start), "ends_on": str(date(start.year, 12, 31))}), 200)
    semesters = expect("daftar semester", call("GET", "/api/semesters", admin), 200)
semester = next(s for s in semesters if s["ordinal"] == 1)
expect("semester di luar tahun ajaran ditolak", call("POST", "/api/semesters", admin, {"ordinal": 2, "starts_on": "1999-01-01", "ends_on": "1999-06-30"}), 422)

mtk = expect("buat mapel", call("POST", "/api/subjects", admin, {"code": f"mtk{tag}", "name": "Matematika"}), 200)
guru = expect("buat guru pengampu", call("POST", "/api/users", admin, {"name": "Guru Satu", "email": f"guru{tag}@sdn1.sch.id", "password": "guru-pass-1", "role": "guru"}), 200)
guru2 = expect("buat guru lain", call("POST", "/api/users", admin, {"name": "Guru Dua", "email": f"guru2{tag}@sdn1.sch.id", "password": "guru-pass-2", "role": "guru"}), 200)
wali = expect("buat wali kelas", call("POST", "/api/users", admin, {"name": "Wali Satu", "email": f"wali{tag}@sdn1.sch.id", "password": "wali-pass-1", "role": "wali_kelas"}), 200)
guru_t = login(f"guru{tag}@sdn1.sch.id", "guru-pass-1")
guru2_t = login(f"guru2{tag}@sdn1.sch.id", "guru-pass-2")
wali_t = login(f"wali{tag}@sdn1.sch.id", "wali-pass-1")

kelas = expect("buat kelas 7A", call("POST", "/api/classes", admin, {"name": f"7A-{tag}", "grade_level": 7, "homeroom_teacher_id": wali["id"]}), 200)
sA = expect("buat siswa A", call("POST", "/api/students", admin, {"nis": f"A{tag}", "name": "Andi", "gender": "L", "status": "aktif"}), 200)
sB = expect("buat siswa B", call("POST", "/api/students", admin, {"nis": f"B{tag}", "name": "Budi", "gender": "L", "status": "aktif"}), 200)
expect("masukkan siswa ke kelas", call("POST", f"/api/classes/{kelas['id']}/students", admin, {"student_ids": [sA["id"], sB["id"]]}), 200)
asg = expect("guru mengajar mapel di kelas", call("POST", "/api/assignments", admin, {"class_id": kelas["id"], "subject_id": mtk["id"], "teacher_id": guru["id"]}), 200)

# ---------- Komponen nilai ----------
fmt = expect("baca format raport", call("GET", "/api/report-format", admin), 200)
grading = fmt["config"]["grading"]
kkm0 = grading["kkm"]
check("format default memakai rentang 0–100", grading["min_score"] == 0 and grading["max_score"] == 100, str(grading))

expect("bobot 0 ditolak", call("POST", "/api/grade-components", guru_t, {"assignment_id": asg["id"], "semester_id": semester["id"], "name": "Tugas", "weight": 0}), 422)
expect("bobot di atas 100 ditolak", call("POST", "/api/grade-components", guru_t, {"assignment_id": asg["id"], "semester_id": semester["id"], "name": "Tugas", "weight": 101}), 422)
expect("guru lain tidak bisa menambah komponen", call("POST", "/api/grade-components", guru2_t, {"assignment_id": asg["id"], "semester_id": semester["id"], "name": "Tugas", "weight": 30}), 403)
tugas = expect("guru pengampu menambah komponen Tugas", call("POST", "/api/grade-components", guru_t, {"assignment_id": asg["id"], "semester_id": semester["id"], "name": "Tugas", "weight": 30}), 200)
uts = expect("tambah komponen UTS", call("POST", "/api/grade-components", guru_t, {"assignment_id": asg["id"], "semester_id": semester["id"], "name": "UTS", "weight": 30}), 200)
uas = expect("tambah komponen UAS", call("POST", "/api/grade-components", guru_t, {"assignment_id": asg["id"], "semester_id": semester["id"], "name": "UAS", "weight": 40}), 200)
expect("nama komponen duplikat ditolak", call("POST", "/api/grade-components", guru_t, {"assignment_id": asg["id"], "semester_id": semester["id"], "name": "UTS", "weight": 10}), 409)

# ---------- Input nilai ----------
def entries(component, rows):
    return {"component_id": component["id"], "entries": rows}

expect("skor di luar rentang ditolak", call("PUT", "/api/grade-entries", guru_t, entries(tugas, [{"student_id": sA["id"], "score": 150}])), 422)
expect("siswa di luar kelas ditolak", call("PUT", "/api/grade-entries", guru_t, entries(tugas, [{"student_id": "00000000-0000-0000-0000-000000000000", "score": 80}])), 422)
expect("siswa dobel dalam satu permintaan ditolak", call("PUT", "/api/grade-entries", guru_t, entries(tugas, [{"student_id": sA["id"], "score": 80}, {"student_id": sA["id"], "score": 81}])), 422)
rows = expect("permintaan gagal tidak menyimpan apa pun", call("GET", f"/api/grade-entries?component_id={tugas['id']}", guru_t), 200)
check("tidak ada nilai tersimpan setelah permintaan gagal", all(r["score"] is None for r in rows), str(rows))

expect("guru lain tidak bisa mengisi nilai", call("PUT", "/api/grade-entries", guru2_t, entries(tugas, [{"student_id": sA["id"], "score": 80}])), 403)
expect("isi nilai tugas", call("PUT", "/api/grade-entries", guru_t, entries(tugas, [{"student_id": sA["id"], "score": 80}, {"student_id": sB["id"], "score": 60}])), 200)
expect("isi nilai UTS", call("PUT", "/api/grade-entries", guru_t, entries(uts, [{"student_id": sA["id"], "score": 70}, {"student_id": sB["id"], "score": 90}])), 200)
expect("isi nilai UAS", call("PUT", "/api/grade-entries", guru_t, entries(uas, [{"student_id": sA["id"], "score": 90}, {"student_id": sB["id"], "score": 50}])), 200)
expect("koreksi nilai tugas", call("PUT", "/api/grade-entries", guru_t, entries(tugas, [{"student_id": sB["id"], "score": 62, "note": "remedial"}])), 200)

# ---------- Nilai akhir ----------
expect("guru lain tidak bisa menghitung nilai akhir", call("POST", "/api/final-grades/compute", guru2_t, {"assignment_id": asg["id"], "semester_id": semester["id"]}), 403)
finals = expect("hitung nilai akhir", call("POST", "/api/final-grades/compute", guru_t, {"assignment_id": asg["id"], "semester_id": semester["id"]}), 200)
fa = next(f for f in finals if f["student_id"] == sA["id"])
fb = next(f for f in finals if f["student_id"] == sB["id"])
# A: 0.3*80 + 0.3*70 + 0.4*90 = 81 -> predikat B, tuntas. B: 0.3*62 + 0.3*90 + 0.4*50 = 65.6 -> dibulatkan 66, predikat D.
check("nilai akhir A = 81 (rata-rata berbobot)", fa["score"] == 81, str(fa))
check("predikat A = B", fa["predicate"] == "B", str(fa))
check("A tuntas KKM 75", fa["kkm_met"] is True, str(fa))
check("nilai akhir B dibulatkan sesuai desimal format", fb["score"] == 66, str(fb))
check("predikat B = D", fb["predicate"] == "D", str(fb))
check("B tidak tuntas KKM", fb["kkm_met"] is False, str(fb))
check("snapshot menyimpan versi format", fa["format_version"] == fmt["version"], str(fa))

expect("nilai UAS B dikosongkan", call("PUT", "/api/grade-entries", guru_t, entries(uas, [{"student_id": sB["id"], "score": None}])), 200)
finals = expect("hitung ulang setelah nilai dikosongkan", call("POST", "/api/final-grades/compute", guru_t, {"assignment_id": asg["id"], "semester_id": semester["id"]}), 200)
fb = next(f for f in finals if f["student_id"] == sB["id"])
check("siswa dengan komponen kosong ditandai belum lengkap", fb["incomplete"] is True and fb["score"] is None, str(fb))
expect("nilai UAS B dikembalikan", call("PUT", "/api/grade-entries", guru_t, entries(uas, [{"student_id": sB["id"], "score": 50}])), 200)
call("POST", "/api/final-grades/compute", guru_t, {"assignment_id": asg["id"], "semester_id": semester["id"]})

# ---------- KKM dan predikat mengikuti format aktif ----------
new_fmt = json.loads(json.dumps(fmt["config"]))
new_fmt["grading"]["kkm"] = 85
expect("ubah KKM format menjadi 85", call("PUT", "/api/report-format", admin, {"expected_version": fmt["version"], "config": new_fmt}), 200)
finals = expect("hitung ulang dengan KKM baru", call("POST", "/api/final-grades/compute", guru_t, {"assignment_id": asg["id"], "semester_id": semester["id"]}), 200)
fa = next(f for f in finals if f["student_id"] == sA["id"])
check("A kini tidak tuntas KKM 85", fa["kkm_met"] is False, str(fa))
check("versi format pada snapshot ikut naik", fa["format_version"] == fmt["version"] + 1, str(fa))
restored = expect("kembalikan KKM format ke nilai awal", call("PUT", "/api/report-format", admin, {"expected_version": fmt["version"] + 1, "config": fmt["config"]}), 200)
check("format kembali ke KKM awal", restored["config"]["grading"]["kkm"] == kkm0, str(restored["config"]["grading"]))

# ---------- Catatan semester dan absensi ----------
expect("guru mapel tidak bisa menulis catatan wali kelas", call("PUT", "/api/term-notes", guru_t, {"class_id": kelas["id"], "semester_id": semester["id"], "notes": []}), 403)
sess = expect("wali kelas mencatat absensi harian hari ini", call("PUT", "/api/attendance/sessions", wali_t, {
    "kind": "harian", "class_id": kelas["id"], "assignment_id": None, "session_date": str(today),
    "records": [{"student_id": sA["id"], "status": "S"}, {"student_id": sB["id"], "status": "A"}],
}), 200)
expect("wali kelas menyimpan sikap dan catatan", call("PUT", "/api/term-notes", wali_t, {
    "class_id": kelas["id"], "semester_id": semester["id"],
    "notes": [{"student_id": sA["id"], "attitude": "Sopan & rajin", "extracurricular": "Pramuka", "homeroom_note": "Pertahankan"}, {"student_id": sB["id"]}],
}), 200)
notes = expect("baca catatan dan rekap absensi", call("GET", f"/api/term-notes?class_id={kelas['id']}&semester_id={semester['id']}", wali_t), 200)
na = next(n for n in notes if n["student_id"] == sA["id"])
nb = next(n for n in notes if n["student_id"] == sB["id"])
check("rekap absensi A: 1 sakit", na["absences"]["sakit"] == 1 and na["absences"]["alpa"] == 0, str(na))
check("rekap absensi B: 1 alpa", nb["absences"]["alpa"] == 1, str(nb))
check("catatan sikap tersimpan", na["attitude"] == "Sopan & rajin", str(na))

# ---------- Raport ----------
expect("guru mapel tidak bisa generate raport kelas", call("POST", "/api/report-cards/generate", guru_t, {"class_id": kelas["id"], "semester_id": semester["id"]}), 403)
cards = expect("wali kelas generate raport kelas", call("POST", "/api/report-cards/generate", wali_t, {"class_id": kelas["id"], "semester_id": semester["id"]}), 200)
check("raport dibuat untuk dua siswa", len(cards) == 2, str(cards))
ca = next(c for c in cards if c["student_id"] == sA["id"])
cb = next(c for c in cards if c["student_id"] == sB["id"])

status, pdf = call("GET", f"/api/report-cards/{ca['id']}/pdf", admin, raw=True)
check("PDF raport bisa diunduh admin (HTTP %d)" % status, status == 200 and pdf[:4] == b"%PDF", f"{len(pdf)} byte")
check("PDF raport tidak kosong (> 2 KB)", len(pdf) > 2048, f"{len(pdf)} byte")
status, pdf_guru = call("GET", f"/api/report-cards/{ca['id']}/pdf", guru_t, raw=True)
check("guru pengampu bisa mengunduh raport kelasnya", status == 200, str(status))
status, _ = call("GET", f"/api/report-cards/{ca['id']}/pdf", guru2_t, raw=True)
check("guru yang tidak mengajar kelas ditolak (HTTP %d)" % status, status == 403, str(status))

# Akun siswa: hanya raport miliknya sendiri.
expect("buat akun siswa A", call("POST", f"/api/students/{sA['id']}/account", admin, {"email": f"siswa{tag}@sdn1.sch.id", "password": "siswa-pass-1"}), 200)
siswa_t = login(f"siswa{tag}@sdn1.sch.id", "siswa-pass-1")
status, _ = call("GET", f"/api/report-cards/{ca['id']}/pdf", siswa_t, raw=True)
check("siswa bisa mengunduh raport sendiri", status == 200, str(status))
status, _ = call("GET", f"/api/report-cards/{cb['id']}/pdf", siswa_t, raw=True)
check("siswa tidak bisa mengunduh raport orang lain (HTTP %d)" % status, status == 403, str(status))

listed = expect("daftar raport kelas", call("GET", f"/api/report-cards?class_id={kelas['id']}&semester_id={semester['id']}", admin), 200)
check("daftar raport berisi dua baris", len(listed) == 2, str(listed))

# ---------- Komponen yang sudah berisi nilai tidak bisa dihapus ----------
expect("komponen berisi nilai tidak bisa dihapus", call("DELETE", f"/api/grade-components/{tugas['id']}", guru_t), 409)

print(f"\nSEMUA LULUS: {PASSED} pemeriksaan")
