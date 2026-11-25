#!/usr/bin/env python3
"""Smoke test F4 (LMS) terhadap API yang sedang berjalan.

Prasyarat: sekolah 'sdn-1' dengan admin admin@sdn1.sch.id / rahasia-123 sudah ada
(lihat README). Skrip membuat data uji sendiri; jalankan pada database uji saja.

  python3 scripts/smoke_f4.py http://localhost:8084
"""

import json
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8080"
PASSED = 0


def raw(method, path, token=None, body=None, content_type=None):
    req = urllib.request.Request(BASE + path, data=body, method=method)
    if content_type:
        req.add_header("content-type", content_type)
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def call(method, path, token=None, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    status, data, _ = raw(method, path, token, body, "application/json" if body else None)
    try:
        return status, json.loads(data) if data else None
    except json.JSONDecodeError:
        return status, data.decode(errors="replace")


def multipart(fields, files):
    """fields: [(name, value)], files: [(name, filename, bytes)] -> (body, content_type)."""
    boundary = uuid.uuid4().hex
    out = bytearray()
    for name, value in fields:
        out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
    for name, filename, data in files:
        out += (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n"
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode()
        out += data + b"\r\n"
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
    status, payload = call("POST", "/api/auth/login", payload={"school_slug": "sdn-1", "email": email, "password": password})
    assert status == 200, payload
    return payload["token"]


def iso(delta_days):
    return (datetime.now(timezone.utc) + timedelta(days=delta_days)).strftime("%Y-%m-%dT%H:%M:%SZ")


today = date.today()
start = date(today.year if today.month >= 7 else today.year - 1, 7, 1)
year_name = f"{start.year}/{start.year + 1}"
tag = datetime.now().strftime("%H%M%S")

admin = login("admin@sdn1.sch.id", "rahasia-123")

# --- Data akademik dasar (F2) ---
years = expect("list tahun ajaran", call("GET", "/api/academic-years", admin), 200)
year = next((y for y in years if y["name"] == year_name), None)
if year is None:
    year = expect("buat tahun ajaran", call("POST", "/api/academic-years", admin, {"name": year_name, "starts_on": str(start), "ends_on": str(date(start.year + 1, 6, 30))}), 200)
expect("aktifkan tahun ajaran", call("POST", f"/api/academic-years/{year['id']}/activate", admin), 200)

mtk = expect("buat mapel", call("POST", "/api/subjects", admin, {"code": f"mtk{tag}", "name": "Matematika"}), 200)
guru = expect("buat guru", call("POST", "/api/users", admin, {"name": "Guru F4", "email": f"guruf4{tag}@sdn1.sch.id", "password": "guru-pass-1", "role": "guru"}), 200)
wali = expect("buat wali kelas", call("POST", "/api/users", admin, {"name": "Wali F4", "email": f"walif4{tag}@sdn1.sch.id", "password": "wali-pass-1", "role": "wali_kelas"}), 200)
guru_token = login(f"guruf4{tag}@sdn1.sch.id", "guru-pass-1")

kelas_a = expect("buat kelas A", call("POST", "/api/classes", admin, {"name": f"7A-{tag}", "grade_level": 7}), 200)
kelas_b = expect("buat kelas B", call("POST", "/api/classes", admin, {"name": f"7B-{tag}", "grade_level": 7}), 200)

def make_student(label, nis):
    s = expect(f"buat siswa {label}", call("POST", "/api/students", admin, {"nis": nis, "name": f"Siswa {label}", "status": "aktif"}), 200)
    email = f"siswa{label.lower()}{tag}@sdn1.sch.id"
    expect(f"buat akun siswa {label}", call("POST", f"/api/students/{s['id']}/account", admin, {"email": email, "password": "siswa-pass-1"}), 200)
    return s, login(email, "siswa-pass-1")

s1, s1_token = make_student("S1", f"S1{tag}")
s2, s2_token = make_student("S2", f"S2{tag}")

expect("masukkan S1 ke kelas A", call("POST", f"/api/classes/{kelas_a['id']}/students", admin, {"student_ids": [s1["id"]]}), 200)
expect("masukkan S2 ke kelas B", call("POST", f"/api/classes/{kelas_b['id']}/students", admin, {"student_ids": [s2["id"]]}), 200)

room_a = expect("penugasan MTK kelas A (guru)", call("POST", "/api/assignments", admin, {"class_id": kelas_a["id"], "subject_id": mtk["id"], "teacher_id": guru["id"]}), 200)["id"]
room_b = expect("penugasan MTK kelas B (wali)", call("POST", "/api/assignments", admin, {"class_id": kelas_b["id"], "subject_id": mtk["id"], "teacher_id": wali["id"]}), 200)["id"]

# --- Hak akses ruang kelas ---
rooms_s1 = expect("S1 daftar ruang", call("GET", "/api/lms/rooms", s1_token), 200)
check("S1 hanya melihat ruang kelasnya", [r["id"] for r in rooms_s1] == [room_a], str(rooms_s1))
expect("S1 membuka ruang kelas lain ditolak", call("GET", f"/api/lms/rooms/{room_b}/materials", s1_token), 403)
expect("guru membuka ruang kelas milik orang lain ditolak", call("GET", f"/api/lms/rooms/{room_b}/tasks", guru_token), 403)
rooms_guru = expect("guru daftar ruang", call("GET", "/api/lms/rooms", guru_token), 200)
check("guru hanya melihat ruang yang diajarnya", [r["id"] for r in rooms_guru] == [room_a], str(rooms_guru))
expect("siswa tanpa token ditolak", call("GET", "/api/lms/rooms"), 401)

# --- Materi dan berkas ---
mat = expect("guru membuat materi", call("POST", f"/api/lms/rooms/{room_a}/materials", guru_token, {"title": "Bab 1", "body": "Pengantar"}), 200)
expect("guru tidak bisa membuat materi di ruang lain", call("POST", f"/api/lms/rooms/{room_b}/materials", guru_token, {"title": "X"}), 403)

pdf_bytes = b"%PDF-1.4\n% isi materi\n"
body, ct = multipart([], [("file", "Bab 1.pdf", pdf_bytes)])
status, data, _ = raw("POST", f"/api/lms/materials/{mat['id']}/files", guru_token, body, ct)
check(f"guru unggah PDF materi (HTTP {status})", status == 200, data.decode(errors="replace"))
mat_file = json.loads(data)
check("nama berkas tersimpan", mat_file["file_name"] == "Bab 1.pdf")

status, content, headers = raw("GET", f"/api/lms/files/{mat_file['id']}", s1_token)
check(f"S1 unduh materi di kelasnya (HTTP {status})", status == 200 and content == pdf_bytes)
check("unduhan memakai nosniff dan attachment", headers.get("X-Content-Type-Options") == "nosniff" and headers.get("Content-Disposition", "").startswith("attachment"))
status, _, _ = raw("GET", f"/api/lms/files/{mat_file['id']}", s2_token)
check(f"S2 (kelas lain) unduh materi ditolak (HTTP {status})", status == 403)
status, _, _ = raw("GET", f"/api/lms/files/{mat_file['id']}")
check(f"unduhan tanpa token ditolak (HTTP {status})", status == 401)

for name, data_bytes in [("malware.exe", b"MZ\x90\x00"), ("laporan.pdf.exe", b"%PDF-1.4"), ("fake.pdf", b"bukan pdf sama sekali"), ("skrip.sh", b"#!/bin/sh")]:
    body, ct = multipart([], [("file", name, data_bytes)])
    status, _, _ = raw("POST", f"/api/lms/materials/{mat['id']}/files", guru_token, body, ct)
    check(f"berkas '{name}' ditolak (HTTP {status})", status == 422)

big = b"%PDF-" + b"0" * (10 * 1024 * 1024 + 10)
body, ct = multipart([], [("file", "besar.pdf", big)])
status, _, _ = raw("POST", f"/api/lms/materials/{mat['id']}/files", guru_token, body, ct)
check(f"berkas di atas 10 MB ditolak (HTTP {status})", status == 422)

huge = b"0" * (23 * 1024 * 1024)
body, ct = multipart([], [("file", "raksasa.txt", huge)])
# Server menutup koneksi saat badan melewati batas, jadi kirim manual dan tetap baca respons.
import http.client
from urllib.parse import urlparse
parsed = urlparse(BASE)
conn = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
conn.putrequest("POST", f"/api/lms/materials/{mat['id']}/files")
conn.putheader("authorization", f"Bearer {guru_token}")
conn.putheader("content-type", ct)
conn.putheader("content-length", str(len(body)))
conn.endheaders()
try:
    conn.send(body)
except (BrokenPipeError, ConnectionResetError):
    pass
status = conn.getresponse().status
conn.close()
check(f"permintaan di atas batas badan ditolak (HTTP {status})", status in (413, 422))

# --- Tugas dan tenggat ---
t_open = expect("guru membuat tugas dengan tenggat ke depan", call("POST", f"/api/lms/rooms/{room_a}/tasks", guru_token, {"title": "PR 1", "instructions": "Kerjakan soal 1–5", "due_at": iso(3), "max_score": 100, "allow_late": False}), 200)
t_closed = expect("guru membuat tugas tertutup (tenggat lewat)", call("POST", f"/api/lms/rooms/{room_a}/tasks", guru_token, {"title": "PR 2", "due_at": iso(-1), "max_score": 100, "allow_late": False}), 200)
t_late = expect("guru membuat tugas yang menerima terlambat", call("POST", f"/api/lms/rooms/{room_a}/tasks", guru_token, {"title": "PR 3", "due_at": iso(-1), "max_score": 100, "allow_late": True}), 200)
expect("nilai maksimum di luar rentang ditolak", call("POST", f"/api/lms/rooms/{room_a}/tasks", guru_token, {"title": "X", "due_at": iso(1), "max_score": 0, "allow_late": False}), 422)

def submit(token, task_id, text=None, files=()):
    fields = [("text", text)] if text is not None else []
    body, ct = multipart(fields, list(files))
    return raw("PUT", f"/api/lms/tasks/{task_id}/submission", token, body, ct)

status, data, _ = submit(s1_token, t_closed["id"], text="jawaban")
check(f"submit setelah tenggat ditolak tanpa terlambat (HTTP {status})", status == 422, data.decode(errors="replace"))

status, data, _ = submit(s1_token, t_late["id"], text="jawaban terlambat")
check(f"submit terlambat diterima dan ditandai (HTTP {status})", status == 200 and json.loads(data)["is_late"] is True, data.decode(errors="replace"))

status, data, _ = submit(s1_token, t_open["id"], text="  ")
check(f"submit kosong ditolak (HTTP {status})", status == 422)

status, data, _ = submit(s1_token, t_open["id"], text="Jawaban nomor 1", files=[("file", "jawaban.txt", "isi jawaban".encode())])
check(f"submit teks dan berkas tepat waktu (HTTP {status})", status == 200, data.decode(errors="replace"))
first = json.loads(data)
check("pengumpulan tepat waktu tidak ditandai terlambat", first["is_late"] is False and len(first["files"]) == 1)

status, data, _ = submit(s1_token, t_open["id"], text="Jawaban revisi")
check(f"submit ulang menggantikan pengumpulan (HTTP {status})", status == 200 and json.loads(data)["files"] == [])

status, data, _ = submit(s2_token, t_open["id"], text="bukan kelasku")
check(f"S2 (bukan anggota kelas) tidak bisa mengumpulkan (HTTP {status})", status == 403)

status, data, _ = submit(guru_token, t_open["id"], text="guru mencoba")
check(f"guru tidak bisa mengumpulkan sebagai siswa (HTTP {status})", status == 403)

detail_s1 = expect("S1 melihat detail tugas", call("GET", f"/api/lms/tasks/{t_open['id']}", s1_token), 200)
check("siswa tidak melihat pengumpulan siswa lain", detail_s1["submissions"] == [] and detail_s1["own_submission"] is not None)
detail_guru = expect("guru melihat detail tugas", call("GET", f"/api/lms/tasks/{t_open['id']}", guru_token), 200)
check("guru melihat semua pengumpulan", len(detail_guru["submissions"]) == 1 and detail_guru["manage"] is True)
sub_id = detail_guru["submissions"][0]["id"]

expect("nilai melebihi nilai maksimum ditolak", call("PUT", f"/api/lms/submissions/{sub_id}/grade", guru_token, {"score": 150}), 422)
graded = expect("guru memberi nilai", call("PUT", f"/api/lms/submissions/{sub_id}/grade", guru_token, {"score": 85, "feedback": "Bagus"}), 200)
check("nilai dan umpan balik tersimpan", graded["score"] == 85 and graded["feedback"] == "Bagus")
expect("siswa tidak bisa menilai", call("PUT", f"/api/lms/submissions/{sub_id}/grade", s1_token, {"score": 100}), 403)
status, data, _ = submit(s1_token, t_open["id"], text="setelah dinilai")
check(f"pengumpulan yang sudah dinilai tidak bisa diubah (HTTP {status})", status == 409)

# --- Pengumuman ---
expect("guru membuat pengumuman", call("POST", f"/api/lms/rooms/{room_a}/announcements", guru_token, {"title": "Ujian", "body": "Ujian minggu depan"}), 200)
ann = expect("S1 membaca pengumuman", call("GET", f"/api/lms/rooms/{room_a}/announcements", s1_token), 200)
check("pengumuman terbaca siswa", len(ann) == 1 and ann[0]["title"] == "Ujian")
expect("siswa tidak bisa membuat pengumuman", call("POST", f"/api/lms/rooms/{room_a}/announcements", s1_token, {"title": "X", "body": "Y"}), 403)

# --- Penghapusan materi membersihkan berkas ---
expect("guru menghapus materi", call("DELETE", f"/api/lms/materials/{mat['id']}", guru_token), 200)
status, _, _ = raw("GET", f"/api/lms/files/{mat_file['id']}", guru_token)
check(f"berkas materi yang dihapus tidak bisa diunduh (HTTP {status})", status == 404)

print(f"\nSEMUA LULUS: {PASSED} pemeriksaan")
