#!/usr/bin/env python3
"""Smoke test F5 (ujian CBT) terhadap API yang sedang berjalan.

Prasyarat: sekolah 'sdn-1' dengan admin admin@sdn1.sch.id / rahasia-123 sudah dibuat.
Skrip membuat data uji sendiri. Untuk menguji batas waktu, skrip memundurkan `deadline`
percobaan langsung di database lewat CLI mysql, jadi jalankan hanya di database uji.

  SIMAS_DB=simas_f5 python3 scripts/smoke_f5.py http://localhost:8085
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8085"
DB = os.environ.get("SIMAS_DB", "simas_f5")
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


def expect(label, got, want):
    status, payload = got
    check(f"{label} (HTTP {status})", status == want, f"— harapan {want}, body: {payload}")
    return payload


def login(school, email, password):
    status, payload = call("POST", "/api/auth/login", body={"school_slug": school, "email": email, "password": password})
    assert status == 200, payload
    return payload["token"]


def db(sql):
    subprocess.run(["mysql", "-uroot", DB, "-e", sql], check=True, capture_output=True)


def uuid_hex(u):
    return u.replace("-", "")


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


now = datetime.now(timezone.utc)
tag = datetime.now().strftime("%H%M%S")
admin = login("sdn-1", "admin@sdn1.sch.id", "rahasia-123")

# ---------- Data dasar: tahun ajaran, mapel, guru, kelas, siswa, penugasan ----------
start = datetime(now.year if now.month >= 7 else now.year - 1, 7, 1).date()
end = datetime(start.year + 1, 6, 30).date()
years = expect("daftar tahun ajaran", call("GET", "/api/academic-years", admin), 200)
year = next((y for y in years if y["name"] == f"{start.year}/{start.year + 1}"), None)
if year is None:
    year = expect("buat tahun ajaran", call("POST", "/api/academic-years", admin, {"name": f"{start.year}/{start.year + 1}", "starts_on": str(start), "ends_on": str(end)}), 200)
expect("aktifkan tahun ajaran", call("POST", f"/api/academic-years/{year['id']}/activate", admin), 200)

subj = expect("buat mapel", call("POST", "/api/subjects", admin, {"code": f"ipa{tag}", "name": "IPA"}), 200)
guru = expect("buat guru", call("POST", "/api/users", admin, {"name": "Guru IPA", "email": f"guru{tag}@sdn1.sch.id", "password": "guru-pass-1", "role": "guru"}), 200)
guru_token = login("sdn-1", f"guru{tag}@sdn1.sch.id", "guru-pass-1")
kelas = expect("buat kelas", call("POST", "/api/classes", admin, {"name": f"8A-{tag}", "grade_level": 8}), 200)
assign = expect("penugasan guru", call("POST", "/api/assignments", admin, {"class_id": kelas["id"], "subject_id": subj["id"], "teacher_id": guru["id"]}), 200)

students = []
for i, name in enumerate(["Dina", "Eko"]):
    s = expect(f"buat siswa {name}", call("POST", "/api/students", admin, {"nis": f"{tag}{i}", "name": name, "status": "aktif"}), 200)
    acc_email = f"{name.lower()}{tag}@sdn1.sch.id"
    expect(f"akun siswa {name}", call("POST", f"/api/students/{s['id']}/account", admin, {"email": acc_email, "password": "siswa-pass-1"}), 200)
    expect(f"masukkan {name} ke kelas", call("POST", f"/api/classes/{kelas['id']}/students", admin, {"student_ids": [s["id"]]}), 200)
    students.append({"name": name, "token": login("sdn-1", acc_email, "siswa-pass-1"), "student": s})
dina, eko = students

# ---------- Bank soal ----------
q_pg1 = expect("soal PG 1", call("POST", "/api/questions", guru_token, {
    "subject_id": subj["id"], "kind": "pg", "body": "Unsur air adalah?", "points": 2,
    "options": [{"key": "A", "text": "H2O"}, {"key": "B", "text": "NaCl"}, {"key": "C", "text": "CO2"}],
    "answer_key": "A"}), 200)
q_pg2 = expect("soal PG 2", call("POST", "/api/questions", guru_token, {
    "subject_id": subj["id"], "kind": "pg", "body": "Planet terdekat matahari?", "points": 1,
    "options": [{"key": "A", "text": "Merkurius"}, {"key": "B", "text": "Bumi"}],
    "answer_key": "A"}), 200)
q_essay = expect("soal esai", call("POST", "/api/questions", guru_token, {
    "subject_id": subj["id"], "kind": "esai", "body": "Jelaskan siklus air.", "points": 3}), 200)
expect("PG tanpa kunci ditolak", call("POST", "/api/questions", guru_token, {
    "subject_id": subj["id"], "kind": "pg", "body": "x", "points": 1,
    "options": [{"key": "A", "text": "a"}, {"key": "B", "text": "b"}], "answer_key": "Z"}), 422)
other = expect("buat mapel lain", call("POST", "/api/subjects", admin, {"code": f"mtk{tag}", "name": "Matematika"}), 200)
expect("guru tanpa mapel tidak bisa menulis soal mapel lain", call("POST", "/api/questions", guru_token, {
    "subject_id": other["id"], "kind": "esai", "body": "x", "points": 1}), 403)

# ---------- Paket ujian ----------
def exam_body(title, window_start, window_end, token=None):
    return {"assignment_id": assign["id"], "title": title, "duration_minutes": 30,
            "window_start": iso(window_start), "window_end": iso(window_end),
            "shuffle_questions": True, "shuffle_options": True, "token": token}

exam = expect("buat paket draf", call("POST", "/api/exams", guru_token, exam_body(
    f"UTS IPA {tag}", now - timedelta(minutes=5), now + timedelta(hours=2))), 200)
expect("paket draf tanpa soal tidak bisa diterbitkan", call("POST", f"/api/exams/{exam['id']}/publish", guru_token), 422)
expect("susun soal paket", call("PUT", f"/api/exams/{exam['id']}/questions", guru_token, {
    "question_ids": [q_pg1["id"], q_pg2["id"], q_essay["id"]]}), 200)
detail = expect("detail paket", call("GET", f"/api/exams/{exam['id']}", guru_token), 200)
check("paket berisi 3 soal, 6 poin", detail["question_count"] == 3 and detail["total_points"] == 6, str(detail))
expect("paket draf belum tampil ke siswa", call("GET", "/api/student/exams", dina["token"]), 200)
check("draf tidak muncul di daftar siswa",
      all(e["exam_id"] != exam["id"] for e in call("GET", "/api/student/exams", dina["token"])[1]))
expect("paket draf tidak bisa dikerjakan", call("POST", f"/api/student/exams/{exam['id']}/start", dina["token"], {}), 409)
expect("publikasi paket", call("POST", f"/api/exams/{exam['id']}/publish", guru_token), 200)
expect("paket terbit tidak bisa diubah", call("PUT", f"/api/exams/{exam['id']}", guru_token, exam_body("Ubah", now - timedelta(minutes=5), now + timedelta(hours=2))), 409)
expect("soal paket terbit tidak bisa diubah", call("PUT", f"/api/questions/{q_pg1['id']}", guru_token, {
    "subject_id": subj["id"], "kind": "pg", "body": "Diubah", "points": 2,
    "options": [{"key": "A", "text": "a"}, {"key": "B", "text": "b"}], "answer_key": "B"}), 409)
expect("soal yang dipakai tidak bisa dihapus", call("DELETE", f"/api/questions/{q_pg2['id']}", guru_token), 409)

# ---------- Sisi siswa ----------
listed = expect("daftar ujian siswa Dina", call("GET", "/api/student/exams", dina["token"]), 200)
mine = next((e for e in listed if e["exam_id"] == exam["id"]), None)
check("paket terbit tampil untuk siswa Dina", mine is not None and mine["token_required"] is False, str(listed))
expect("siswa lain di luar kelas tidak bisa mulai", call("POST", f"/api/student/exams/{exam['id']}/start", admin, {}), 403)

view = expect("Dina mulai ujian", call("POST", f"/api/student/exams/{exam['id']}/start", dina["token"], {}), 200)
check("ujian punya 3 soal", len(view["questions"]) == 3, str(view))
blob = json.dumps(view)
check("kunci jawaban tidak dikirim ke siswa", "answer_key" not in blob, blob[:300])
check("kunci jawaban tidak bocor di opsi", all("answer_key" not in q for q in view["questions"]))
check("deadline di server, bukan di klien", view["deadline"] and view["server_now"], str(view)[:200])
attempt_id = view["attempt_id"]
pg1 = next(q for q in view["questions"] if q["question_id"] == q_pg1["id"])
pg1_key = "A"

expect("mulai ulang saat sedang berjalan mengembalikan percobaan yang sama", call("POST", f"/api/student/exams/{exam['id']}/start", dina["token"], {}), 200)
expect("autosave jawaban PG", call("PUT", f"/api/student/attempts/{attempt_id}/answers/{q_pg1['id']}", dina["token"], {"answer": "a"}), 200)
got = expect("ambil percobaan setelah autosave", call("GET", f"/api/student/attempts/{attempt_id}", dina["token"]), 200)
saved = next(q for q in got["questions"] if q["question_id"] == q_pg1["id"])
check("jawaban tersimpan di server (huruf besar)", saved["answer"] == "A", str(saved))
expect("pilihan di luar opsi ditolak", call("PUT", f"/api/student/attempts/{attempt_id}/answers/{q_pg1['id']}", dina["token"], {"answer": "Z"}), 422)
expect("autosave esai", call("PUT", f"/api/student/attempts/{attempt_id}/answers/{q_essay['id']}", dina["token"], {"answer": "Air menguap lalu mengembun."}), 200)
expect("catat kejadian pindah tab", call("POST", f"/api/student/attempts/{attempt_id}/events", dina["token"], {"kind": "blur"}), 200)
expect("kejadian tidak dikenal ditolak", call("POST", f"/api/student/attempts/{attempt_id}/events", dina["token"], {"kind": "lain"}), 422)
expect("siswa lain tidak bisa membaca percobaan Dina", call("GET", f"/api/student/attempts/{attempt_id}", eko["token"]), 404)
expect("siswa tidak bisa membuka monitoring guru", call("GET", f"/api/exams/{exam['id']}/attempts", dina["token"]), 403)

sub = expect("Dina submit", call("POST", f"/api/student/attempts/{attempt_id}/submit", dina["token"], {}), 200)
check("status submitted, esai menunggu nilai", sub["status"] == "submitted" and sub["graded"] is False and sub["score"] is None, str(sub))
expect("submit kedua ditolak", call("POST", f"/api/student/attempts/{attempt_id}/submit", dina["token"], {}), 409)
expect("autosave setelah submit ditolak", call("PUT", f"/api/student/attempts/{attempt_id}/answers/{q_pg1['id']}", dina["token"], {"answer": "B"}), 409)
closed = expect("percobaan selesai tidak membuka soal lagi", call("GET", f"/api/student/attempts/{attempt_id}", dina["token"]), 200)
check("percobaan selesai tidak membocorkan soal", closed["questions"] == [], str(closed))

# ---------- Batas waktu di server ----------
eko_view = expect("Eko mulai ujian", call("POST", f"/api/student/exams/{exam['id']}/start", eko["token"], {}), 200)
eko_attempt = eko_view["attempt_id"]
expect("Eko jawab sebelum waktu habis", call("PUT", f"/api/student/attempts/{eko_attempt}/answers/{q_pg1['id']}", eko["token"], {"answer": "A"}), 200)
db(f"UPDATE exam_attempts SET deadline = UTC_TIMESTAMP(6) - INTERVAL 5 MINUTE WHERE id = UNHEX('{uuid_hex(eko_attempt)}')")
expect("submit setelah deadline + grace ditolak", call("POST", f"/api/student/attempts/{eko_attempt}/submit", eko["token"], {}), 409)
expired = expect("percobaan kedaluwarsa tercatat", call("GET", f"/api/student/attempts/{eko_attempt}", eko["token"]), 200)
check("status expired setelah deadline", expired["status"] == "expired", str(expired)[:200])
expect("autosave setelah waktu habis ditolak", call("PUT", f"/api/student/attempts/{eko_attempt}/answers/{q_pg1['id']}", eko["token"], {"answer": "B"}), 409)

# Nilai PG tetap dihitung untuk percobaan yang kedaluwarsa (jawaban A benar = 2 poin).
monitor = expect("monitoring percobaan", call("GET", f"/api/exams/{exam['id']}/attempts", guru_token), 200)
eko_row = next(r for r in monitor if r["attempt_id"] == eko_attempt)
check("nilai PG benar dihitung (2 dari 2 poin PG)", eko_row["score"] == 2, str(eko_row))
dina_row = next(r for r in monitor if r["attempt_id"] == attempt_id)
check("log kejadian Dina tercatat (1)", dina_row["events"] == 1, str(dina_row))
check("esai Dina menunggu penilaian", dina_row["pending_essays"] == 1 and dina_row["graded"] is False, str(dina_row))

# ---------- Penilaian esai ----------
expect("skor esai melebihi poin ditolak", call("PUT", f"/api/attempts/{attempt_id}/answers/{q_essay['id']}/score", guru_token, {"score": 9}), 422)
answers = expect("jawaban percobaan untuk guru", call("GET", f"/api/exams/{exam['id']}/attempts/{attempt_id}", guru_token), 200)
check("guru melihat jawaban esai Dina", any(a["kind"] == "esai" and a["answer"] for a in answers), str(answers))
expect("siswa tidak bisa membaca jawaban percobaan guru", call("GET", f"/api/exams/{exam['id']}/attempts/{attempt_id}", dina["token"]), 403)
expect("nilai esai", call("PUT", f"/api/attempts/{attempt_id}/answers/{q_essay['id']}/score", guru_token, {"score": 2}), 200)
monitor = expect("monitoring setelah nilai esai", call("GET", f"/api/exams/{exam['id']}/attempts", guru_token), 200)
dina_row = next(r for r in monitor if r["attempt_id"] == attempt_id)
check("percobaan Dina sudah dinilai: skor 2 PG + 2 esai = 4", dina_row["graded"] is True and dina_row["score"] == 4, str(dina_row))

# ---------- Token ujian ----------
tok_exam = expect("paket dengan token", call("POST", "/api/exams", guru_token, exam_body(
    f"Remidi {tag}", now - timedelta(minutes=5), now + timedelta(hours=2), token="RAHASIA1")), 200)
expect("susun soal paket token", call("PUT", f"/api/exams/{tok_exam['id']}/questions", guru_token, {"question_ids": [q_pg2["id"]]}), 200)
expect("terbitkan paket token", call("POST", f"/api/exams/{tok_exam['id']}/publish", guru_token), 200)
listed = expect("daftar siswa untuk paket token", call("GET", "/api/student/exams", eko["token"]), 200)
check("token tidak dikirim ke siswa, hanya tandanya", next(e for e in listed if e["exam_id"] == tok_exam["id"])["token_required"] is True)
expect("mulai tanpa token ditolak", call("POST", f"/api/student/exams/{tok_exam['id']}/start", eko["token"], {}), 403)
expect("token salah ditolak", call("POST", f"/api/student/exams/{tok_exam['id']}/start", eko["token"], {"token": "SALAH"}), 403)
expect("token benar diterima", call("POST", f"/api/student/exams/{tok_exam['id']}/start", eko["token"], {"token": "RAHASIA1"}), 200)

# ---------- Jendela waktu ----------
future = expect("paket jendela masa depan", call("POST", "/api/exams", guru_token, exam_body(
    f"Susulan {tag}", now + timedelta(hours=3), now + timedelta(hours=4))), 200)
expect("susun soal paket susulan", call("PUT", f"/api/exams/{future['id']}/questions", guru_token, {"question_ids": [q_pg2["id"]]}), 200)
expect("terbitkan paket susulan", call("POST", f"/api/exams/{future['id']}/publish", guru_token), 200)
expect("di luar jendela tidak bisa mulai", call("POST", f"/api/student/exams/{future['id']}/start", eko["token"], {}), 409)

# ---------- Analisis ----------
ana = expect("analisis butir", call("GET", f"/api/exams/{exam['id']}/analysis", guru_token), 200)
check("analisis mencakup percobaan selesai dan kedaluwarsa", ana["attempts"] == 2, str(ana))
check("analisis sementara selama jendela masih buka", ana["provisional"] is True)
pg_item = next(i for i in ana["items"] if i["question_id"] == q_pg1["id"])
check("kesukaran soal PG 1 dihitung (2 benar dari 2)", pg_item["difficulty"] == 1.0, str(pg_item))
essay_item = next(i for i in ana["items"] if i["question_id"] == q_essay["id"])
check("esai tidak punya analisis butir", essay_item["difficulty"] is None and essay_item["discrimination"] is None)

# ---------- Penolakan siswa ----------
expect("siswa tidak bisa mengakses bank soal", call("GET", "/api/questions", dina["token"]), 403)
expect("siswa tidak bisa membuat paket", call("POST", "/api/exams", dina["token"], exam_body("x", now, now + timedelta(hours=1))), 403)

# Fixture untuk tes browser (e2e/f5-pages.cjs): akun dan id data uji.
fixture = {
    "guru_email": f"guru{tag}@sdn1.sch.id",
    "guru_password": "guru-pass-1",
    "student_email": students[0]["student"] and f"dina{tag}@sdn1.sch.id",
    "student_password": "siswa-pass-1",
    "assignment_id": assign["id"],
    "subject_id": subj["id"],
    "question_ids": [q_pg1["id"], q_essay["id"]],
}
with open(os.environ.get("SIMAS_FIXTURE", "/home/user/simas-scratch/f5-fixture.json"), "w") as f:
    json.dump(fixture, f, indent=2)

print(f"\nSEMUA LULUS: {PASSED} pemeriksaan")
