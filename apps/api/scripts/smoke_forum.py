#!/usr/bin/env python3
"""Smoke test forum materi dan penanda tugas terlambat.

Membuat datanya sendiri. Butuh admin sdn-1 (admin@sdn1.sch.id / rahasia-123).

  python3 scripts/smoke_forum.py http://localhost:8080
"""

import json
import sys
import urllib.error
import urllib.request
import uuid
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


def submit(method, token, task_id, text):
    """Pengumpulan tugas: multipart dengan field `text` (metode PUT, seperti di web)."""
    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n{text}\r\n--{boundary}--\r\n"
    ).encode()
    req = urllib.request.Request(f"{BASE}/api/lms/tasks/{task_id}/submission", data=body, method=method)
    req.add_header("content-type", f"multipart/form-data; boundary={boundary}")
    req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


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
admin = login("admin@sdn1.sch.id", "rahasia-123")

years = expect("tahun ajaran", call("GET", "/api/academic-years", admin), 200)
if not any(y["is_active"] for y in years):
    y = expect("buat tahun ajaran", call("POST", "/api/academic-years", admin, {"name": "2026/2027", "starts_on": "2026-07-01", "ends_on": "2027-06-30"}), 200)
    expect("aktifkan tahun ajaran", call("POST", f"/api/academic-years/{y['id']}/activate", admin), 200)

subj = expect("mapel", call("POST", "/api/subjects", admin, {"code": f"FR{tag}", "name": f"Forum {tag}"}), 200)
guru_email = f"frguru{tag}@sdn1.sch.id"
guru = expect("guru", call("POST", "/api/users", admin, {"name": "Guru Forum", "email": guru_email, "password": "guru-pass-1", "role": "guru"}), 200)
guru_token = login(guru_email, "guru-pass-1")
kelas = expect("kelas", call("POST", "/api/classes", admin, {"name": f"FR-{tag}", "grade_level": 8}), 200)
asg = expect("penugasan", call("POST", "/api/assignments", admin, {"class_id": kelas["id"], "subject_id": subj["id"], "teacher_id": guru["id"]}), 200)
room = asg["id"]

# Dua siswa di dalam kelas (a, c) dan satu di luar kelas (luar).
tokens = {}
for label in ("a", "c", "luar"):
    st = expect(f"siswa {label}", call("POST", "/api/students", admin, {"nis": f"F{label}{tag}", "name": f"Siswa Forum {label}", "status": "aktif"}), 200)
    email = f"fr{label}{tag}@sdn1.sch.id"
    expect(f"akun siswa {label}", call("POST", f"/api/students/{st['id']}/account", admin, {"email": email, "password": "siswa-pass-1"}), 200)
    tokens[label] = login(email, "siswa-pass-1")
    if label != "luar":
        expect(f"masuk rombel {label}", call("POST", f"/api/classes/{kelas['id']}/students", admin, {"student_ids": [st["id"]]}), 200)

sa, sc, sluar = tokens["a"], tokens["c"], tokens["luar"]

# ---------- Forum materi ----------
mat = expect("materi", call("POST", f"/api/lms/rooms/{room}/materials", guru_token, {"title": f"Bahan forum {tag}", "body": "Diskusikan bab ini."}), 200)
mpath = f"/api/lms/materials/{mat['id']}/comments"
other = expect("materi lain untuk uji silang", call("POST", f"/api/lms/rooms/{room}/materials", guru_token, {"title": f"Bahan lain {tag}"}), 200)

c_siswa = expect("siswa berkomentar", call("POST", mpath, sa, {"body": "Apa beda sel hewan dan tumbuhan?"}), 200)
check("komentar siswa ditandai bisa dihapus pemiliknya", c_siswa["can_delete"] is True and c_siswa["author_role"] == "siswa", str(c_siswa)[:200])
c_guru = expect("guru berkomentar", call("POST", mpath, guru_token, {"body": "Lihat halaman 12 pada modul."}), 200)
check("komentar guru memakai peran guru", c_guru["author_role"] == "guru", str(c_guru)[:200])
reply = expect("guru membalas komentar siswa", call("POST", mpath, guru_token, {"body": "Baca bagian organel.", "parent_id": c_siswa["id"]}), 200)
check("balasan menunjuk induknya", reply["parent_id"] == c_siswa["id"], str(reply)[:200])
expect("balasan atas balasan ditolak", call("POST", mpath, sa, {"body": "Lanjutan", "parent_id": reply["id"]}), 422)
expect("induk dari materi lain ditolak", call("POST", f"/api/lms/materials/{other['id']}/comments", guru_token, {"body": "X", "parent_id": c_siswa["id"]}), 422)
expect("komentar kosong ditolak", call("POST", mpath, sa, {"body": "   "}), 422)
expect("komentar lebih dari 2000 karakter ditolak", call("POST", mpath, sa, {"body": "a" * 2001}), 422)
expect("komentar 2000 karakter diterima", call("POST", mpath, sa, {"body": "b" * 2000}), 200)

