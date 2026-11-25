#!/usr/bin/env python3
"""Smoke test integrasi: tugas LMS -> nilai F3, mode tes ujian, dan raport milik siswa.

Membuat datanya sendiri. Butuh admin sdn-1 (admin@sdn1.sch.id / rahasia-123) dan akses
MySQL lokal untuk memeriksa tabel nilai.

  SIMAS_DB=simas_test python3 scripts/smoke_integrasi.py http://localhost:8080
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8080"
DB = os.environ.get("SIMAS_DB", "simas_test")
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


def multipart(fields):
    boundary = uuid.uuid4().hex
    out = bytearray()
    for name, value in fields:
        out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


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


def mysql(sql):
    return subprocess.run(["mysql", "-uroot", DB, "-N", "-e", sql], capture_output=True, text=True, check=True).stdout.strip()


tag = datetime.now().strftime("%H%M%S")
now = datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


admin = login("admin@sdn1.sch.id", "rahasia-123")

# ---------- Data dasar ----------
year = next(y for y in expect("tahun ajaran", call("GET", "/api/academic-years", admin), 200) if y["is_active"])
subj = expect("mapel", call("POST", "/api/subjects", admin, {"code": f"INT{tag}", "name": f"Integrasi {tag}"}), 200)
guru_email = f"integguru{tag}@sdn1.sch.id"
guru = expect("guru", call("POST", "/api/users", admin, {"name": "Guru Integrasi", "email": guru_email, "password": "guru-pass-1", "role": "guru"}), 200)
guru_token = login(guru_email, "guru-pass-1")
kelas = expect("kelas", call("POST", "/api/classes", admin, {"name": f"9A-{tag}", "grade_level": 9}), 200)
asg = expect("penugasan", call("POST", "/api/assignments", admin, {"class_id": kelas["id"], "subject_id": subj["id"], "teacher_id": guru["id"]}), 200)
other_kelas = expect("kelas lain", call("POST", "/api/classes", admin, {"name": f"9B-{tag}", "grade_level": 9}), 200)
other_asg = expect("penugasan kelas lain", call("POST", "/api/assignments", admin, {"class_id": other_kelas["id"], "subject_id": subj["id"], "teacher_id": guru["id"]}), 200)

siswa_email = f"integsiswa{tag}@sdn1.sch.id"
st = expect("siswa", call("POST", "/api/students", admin, {"nis": f"I{tag}", "name": "Siswa Integrasi", "gender": "P", "status": "aktif"}), 200)
expect("akun siswa", call("POST", f"/api/students/{st['id']}/account", admin, {"email": siswa_email, "password": "siswa-pass-1"}), 200)
expect("masuk rombel", call("POST", f"/api/classes/{kelas['id']}/students", admin, {"student_ids": [st["id"]]}), 200)
siswa_token = login(siswa_email, "siswa-pass-1")

# ---------- 1. Tugas LMS terhubung ke nilai F3 ----------
semesters = expect("daftar semester", call("GET", "/api/semesters", admin), 200)
semester = next((x for x in semesters if x["academic_year_id"] == year["id"] and x["ordinal"] == 1), None)
if semester is None:
    semester = expect("buat semester", call("POST", "/api/semesters", admin, {
        "ordinal": 1, "starts_on": year["starts_on"], "ends_on": year["ends_on"]}), 200)
comp = expect("komponen nilai", call("POST", "/api/grade-components", guru_token, {
    "assignment_id": asg["id"], "semester_id": semester["id"], "name": f"Tugas LMS {tag}", "weight": 1}), 200)
comp_other = expect("komponen penugasan lain", call("POST", "/api/grade-components", guru_token, {
    "assignment_id": other_asg["id"], "semester_id": semester["id"], "name": f"Lain {tag}", "weight": 1}), 200)

due = iso(now + timedelta(days=2))
expect("komponen dari penugasan lain ditolak", call("POST", f"/api/lms/rooms/{asg['id']}/tasks", guru_token, {
    "title": "Salah", "due_at": due, "max_score": 50, "allow_late": False, "grade_component_id": comp_other["id"]}), 422)
task = expect("tugas terhubung", call("POST", f"/api/lms/rooms/{asg['id']}/tasks", guru_token, {
    "title": f"PR {tag}", "due_at": due, "max_score": 50, "allow_late": False, "grade_component_id": comp["id"]}), 200)
check("tugas menyimpan komponen", task["grade_component_id"] == comp["id"], str(task))

body, ct = multipart([("text", "jawaban saya")])
req = urllib.request.Request(f"{BASE}/api/lms/tasks/{task['id']}/submission", data=body, method="PUT")
req.add_header("content-type", ct)
req.add_header("authorization", f"Bearer {siswa_token}")
with urllib.request.urlopen(req) as r:
    sub = json.loads(r.read())
check("siswa mengumpulkan tugas", sub is not None)
sub_id = mysql(f"SELECT LOWER(HEX(id)) FROM lms_submissions WHERE task_id = UNHEX('{task['id'].replace('-', '')}')")
hex_comp = comp["id"].replace("-", "")
hex_st = st["id"].replace("-", "")


def f3_score():
    out = mysql(f"SELECT score FROM grade_entries WHERE component_id = UNHEX('{hex_comp}') AND student_id = UNHEX('{hex_st}')")
    return float(out) if out else None


expect("guru menilai 40 dari 50", call("PUT", f"/api/lms/submissions/{sub_id}/grade", guru_token, {"score": 40}), 200)
check("nilai tugas masuk ke F3 dan diskalakan ke 0–100 (80)", f3_score() == 80.0, str(f3_score()))
expect("guru mengoreksi nilai menjadi 25 dari 50", call("PUT", f"/api/lms/submissions/{sub_id}/grade", guru_token, {"score": 25}), 200)
check("koreksi memperbarui entri, tidak menduplikasi (50)", f3_score() == 50.0, str(f3_score()))
check("hanya satu entri untuk siswa dan komponen", mysql(f"SELECT COUNT(*) FROM grade_entries WHERE component_id = UNHEX('{hex_comp}') AND student_id = UNHEX('{hex_st}')") == "1")

# ---------- 2. Mode tes ujian ----------
q = expect("soal uji", call("POST", "/api/questions", guru_token, {
    "subject_id": subj["id"], "kind": "pg", "body": "Pilih A?", "points": 1,
    "options": [{"key": "A", "text": "ya"}, {"key": "B", "text": "tidak"}], "answer_key": "A"}), 200)
exam = expect("paket uji", call("POST", "/api/exams", guru_token, {
    "assignment_id": asg["id"], "title": f"Tes {tag}", "duration_minutes": 20,
    "window_start": iso(now - timedelta(minutes=5)), "window_end": iso(now + timedelta(hours=2)),
    "shuffle_questions": False, "shuffle_options": False, "token": None}), 200)
expect("susun soal paket uji", call("PUT", f"/api/exams/{exam['id']}/questions", guru_token, {"question_ids": [q["id"]]}), 200)
pv = expect("mode tes untuk guru", call("GET", f"/api/exams/{exam['id']}/preview", guru_token), 200)
check("pratinjau berisi soal dan opsi", len(pv["questions"]) == 1 and len(pv["questions"][0]["options"]) == 2, str(pv)[:200])
check("pratinjau tidak membocorkan kunci jawaban", "answer_key" not in json.dumps(pv), str(pv)[:200])
expect("siswa tidak bisa memakai mode tes", call("GET", f"/api/exams/{exam['id']}/preview", siswa_token), 403)
attempts = expect("daftar percobaan", call("GET", f"/api/exams/{exam['id']}/attempts", guru_token), 200)
check("mode tes tidak membuat percobaan", attempts == [], str(attempts)[:200])

# ---------- 2b. Token acak otomatis ----------
rnd = expect("paket dengan token acak", call("POST", "/api/exams", guru_token, {
    "assignment_id": asg["id"], "title": f"Acak {tag}", "duration_minutes": 20,
    "window_start": iso(now - timedelta(minutes=5)), "window_end": iso(now + timedelta(hours=2)),
    "shuffle_questions": False, "shuffle_options": False, "generate_token": True}), 200)
issued = rnd["issued_token"]
check("token acak 8 karakter tanpa huruf yang mirip", isinstance(issued, str) and len(issued) == 8
      and all(c in "ABCDEFGHJKMNPQRSTUVWXYZ23456789" for c in issued), str(issued))
check("token acak tidak ikut di respons lain", "issued_token" not in expect("detail paket acak", call("GET", f"/api/exams/{rnd['id']}", guru_token), 200))
check("token acak tersimpan sebagai hash argon2", mysql(f"SELECT token_hash FROM exams WHERE id = UNHEX('{rnd['id'].replace('-', '')}')").startswith("$argon2"))
expect("soal paket acak", call("PUT", f"/api/exams/{rnd['id']}/questions", guru_token, {"question_ids": [q["id"]]}), 200)
expect("terbitkan paket acak", call("POST", f"/api/exams/{rnd['id']}/publish", guru_token), 200)
expect("siswa masuk dengan token acak", call("POST", f"/api/student/exams/{rnd['id']}/start", siswa_token, {"token": issued}), 200)

# ---------- 3. Raport saya ----------
mine = expect("raport saya untuk siswa", call("GET", "/api/me/report-cards", siswa_token), 200)
db_count = int(mysql(f"SELECT COUNT(*) FROM report_cards r JOIN students s ON s.id = r.student_id WHERE s.id = UNHEX('{hex_st}')"))
check("daftar raport hanya berisi raport siswa ini", len(mine) == db_count, f"api={len(mine)} db={db_count}")
expect("guru tidak memakai daftar raport pribadi", call("GET", "/api/me/report-cards", guru_token), 403)

print(f"\nSEMUA LULUS: {PASSED} pemeriksaan")
