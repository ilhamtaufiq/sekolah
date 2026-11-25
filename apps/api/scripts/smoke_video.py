#!/usr/bin/env python3
"""Smoke test video YouTube dan progres tonton (LMS).

Membuat datanya sendiri dan memakai waktu nyata: heartbeat dikirim sesuai jeda sungguhan
supaya aturan kredit diuji apa adanya. Butuh admin sdn-1 (admin@sdn1.sch.id / rahasia-123).

  python3 scripts/smoke_video.py http://localhost:8080
"""

import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

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


def expect(label, got, want):
    status, payload = got
    check(f"{label} (HTTP {status})", status == want, f"— harapan {want}, body: {str(payload)[:300]}")
    return payload


def login(email, password):
    status, payload = call("POST", "/api/auth/login", body={"school_slug": "sdn-1", "email": email, "password": password})
    assert status == 200, payload
    return payload["token"]


tag = datetime.now().strftime("%H%M%S")
now = datetime.now(timezone.utc)
VIDEO = "dQw4w9WgXcQ"

admin = login("admin@sdn1.sch.id", "rahasia-123")
subj = expect("mapel", call("POST", "/api/subjects", admin, {"code": f"VID{tag}", "name": f"Video {tag}"}), 200)
guru_email = f"vidguru{tag}@sdn1.sch.id"
guru = expect("guru", call("POST", "/api/users", admin, {"name": "Guru Video", "email": guru_email, "password": "guru-pass-1", "role": "guru"}), 200)
guru_token = login(guru_email, "guru-pass-1")
years = expect("tahun ajaran", call("GET", "/api/academic-years", admin), 200)
if not any(y["is_active"] for y in years):
    start = datetime(now.year if now.month >= 7 else now.year - 1, 7, 1).date()
    y = expect("buat tahun ajaran", call("POST", "/api/academic-years", admin, {
        "name": f"{start.year}/{start.year + 1}", "starts_on": str(start), "ends_on": str(start.replace(year=start.year + 1, day=30, month=6))}), 200)
    expect("aktifkan tahun ajaran", call("POST", f"/api/academic-years/{y['id']}/activate", admin), 200)
kelas = expect("kelas", call("POST", "/api/classes", admin, {"name": f"VID-{tag}", "grade_level": 7}), 200)
asg = expect("penugasan", call("POST", "/api/assignments", admin, {"class_id": kelas["id"], "subject_id": subj["id"], "teacher_id": guru["id"]}), 200)

students = {}
for label in ("a", "b", "luar"):
    st = expect(f"siswa {label}", call("POST", "/api/students", admin, {"nis": f"V{label}{tag}", "name": f"Siswa {label}", "status": "aktif"}), 200)
    email = f"vid{label}{tag}@sdn1.sch.id"
    expect(f"akun siswa {label}", call("POST", f"/api/students/{st['id']}/account", admin, {"email": email, "password": "siswa-pass-1"}), 200)
    students[label] = {"id": st["id"], "token": login(email, "siswa-pass-1")}
    if label != "luar":
        expect(f"masuk rombel {label}", call("POST", f"/api/classes/{kelas['id']}/students", admin, {"student_ids": [st["id"]]}), 200)

# ---------- Materi video ----------
expect("tautan YouTube tidak valid ditolak", call("POST", f"/api/lms/rooms/{asg['id']}/materials", guru_token, {
    "title": "Rusak", "youtube_url": "https://example.com/video"}), 422)
mat = expect("materi video", call("POST", f"/api/lms/rooms/{asg['id']}/materials", guru_token, {
    "title": f"Video {tag}", "youtube_url": f"https://youtu.be/{VIDEO}?si=abc"}), 200)
check("id video tersimpan dari tautan", mat["youtube_id"] == VIDEO, str(mat)[:200])
seek = expect("materi video untuk uji lompatan", call("POST", f"/api/lms/rooms/{asg['id']}/materials", guru_token, {
    "title": f"Lompat {tag}", "youtube_url": f"https://www.youtube.com/watch?v={VIDEO}"}), 200)

# ---------- Siswa menonton sampai habis ----------
a = students["a"]["token"]
path = f"/api/lms/materials/{mat['id']}/progress"
first = expect("heartbeat pertama", call("POST", path, a, {"position": 0, "duration": 3}), 200)
check("belum selesai di awal", first["completed"] is False and first["watched_seconds"] == 0, str(first))
for pos in (1, 2, 3):
    time.sleep(1)
    beat = expect(f"heartbeat posisi {pos}", call("POST", path, a, {"position": pos, "duration": 3}), 200)
check("selesai setelah ditonton 100%", beat["completed"] is True and beat["percent"] == 100, str(beat))
own = expect("progres sendiri", call("GET", path, a), 200)
check("progres sendiri menunjukkan selesai", own["completed"] is True, str(own))

# ---------- Lompatan posisi tidak dihitung ----------
seek_path = f"/api/lms/materials/{seek['id']}/progress"
expect("heartbeat awal lompat-test", call("POST", seek_path, a, {"position": 0, "duration": 600}), 200)
time.sleep(1)
jumped = expect("lompat ke menit 5", call("POST", seek_path, a, {"position": 300, "duration": 600}), 200)
check("lompatan tidak menambah detik tonton", jumped["watched_seconds"] < 2 and jumped["completed"] is False, str(jumped))

# ---------- Hak akses ----------
expect("siswa di luar kelas ditolak", call("POST", path, students["luar"]["token"], {"position": 1, "duration": 3}), 403)
expect("guru tidak bisa melapor progres", call("POST", path, guru_token, {"position": 1, "duration": 3}), 403)
expect("progres video dengan posisi negatif ditolak", call("POST", seek_path, a, {"position": -5, "duration": 600}), 422)
text = expect("materi teks", call("POST", f"/api/lms/rooms/{asg['id']}/materials", guru_token, {"title": f"Teks {tag}", "body": "bacaan"}), 200)
expect("materi teks tidak punya progres video", call("POST", f"/api/lms/materials/{text['id']}/progress", a, {"position": 1, "duration": 3}), 422)

# ---------- Rekap guru ----------
summary = expect("rekap progres guru", call("GET", f"/api/lms/rooms/{asg['id']}/progress", guru_token), 200)
row = next(r for r in summary if r["material_id"] == mat["id"])
check("rekap menghitung 2 siswa dan 1 selesai", row["enrolled"] == 2 and row["completed"] == 1, str(row))
expect("siswa tidak bisa melihat rekap guru", call("GET", f"/api/lms/rooms/{asg['id']}/progress", a), 403)

print(f"\nSEMUA LULUS: {PASSED} pemeriksaan")