listed = expect("daftar komentar siswa", call("GET", mpath, sa), 200)
check("siswa melihat semua komentar dan balasan", len(listed) >= 4, str(len(listed)))
by_id = {c["id"]: c for c in listed}
check("siswa tidak bisa menghapus komentar guru", by_id[c_guru["id"]]["can_delete"] is False, str(by_id[c_guru["id"]])[:200])

# ---------- Hak hapus ----------
expect("siswa c tidak bisa menghapus komentar siswa a", call("DELETE", f"/api/lms/comments/{c_siswa['id']}", sc), 403)
expect("siswa tidak bisa menghapus komentar guru", call("DELETE", f"/api/lms/comments/{c_guru['id']}", sa), 403)
own = expect("siswa berkomentar lalu menghapus sendiri", call("POST", mpath, sc, {"body": "Komentar sementara"}), 200)
expect("siswa menghapus komentarnya sendiri", call("DELETE", f"/api/lms/comments/{own['id']}", sc), 200)
expect("komentar terhapus tidak muncul lagi", call("DELETE", f"/api/lms/comments/{own['id']}", sc), 404)

# Siswa di luar kelas: ditolak 403 untuk membaca, menulis, dan menghapus.
expect("siswa di luar kelas tidak bisa membaca forum", call("GET", mpath, sluar), 403)
expect("siswa di luar kelas tidak bisa berkomentar", call("POST", mpath, sluar, {"body": "Halo"}), 403)
expect("siswa di luar kelas tidak bisa menghapus", call("DELETE", f"/api/lms/comments/{c_siswa['id']}", sluar), 403)

# Guru pengelola ruang menghapus komentar siswa; balasan ikut terhapus.
expect("guru menghapus komentar siswa", call("DELETE", f"/api/lms/comments/{c_siswa['id']}", guru_token), 200)
after = expect("daftar setelah dihapus guru", call("GET", mpath, guru_token), 200)
check("balasan ikut terhapus bersama induknya", all(c["id"] not in (c_siswa["id"], reply["id"]) for c in after), str(after)[:200])
gview = {c["id"]: c for c in after}
check("guru bisa menghapus komentar siapa pun di ruangnya", all(c["can_delete"] for c in after), str(gview)[:200])

# ---------- Tugas terlambat ----------
past = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
future = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
t_late = expect("tugas terima terlambat (tenggat lewat)", call("POST", f"/api/lms/rooms/{room}/tasks", guru_token, {"title": f"Tugas telat {tag}", "due_at": past, "max_score": 100, "allow_late": True}), 200)
t_strict = expect("tugas tanpa terlambat (tenggat lewat)", call("POST", f"/api/lms/rooms/{room}/tasks", guru_token, {"title": f"Tugas ketat {tag}", "due_at": past, "max_score": 100, "allow_late": False}), 200)
t_ontime = expect("tugas tepat waktu", call("POST", f"/api/lms/rooms/{room}/tasks", guru_token, {"title": f"Tugas biasa {tag}", "due_at": future, "max_score": 100, "allow_late": False}), 200)

sub = expect("siswa mengumpulkan setelah tenggat", submit("PUT", sa, t_late["id"], "Jawaban terlambat"), 200)
check("pengumpulan terlambat ditandai is_late", sub["is_late"] is True, str(sub)[:200])
expect("pengumpulan terlambat tanpa izin ditolak", submit("PUT", sc, t_strict["id"], "Jawaban"), 422)
ontime = expect("siswa mengumpulkan tepat waktu", submit("PUT", sc, t_ontime["id"], "Jawaban tepat"), 200)
check("pengumpulan tepat waktu tidak ditandai terlambat", ontime["is_late"] is False, str(ontime)[:200])

detail = expect("guru melihat pengumpulan tugas terlambat", call("GET", f"/api/lms/tasks/{t_late['id']}", guru_token), 200)
rows = [s for s in detail["submissions"] if s["student_id"] == sub["student_id"]]
check("daftar pengumpulan guru menampilkan is_late", len(rows) == 1 and rows[0]["is_late"] is True, str(detail)[:300])

print(f"\nSEMUA LULUS: {PASSED} pemeriksaan")
